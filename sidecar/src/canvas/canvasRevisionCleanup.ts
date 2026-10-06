// Reclaims source after the manifest no longer retains a frame or its Undo.
// A damaged revision or a link stops collection rather than guessing at refs.

import { constants } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import {
  REVISION_METADATA_VERSION,
  type CanvasFileSystem,
  nodeCanvasFileSystem,
} from './canvasFiles.js';
import type { CanvasManifest } from './canvasManifest.js';
import { canvasIdentifierSchema } from './schema.js';

const metadataSchema = z
  .object({
    version: z.literal(REVISION_METADATA_VERSION),
    designId: canvasIdentifierSchema,
    revisionId: canvasIdentifierSchema,
    parentRevisionId: canvasIdentifierSchema.nullable(),
  })
  .passthrough();

interface Revision {
  designId: string;
  revisionId: string;
  parentRevisionId: string | null;
}

export class CanvasRevisionCleanup {
  constructor(
    private readonly root: string,
    private readonly fs: CanvasFileSystem = nodeCanvasFileSystem,
  ) {}

  /** A best-effort sweep after a durable head; retry on the next open. */
  async collect(manifest: CanvasManifest, retiredDesignIds?: ReadonlySet<string>): Promise<void> {
    const canvas = join(this.root, manifest.canvasId);
    const canvasDirectory = await this.fs.lstat(canvas);
    if (canvasDirectory.isSymbolicLink() || !canvasDirectory.isDirectory())
      throw new Error('Canvas storage is not a directory.');
    const revisions = join(this.root, manifest.canvasId, 'revisions');
    const directory = await this.fs.lstat(revisions).catch(missing);
    if (!directory) return;
    if (directory.isSymbolicLink() || !directory.isDirectory())
      throw new Error('Revision storage is not a directory.');

    const byId = new Map<string, Revision>();
    for (const name of await this.fs.readdir(revisions)) {
      if (name.startsWith('.staging-')) continue;
      if (!canvasIdentifierSchema.safeParse(name).success) return;
      const path = join(revisions, name);
      const entry = await this.fs.lstat(path);
      if (entry.isSymbolicLink() || !entry.isDirectory()) return;
      const file = await this.fs.open(
        join(path, 'revision.json'),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      let value: unknown;
      try {
        value = JSON.parse(await file.readFile('utf8'));
      } finally {
        await file.close();
      }
      const parsed = metadataSchema.safeParse(value);
      if (!parsed.success || parsed.data.revisionId !== name) return;
      byId.set(name, parsed.data);
    }

    const retainedDesigns = new Set(manifest.designs.map((design) => design.designId));
    for (const tombstone of manifest.tombstones)
      for (const design of tombstone.designs) retainedDesigns.add(design.designId);
    const protectedIds = new Set<string>();
    for (const design of manifest.designs) {
      if (design.revisionId) protectedIds.add(design.revisionId);
      if (design.lastWorkingRevisionId) protectedIds.add(design.lastWorkingRevisionId);
    }
    for (const tombstone of manifest.tombstones) {
      for (const design of tombstone.designs) {
        if (design.revisionId) protectedIds.add(design.revisionId);
        if (design.lastWorkingRevisionId) protectedIds.add(design.lastWorkingRevisionId);
      }
    }
    for (const revision of byId.values()) {
      if (retainedDesigns.has(revision.designId)) protectedIds.add(revision.revisionId);
    }
    // A surviving frame's copied revision can name an old parent for
    // provenance. Keep that referenced revision and its ancestry.
    const pending = [...protectedIds];
    while (pending.length > 0) {
      const id = pending.pop();
      if (!id) continue;
      const parent = byId.get(id)?.parentRevisionId;
      if (!parent || protectedIds.has(parent)) continue;
      protectedIds.add(parent);
      pending.push(parent);
    }

    let removed = false;
    for (const revision of byId.values()) {
      if (retiredDesignIds && !retiredDesignIds.has(revision.designId)) continue;
      if (protectedIds.has(revision.revisionId)) continue;
      await this.fs.rm(join(revisions, revision.revisionId), { recursive: true, force: false });
      removed = true;
    }
    if (removed && process.platform !== 'win32') {
      const directoryHandle = await this.fs.open(
        revisions,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        await directoryHandle.sync();
      } finally {
        await directoryHandle.close();
      }
    }
  }
}

function missing(error: unknown): null {
  if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
  throw error;
}
