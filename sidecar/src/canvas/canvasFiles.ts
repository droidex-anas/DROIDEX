// Canvas storage on disk (spec §7). One root directory holds one directory per
// canvas; each holds an atomically replaced manifest and immutable revision
// trees. Every path is built from validated identifiers and validated source
// paths, and nothing under the root is read or created through a symbolic link.

import { randomUUID } from 'node:crypto';
import { mkdir, open, readdir, readFile, lstat, rename, rm } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { z } from 'zod';
import { canvasError, storageFailure } from './canvasError.js';
import { canvasManifestSchema, type CanvasManifest } from './canvasManifest.js';
import type { RevisionRef } from './protocol.js';
import { canvasIdentifierSchema, designSystemRefSchema, sourcePathSchema } from './schema.js';

const MANIFEST_FILE = 'manifest.json';
const REVISIONS_DIRECTORY = 'revisions';
const SOURCE_DIRECTORY = 'files';
const METADATA_FILE = 'revision.json';
const STAGING_PREFIX = '.staging-';
const TEMPORARY_SUFFIX = '.tmp';

const READ_RECOVERY = 'Canvas storage could not be read.';
const WRITE_RECOVERY = 'Canvas could not be saved. The last saved board is unchanged.';
const SOURCE_RECOVERY =
  'Canvas source could not be saved. Retry the change; your source is unchanged.';

export const REVISION_METADATA_VERSION = 1;

// Every file in a revision is listed here, so a read never walks the directory
// and never discovers a name the workspace did not write.
export const revisionMetadataSchema = z
  .object({
    version: z.literal(REVISION_METADATA_VERSION),
    designId: canvasIdentifierSchema,
    revisionId: canvasIdentifierSchema,
    parentRevisionId: canvasIdentifierSchema.nullable(),
    designSystem: designSystemRefSchema,
    createdAt: z.number().int().nonnegative(),
    files: z.array(sourcePathSchema),
  })
  .strict();

export type RevisionMetadata = z.infer<typeof revisionMetadataSchema>;

/** A revision to publish: its file list is whatever tree is handed over with it. */
export type NewRevision = Omit<RevisionMetadata, 'files'>;

export type ManifestLoad =
  | { state: 'missing' }
  | { state: 'damaged'; reason: string }
  | { state: 'loaded'; manifest: CanvasManifest };

export interface CanvasFileHandle {
  writeFile(data: string, encoding: 'utf8'): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

/** The filesystem operations Canvas storage uses; tests inject faults here. */
export interface CanvasFileSystem {
  mkdir(path: string, options: { recursive: true }): Promise<string | undefined>;
  open(path: string, flags: string, mode?: number): Promise<CanvasFileHandle>;
  readFile(path: string, encoding: 'utf8'): Promise<string>;
  readdir(path: string): Promise<string[]>;
  lstat(path: string): Promise<{ isSymbolicLink(): boolean; isDirectory(): boolean }>;
  rename(from: string, to: string): Promise<void>;
  rm(path: string, options: { recursive: boolean; force: boolean }): Promise<void>;
}

export const nodeCanvasFileSystem: CanvasFileSystem = {
  mkdir: (path, options) => mkdir(path, options),
  open: (path, flags, mode) => open(path, flags, mode),
  readFile: (path, encoding) => readFile(path, encoding),
  readdir: (path) => readdir(path),
  lstat: (path) => lstat(path),
  rename: (from, to) => rename(from, to),
  rm: (path, options) => rm(path, options),
};

export class CanvasFiles {
  constructor(
    private readonly root: string,
    private readonly fs: CanvasFileSystem = nodeCanvasFileSystem,
  ) {}

  async createRoot(): Promise<void> {
    try {
      await this.fs.mkdir(this.root, { recursive: true });
    } catch (error) {
      throw storageFailure('The Canvas storage directory could not be created.', error);
    }
  }

  /** Canvas directories under the root, sorted, excluding links and leftovers. */
  async listCanvasIds(): Promise<string[]> {
    const ids: string[] = [];
    try {
      for (const name of await this.fs.readdir(this.root)) {
        if (!canvasIdentifierSchema.safeParse(name).success) continue;
        const stats = await this.fs.lstat(join(this.root, name));
        if (stats.isSymbolicLink() || !stats.isDirectory()) continue;
        ids.push(name);
      }
    } catch (error) {
      throw storageFailure(READ_RECOVERY, error);
    }
    return ids.sort();
  }

  async loadManifest(canvasId: string): Promise<ManifestLoad> {
    const path = this.manifestPath(canvasId);
    let text: string;
    try {
      if ((await this.fs.lstat(path)).isSymbolicLink())
        return { state: 'damaged', reason: 'its manifest is a symbolic link' };
      text = await this.fs.readFile(path, 'utf8');
    } catch (error) {
      if (isMissingFile(error)) return { state: 'missing' };
      throw storageFailure(READ_RECOVERY, error);
    }
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      return { state: 'damaged', reason: 'its manifest is not valid JSON' };
    }
    const parsed = canvasManifestSchema.safeParse(value);
    if (!parsed.success)
      return {
        state: 'damaged',
        reason: parsed.error.issues[0]?.message ?? 'its manifest does not match the current schema',
      };
    if (parsed.data.canvasId !== canvasId)
      return { state: 'damaged', reason: 'its manifest names another canvas' };
    return { state: 'loaded', manifest: parsed.data };
  }

