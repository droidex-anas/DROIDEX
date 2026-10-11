// Explicit whole-canvas deletion (spec §7), which only the user can ask for.
// First a durable head with no attachments, so a crash never leaves a chat on
// a canvas whose source is going; then the canvas stops being served and its
// builds stop; once every mutation and export already reading it has settled,
// its directory leaves the root in one rename and is deleted. Library items
// own their copies, so nothing saved from this canvas goes with it.

import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open, readdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { CanvasBuilds } from './CanvasBuilds.js';
import type { CanvasCommits } from './canvasCommits.js';
import { canvasError, storageFailure } from './canvasError.js';
import { exportReadsSettled } from './canvasExport.js';
import { UNREADABLE_CANVAS, type CanvasHeads } from './canvasHeads.js';
import type { CanvasScopes } from './canvasScopes.js';
import type { CanvasWorkspace } from './CanvasWorkspace.js';
import type { CanvasRemovalPreview } from './protocol.js';

// Not an identifier, so a directory on its way out is never loaded as a canvas.
const REMOVED_PREFIX = '.removed-';
const REMOVE_RECOVERY = 'That canvas could not be deleted. Try again.';

/** What deleting this canvas would end, for the renderer to disclose first. */
export function canvasRemovalPreview(
  workspace: CanvasWorkspace,
  scopes: CanvasScopes,
  canvasId: string,
): CanvasRemovalPreview {
  const snapshot = workspace.snapshot(canvasId);
  const summary = workspace.listCanvases().find((entry) => entry.canvasId === canvasId);
  if (!summary) throw canvasError('not_found', 'That canvas is already deleted.');
  const turns = scopes.activeTurns(canvasId).map((scope) => scope.appSessionId);
  return {
    canvasId,
    name: summary.name,
    attachedAppSessionIds: summary.attachedAppSessionIds,
    activeTurnAppSessionIds: [...new Set(turns)],
    buildingDesignIds: snapshot.frames
      .filter(
        (frame) =>
          frame.build.status === 'building' ||
          (frame.build.status === 'pending' && frame.revisionId !== null),
      )
      .map((frame) => frame.designId),
  };
}

/** Leftovers of a deletion a terminated run did not finish; nothing reads them. */
export async function discardRemovedCanvases(root: string): Promise<void> {
  let names: string[];
  try {
    names = await readdir(root);
  } catch (error) {
    if (isCode(error, 'ENOENT')) return;
    throw storageFailure(REMOVE_RECOVERY, error);
  }
  for (const name of names) {
    if (name.startsWith(REMOVED_PREFIX)) await discard(join(root, name));
  }
}

export class CanvasRemoval {
  // Canvases no longer served whose directory has not left the root yet, so a
  // retry after a failed rename finishes the deletion instead of answering ok.
  private readonly unretired = new Set<string>();

  constructor(
    private readonly root: string,
    private readonly heads: CanvasHeads,
    private readonly commits: CanvasCommits,
    private readonly builds: CanvasBuilds,
  ) {}

  /** Retry-safe: a canvas that is already gone is simply gone. */
  async remove(canvasId: string): Promise<void> {
    await this.commits.admit(() => this.commits.publish(() => this.unlink(canvasId)));
    if (!this.unretired.has(canvasId)) return;
    // Mutations admitted before the head left may still be staging into its
    // directory, and an export may still be reading it; both finish first.
    await this.commits.settled();
    await exportReadsSettled(canvasId);
    const removed = await this.commits.admit(() => this.commits.run(() => this.retire(canvasId)));
    if (removed) await discard(removed);
  }

  /** Detaches every chat durably, then stops serving and building the canvas. */
  private async unlink(canvasId: string) {
    const live = this.heads.find(canvasId);
    if (!live) {
      if (this.heads.isDamaged(canvasId)) throw canvasError('storage_failed', UNREADABLE_CANVAS);
      return { value: undefined };
    }
    const next = structuredClone(live);
    next.attachedAppSessionIds = [];
    next.sequence += 1;
    next.updatedAt = Date.now();
    await this.heads.install(next, () => {
      this.commits.requireOpen();
    });
    this.heads.forget(canvasId);
    this.unretired.add(canvasId);
    for (const design of live.designs) this.builds.cancelDesign(canvasId, design.designId);
    const removedDesignIds = live.designs.map((design) => design.designId);
    return {
      value: undefined,
      change: { canvasId, sequence: next.sequence, frames: [], removedDesignIds },
    };
  }

  /** Moves the directory out of the root in one durable rename. */
  private async retire(canvasId: string): Promise<string | null> {
    if (!this.unretired.has(canvasId)) return null;
    const removed = join(this.root, `${REMOVED_PREFIX}${randomUUID()}`);
    try {
      await rename(join(this.root, canvasId), removed);
      await syncDirectory(this.root);
    } catch (error) {
      if (!isCode(error, 'ENOENT')) throw storageFailure(REMOVE_RECOVERY, error);
      this.unretired.delete(canvasId);
      return null;
    }
    this.unretired.delete(canvasId);
    return removed;
  }
}

// Already out of the root, so a failure only costs disk until the next open.
async function discard(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true }).catch((error: unknown) => {
    console.error('A deleted canvas was not cleaned up yet:', error);
  });
}

// The root belongs to the user's profile and may legitimately be a link.
async function syncDirectory(path: string): Promise<void> {
  if (process.platform === 'win32') return;
  const directory = await open(path, constants.O_RDONLY);
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

function isCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
