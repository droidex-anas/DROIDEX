// Canvas storage on disk (spec §7). One root directory holds one directory per
// canvas; each holds an atomically replaced manifest and immutable revision
// trees. Every path is built from validated identifiers and validated source
// paths, every file is opened without following a link, and every directory the
// writer creates is flushed before the change is acknowledged.

import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, rename, rm } from 'node:fs/promises';
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
const REVISION_RECOVERY = 'The saved source for that revision could not be read.';
const LINKED_STORAGE = 'Canvas storage holds a symbolic link and was not used.';

// The storage root and its parent belong to the user's profile, which may
// legitimately be a link; everything the writer creates below the root may not.
const PROFILE_OWNED = false;

// Canvas owns every name under its root, so a link in the way is damage rather
// than a path to follow: both flag sets refuse one instead of opening through it.
const READ_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW;
const CREATE_FLAGS =
  constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW;

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
  readFile(encoding: 'utf8'): Promise<string>;
  writeFile(data: string, encoding: 'utf8'): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

/** The filesystem operations Canvas storage uses; tests inject faults here. */
export interface CanvasFileSystem {
  /** One directory, failing when the name is taken. */
  mkdir(path: string): Promise<void>;
  /** The storage root and its parents, which the user's profile may own. */
  mkdirAll(path: string): Promise<void>;
  open(path: string, flags: number, mode?: number): Promise<CanvasFileHandle>;
  readdir(path: string): Promise<string[]>;
  lstat(path: string): Promise<{ isSymbolicLink(): boolean; isDirectory(): boolean }>;
  rename(from: string, to: string): Promise<void>;
  rm(path: string, options: { recursive: boolean; force: boolean }): Promise<void>;
}