  /** Replaces the manifest in one rename, so a reader sees an old or new head. */
  async writeManifest(manifest: CanvasManifest): Promise<void> {
    const path = this.manifestPath(manifest.canvasId);
    const temporary = `${path}.${randomUUID()}${TEMPORARY_SUFFIX}`;
    try {
      await this.fs.mkdir(dirname(path), { recursive: true });
      await this.writeFlushed(temporary, `${JSON.stringify(manifest)}\n`);
      await this.fs.rename(temporary, path);
      await this.syncDirectory(dirname(path));
    } catch (error) {
      await this.discard(temporary);
      throw storageFailure(WRITE_RECOVERY, error);
    }
  }

  /**
   * Writes a complete revision tree into a staging directory, flushes it, and
   * renames it into place. The caller publishes the revision by writing the
   * manifest afterwards; a revision nobody references is harmless.
   */
  async publishRevision(
    canvasId: string,
    revision: NewRevision,
    files: ReadonlyMap<string, string>,
  ): Promise<void> {
    const metadata: RevisionMetadata = { ...revision, files: [...files.keys()] };
    const revisions = this.revisionsPath(canvasId);
    const staging = join(revisions, `${STAGING_PREFIX}${randomUUID()}`);
    const source = join(staging, SOURCE_DIRECTORY);
    try {
      await this.fs.mkdir(source, { recursive: true });
      for (const [path, content] of files) {
        const target = join(source, ...sourceSegments(path));
        await this.fs.mkdir(dirname(target), { recursive: true });
        await this.writeFlushed(target, content);
      }
      await this.writeFlushed(join(staging, METADATA_FILE), `${JSON.stringify(metadata)}\n`);
      await this.syncDirectory(staging);
      await this.fs.rename(staging, this.revisionPath(canvasId, metadata.revisionId));
      await this.syncDirectory(revisions);
    } catch (error) {
      await this.discard(staging);
      throw storageFailure(SOURCE_RECOVERY, error);
    }
  }

  async readRevision(canvasId: string, ref: RevisionRef): Promise<Map<string, string>> {
    const revision = this.revisionPath(canvasId, ref.revisionId);
    const checked = new Set<string>();
    try {
      await this.refuseLinks(revision, checked);
      const metadata = revisionMetadataSchema.parse(
        JSON.parse(await this.fs.readFile(join(revision, METADATA_FILE), 'utf8')),
      );
      if (metadata.designId !== ref.designId)
        throw canvasError('invalid_input', 'That revision belongs to another design.');
      const files = new Map<string, string>();
      for (const path of metadata.files) {
        const target = join(revision, SOURCE_DIRECTORY, ...sourceSegments(path));
        await this.refuseLinks(target, checked);
        files.set(path, await this.fs.readFile(target, 'utf8'));
      }
      return files;
    } catch (error) {
      throw storageFailure('That revision could not be read.', error);
    }
  }

  /** Removes staging trees and manifest temporaries a terminated run left behind. */
  async removeTemporaries(canvasId: string): Promise<void> {
    const canvas = this.canvasPath(canvasId);
    const revisions = this.revisionsPath(canvasId);
    try {
      for (const name of await this.readdirIfPresent(canvas)) {
        if (name.endsWith(TEMPORARY_SUFFIX)) await this.discard(join(canvas, name));
      }
      for (const name of await this.readdirIfPresent(revisions)) {
        if (name.startsWith(STAGING_PREFIX)) await this.discard(join(revisions, name));
      }
    } catch (error) {
      throw storageFailure(READ_RECOVERY, error);
    }
  }

  private canvasPath(canvasId: string): string {
    return join(this.root, identifierSegment(canvasId));
  }

  private manifestPath(canvasId: string): string {
    return join(this.canvasPath(canvasId), MANIFEST_FILE);
  }

  private revisionsPath(canvasId: string): string {
    return join(this.canvasPath(canvasId), REVISIONS_DIRECTORY);
  }

  private revisionPath(canvasId: string, revisionId: string): string {
    return join(this.revisionsPath(canvasId), identifierSegment(revisionId));
  }

  /** `wx` refuses an existing name, so no write ever follows a link. */
  private async writeFlushed(path: string, content: string): Promise<void> {
    const file = await this.fs.open(path, 'wx', 0o600);
    try {
      await file.writeFile(content, 'utf8');
      await file.sync();
    } finally {
      await file.close();
    }
  }

  private async syncDirectory(path: string): Promise<void> {
    if (process.platform === 'win32') return;
    const directory = await this.fs.open(path, 'r');
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }

  /** Rejects a read whose path crosses a link anywhere below the root. */
  private async refuseLinks(path: string, checked: Set<string>): Promise<void> {
    let current = this.root;
    for (const segment of relative(this.root, path).split(sep)) {
      current = join(current, segment);
      if (checked.has(current)) continue;
      if ((await this.fs.lstat(current)).isSymbolicLink())
        throw canvasError(
          'storage_failed',
          'Canvas storage holds a symbolic link and was not read.',
        );
      checked.add(current);
    }
  }

  private async readdirIfPresent(path: string): Promise<string[]> {
    try {
      return await this.fs.readdir(path);
    } catch (error) {
      if (isMissingFile(error)) return [];
      throw error;
    }
  }

  // Our own temporary, during cleanup or error handling: the original failure
  // matters, and whatever survives is removed on the next open.
  private async discard(path: string): Promise<void> {
    await this.fs.rm(path, { recursive: true, force: true }).catch(() => undefined);
  }
}

function identifierSegment(id: string): string {
  const parsed = canvasIdentifierSchema.safeParse(id);
  if (!parsed.success) throw canvasError('invalid_input', 'That Canvas identifier is not usable.');
  return parsed.data;
}

function sourceSegments(path: string): string[] {
  const parsed = sourcePathSchema.safeParse(path);
  if (!parsed.success)
    throw canvasError('invalid_source_path', parsed.error.issues[0]?.message ?? 'Unusable path.');
  return parsed.data.split('/');
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
