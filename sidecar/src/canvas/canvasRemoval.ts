// Explicit whole-canvas deletion (spec §7), which only the user can ask for.
// First a durable head with no attachments, marked removing so a crash before
// the rename finishes the deletion on the next open instead of reviving the
// canvas, and so no chat is left on a canvas whose source is going; then the canvas stops being served and its
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
const CHANGED_SINCE_PREVIEW =
  'That canvas changed after deleting it was reviewed. Review it again.';

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
    sequence: snapshot.sequence,
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

/** Finishes the deletions a terminated run left; nothing reads these canvases. */
export async function discardRemovedCanvases(
  root: string,
  removingIds: readonly string[],
): Promise<void> {
  for (const canvasId of removingIds) await moveOut(root, canvasId);
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
  async remove(
    canvasId: string,
    expectedSequence: number,
    expectedAttachedAppSessionIds: readonly string[],
  ): Promise<void> {
    await this.commits.admit(() =>
      this.commits.publish(() =>
        this.unlink(canvasId, expectedSequence, expectedAttachedAppSessionIds),
      ),
    );
    if (!this.unretired.has(canvasId)) return;
    // Mutations admitted before the head left may still be staging into its
    // directory, and an export may still be reading it; both finish first.
    await this.commits.settled();
    await exportReadsSettled(canvasId);
    const removed = await this.commits.admit(() => this.commits.run(() => this.retire(canvasId)));
    if (removed) await discard(removed);
  }

  /** Detaches every chat durably, then stops serving and building the canvas. */
  private async unlink(
    canvasId: string,
    expectedSequence: number,
    expectedAttachedAppSessionIds: readonly string[],
  ) {
    const live = this.heads.find(canvasId);
    if (!live) {
      if (this.heads.isDamaged(canvasId)) throw canvasError('storage_failed', UNREADABLE_CANVAS);
      return { value: undefined };
    }
    // Attaching a chat does not move the sequence, so the chats are compared too.
    if (
      live.sequence !== expectedSequence ||
      !sameMembers(live.attachedAppSessionIds, expectedAttachedAppSessionIds)
    )
      throw canvasError('revision_conflict', CHANGED_SINCE_PREVIEW);
    const next = structuredClone(live);
    next.attachedAppSessionIds = [];
    next.removing = true;
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

  private async retire(canvasId: string): Promise<string | null> {
    if (!this.unretired.has(canvasId)) return null;
    const removed = await moveOut(this.root, canvasId);
    this.unretired.delete(canvasId);
    return removed;
  }
}

/** Moves a canvas directory out of the root in one durable rename; null if already gone. */
async function moveOut(root: string, canvasId: string): Promise<string | null> {
  const removed = join(root, `${REMOVED_PREFIX}${randomUUID()}`);
  try {
    await rename(join(root, canvasId), removed);
    await syncDirectory(root);
  } catch (error) {
    if (isCode(error, 'ENOENT')) return null;
    throw storageFailure(REMOVE_RECOVERY, error);
  }
  return removed;
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

function sameMembers(left: readonly string[], right: readonly string[]): boolean {
  const members = new Set(left);
  return members.size === new Set(right).size && right.every((entry) => members.has(entry));
}

function isCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