export const nodeCanvasFileSystem: CanvasFileSystem = {
  mkdir: (path) => mkdir(path),
  mkdirAll: async (path) => {
    await mkdir(path, { recursive: true });
  },
  open: (path, flags, mode) => open(path, flags, mode),
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
      await this.fs.mkdirAll(this.root);
      // The root's own entry has to survive a crash too, or the first canvas
      // lands in a directory the profile does not yet record.
      await this.syncDirectory(dirname(this.root), PROFILE_OWNED);
    } catch (error) {
      throw storageFailure('The Canvas storage directory could not be created.', error);
    }
  }

  /**
   * Reflushes the directory entries a published manifest depends on. A save
   * whose flush failed is durable only once this succeeds, so a recovered head
   * is not served until it does.
   */
  async flushCanvasEntry(canvasId: string): Promise<void> {
    try {
      await this.syncDirectory(this.canvasPath(canvasId));
      await this.syncDirectory(this.root, PROFILE_OWNED);
    } catch (error) {
      throw storageFailure(WRITE_RECOVERY, error);
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
    const path = join(this.canvasPath(canvasId), MANIFEST_FILE);
    let text: string;
    try {
      if ((await this.fs.lstat(path)).isSymbolicLink())
        return { state: 'damaged', reason: 'its manifest is a symbolic link' };
      text = await this.readText(path);
    } catch (error) {
      if (isMissingPath(error)) return { state: 'missing' };
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

  /**
   * Replaces the manifest in one rename, so a reader sees a complete old or new
   * head. `beforeRename` is the caller's last chance to abandon the change: it
   * runs with the replacement already durable and nothing published yet.
   */
  async writeManifest(manifest: CanvasManifest, beforeRename: () => void): Promise<void> {
    const canvas = this.canvasPath(manifest.canvasId);
    const path = join(canvas, MANIFEST_FILE);
    const temporary = `${path}.${randomUUID()}${TEMPORARY_SUFFIX}`;
    try {
      const createdCanvas = await this.makeDirectory(canvas);
      await this.writeFlushed(temporary, `${JSON.stringify(manifest)}\n`);
      beforeRename();
      await this.fs.rename(temporary, path);
      await this.syncDirectory(canvas);
      if (createdCanvas) await this.syncDirectory(this.root, PROFILE_OWNED);
    } catch (error) {
      await this.discard(temporary);
      throw storageFailure(WRITE_RECOVERY, error);
    }
  }

  /**
   * Writes a complete revision tree into a staging directory, flushes every
   * file and every directory it created, and renames the tree into place. The
   * caller publishes it by writing the manifest; an unreferenced revision is
   * harmless.
   */
  async publishRevision(
    canvasId: string,
    revision: NewRevision,
    files: ReadonlyMap<string, string>,
  ): Promise<void> {
    const metadata: RevisionMetadata = { ...revision, files: [...files.keys()] };
    const canvas = this.canvasPath(canvasId);
    const revisions = join(canvas, REVISIONS_DIRECTORY);
    const staging = join(revisions, `${STAGING_PREFIX}${randomUUID()}`);
    const source = join(staging, SOURCE_DIRECTORY);
    try {
      const createdCanvas = await this.makeDirectory(canvas);
      const createdRevisions = await this.makeDirectory(revisions);
      await this.fs.mkdir(staging);
      await this.fs.mkdir(source);
      // Only this call writes under the fresh staging tree, so its nested
      // directories need no link check, only a flush of their own entries.
      const nested: string[] = [];
      for (const [path, content] of files) {
        const target = join(source, ...sourceSegments(path));
        for (const directory of parentDirectories(source, target)) {
          if (nested.includes(directory)) continue;
          await this.fs.mkdir(directory);
          nested.push(directory);
        }
        await this.writeFlushed(target, content);
      }
      await this.writeFlushed(join(staging, METADATA_FILE), `${JSON.stringify(metadata)}\n`);
      // A file's own flush does not persist the entry its directory holds, so
      // every created directory is flushed from the leaves upwards.
      for (const directory of [...nested].reverse()) await this.syncDirectory(directory);
      await this.syncDirectory(source);
      await this.syncDirectory(staging);
      await this.fs.rename(staging, this.revisionPath(canvasId, metadata.revisionId));
      await this.syncDirectory(revisions);
      if (createdRevisions) await this.syncDirectory(canvas);
      if (createdCanvas) await this.syncDirectory(this.root, PROFILE_OWNED);
    } catch (error) {
      await this.discard(staging);
      throw storageFailure(SOURCE_RECOVERY, error);
    }
  }

  /**
   * A revision that is not there is an unusable reference; one whose metadata
   * is there but whose files are not is damaged storage. The caller decides
   * which of the two its own context makes it.
   */
  async readRevision(canvasId: string, ref: RevisionRef): Promise<Map<string, string>> {
    const revision = this.revisionPath(canvasId, ref.revisionId);
    const checked = new Set<string>();
    let metadata: RevisionMetadata;
    try {
      await this.refuseLinkedPath(revision, checked);
      metadata = revisionMetadataSchema.parse(
        JSON.parse(await this.readText(join(revision, METADATA_FILE))),
      );
    } catch (error) {
      if (isMissingPath(error))
        throw canvasError('invalid_input', 'That revision is not available.');
      throw storageFailure(REVISION_RECOVERY, error);
    }
    if (metadata.designId !== ref.designId)
      throw canvasError('invalid_input', 'That revision belongs to another design.');
    try {
      const files = new Map<string, string>();
      for (const path of metadata.files) {
        const target = join(revision, SOURCE_DIRECTORY, ...sourceSegments(path));
        await this.refuseLinkedPath(target, checked);
        files.set(path, await this.readText(target));
      }
      return files;
    } catch (error) {
      throw storageFailure(REVISION_RECOVERY, error);
    }
  }

  /**
   * Removes staging trees and manifest temporaries a terminated run left
   * behind. Cleanup deletes recursively, so it refuses a linked ancestor rather
   * than reaching through one into storage Canvas does not own.
   */
  async removeTemporaries(canvasId: string): Promise<void> {
    const canvas = this.canvasPath(canvasId);
    const revisions = join(canvas, REVISIONS_DIRECTORY);
    const checked = new Set<string>();
    try {
      await this.refuseLinkedPath(canvas, checked);
      for (const name of await this.readdirIfPresent(canvas)) {
        if (name.endsWith(TEMPORARY_SUFFIX)) await this.discard(join(canvas, name));
      }
      await this.refuseLinkedPath(revisions, checked);
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

  private revisionPath(canvasId: string, revisionId: string): string {
    return join(this.canvasPath(canvasId), REVISIONS_DIRECTORY, identifierSegment(revisionId));
  }

  /**
   * Creates one directory under the root, accepting one that is already there
   * and refusing to descend into a link. True when this call created it, so the
   * caller knows its parent holds a new entry to flush.
   */
  private async makeDirectory(path: string): Promise<boolean> {
    try {
      await this.fs.mkdir(path);
      return true;
    } catch (error) {
      if (!isExistingPath(error)) throw error;
      await this.refuseLink(path);
      return false;
    }
  }

  private async writeFlushed(path: string, content: string): Promise<void> {
    const file = await this.fs.open(path, CREATE_FLAGS, 0o600);
    try {
      await file.writeFile(content, 'utf8');
      await file.sync();
    } finally {
      await file.close();
    }
  }

  private async readText(path: string): Promise<string> {
    const file = await this.fs.open(path, READ_FLAGS);
    try {
      return await file.readFile('utf8');
    } finally {
      await file.close();
    }
  }

  private async syncDirectory(path: string, owned = true): Promise<void> {
    if (process.platform === 'win32') return;
    const directory = await this.fs.open(path, owned ? READ_FLAGS : constants.O_RDONLY);
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }

  private async refuseLink(path: string): Promise<void> {
    if ((await this.fs.lstat(path)).isSymbolicLink())
      throw canvasError('storage_failed', LINKED_STORAGE);
  }

  private async lstatIfPresent(
    path: string,
  ): Promise<{ isSymbolicLink(): boolean; isDirectory(): boolean } | null> {
    try {
      return await this.fs.lstat(path);
    } catch (error) {
      if (isMissingPath(error)) return null;
      throw error;
    }
  }

  /** Refuses a path that crosses a link at any component below the root. */
  private async refuseLinkedPath(path: string, checked: Set<string>): Promise<void> {
    let current = this.root;
    for (const segment of relative(this.root, path).split(sep)) {
      current = join(current, segment);
      if (checked.has(current)) continue;
      const stats = await this.lstatIfPresent(current);
      // Nothing exists below a component that is not there.
      if (!stats) return;
      if (stats.isSymbolicLink()) throw canvasError('storage_failed', LINKED_STORAGE);
      checked.add(current);
    }
  }

  private async readdirIfPresent(path: string): Promise<string[]> {
    try {
      return await this.fs.readdir(path);
    } catch (error) {
      if (isMissingPath(error)) return [];
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

/** The directories between a source root and one file under it, outermost first. */
function parentDirectories(source: string, target: string): string[] {
  const parents: string[] = [];
  let current = source;
  for (const segment of relative(source, target).split(sep).slice(0, -1)) {
    current = join(current, segment);
    parents.push(current);
  }
  return parents;
}

function errorCode(error: unknown): string | null {
  if (!(error instanceof Error) || !('code' in error)) return null;
  return typeof error.code === 'string' ? error.code : null;
}

function isMissingPath(error: unknown): boolean {
  return errorCode(error) === 'ENOENT';
}

function isExistingPath(error: unknown): boolean {
  return errorCode(error) === 'EEXIST';
}
