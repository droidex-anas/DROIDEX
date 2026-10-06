// What one turn's lease authorizes, and the canvas an unattached lease
// bootstrapped. Task 4 owns the registry behind these two callbacks; this
// module owns what the workspace is allowed to conclude from them.

import { canvasError } from './canvasError.js';
import { UNREADABLE_CANVAS, type CanvasHeads } from './canvasHeads.js';
import type { CanvasManifest } from './canvasManifest.js';
import type { CanvasScope } from './protocol.js';

export interface CanvasLeaseRegistry {
  /** False once the owning turn settled or its provider session was replaced. */
  isScopeActive(scopeId: string): boolean;
  /** Fills an unattached chat's lease with the canvas its first create minted. */
  bindScopeCanvas(scopeId: string, canvasId: string): void;
}

const EXPIRED_TURN = 'That request belongs to a turn that already ended.';

export class CanvasLeases {
  // The canvas each unattached lease bootstrapped, recorded as soon as the
  // commit made it real. A lease keeps the canvas it created and may not
  // bootstrap a second one.
  private readonly pinned = new Map<string, string>();
  // Which of those the registry has been told about. Separate from the pin
  // because a refused notification has to stay retryable without letting the
  // lease drift to another canvas in the meantime.
  private readonly notified = new Set<string>();

  constructor(
    private readonly registry: CanvasLeaseRegistry,
    private readonly heads: CanvasHeads,
  ) {}

  /** Whether a lease still lives, as a value retention can carry around. */
  readonly isActive = (scopeId: string): boolean => this.registry.isScopeActive(scopeId);

  requireActive(scope: CanvasScope): void {
    if (!this.registry.isScopeActive(scope.scopeId))
      throw canvasError('scope_expired', EXPIRED_TURN);
  }

  /** The canvas this lease names; one for a canvas we do not hold is stale. */
  requireScopedCanvas(scope: CanvasScope): CanvasManifest {
    const canvasId = scope.canvasId;
    if (canvasId === null)
      throw canvasError('invalid_input', 'This chat has no canvas yet. Create a frame first.');
    const manifest = this.requireCanvas(scope, canvasId);
    this.requireAttachment(scope, canvasId);
    return manifest;
  }

  /** The named canvas, under a lease that has to be live to touch it. */
  requireCanvas(scope: CanvasScope, canvasId: string): CanvasManifest {
    this.requireActive(scope);
    const manifest = this.heads.find(canvasId);
    if (manifest) return manifest;
    if (this.heads.isDamaged(canvasId)) throw canvasError('storage_failed', UNREADABLE_CANVAS);
    throw canvasError('scope_expired', 'That request names a canvas this workspace does not hold.');
  }

  requireDesigns(scope: CanvasScope, designIds: readonly string[]): CanvasManifest {
    const manifest = this.requireScopedCanvas(scope);
    const allowed = scope.allowedDesignIds;
    if (allowed === 'canvas') return manifest;
    for (const designId of designIds) {
      if (!allowed.includes(designId))
        throw canvasError('scope_expired', 'That frame is outside this turn’s assigned frames.');
    }
    return manifest;
  }

  /**
   * The one canvas a lease works on: its own, else the one it bootstrapped,
   * else its chat's current attachment. A lease that bootstrapped a canvas
   * keeps it, so a chat that moves makes the lease stale rather than
   * retargeting it at whichever canvas the chat is on now.
   */
  pinnedCanvas(scope: CanvasScope): string | null {
    return (
      scope.canvasId ??
      this.pinned.get(scope.scopeId) ??
      this.heads.attachedCanvasId(scope.appSessionId)
    );
  }

  /**
   * Who may only act where their chat still is: a turn lease that bootstrapped
   * its canvas, and every pane mutation, whose whole authority is the
   * attachment. A turn lease pinned to a canvas when it was minted keeps that
   * canvas wherever its chat goes. Checked again inside the commit, because a
   * chat can leave while a write is still staging its source.
   */
  requireAttachment(scope: CanvasScope, canvasId: string): void {
    if (scope.origin === 'turn' && scope.canvasId !== null) return;
    if (this.heads.attachedCanvasId(scope.appSessionId) !== canvasId)
      throw canvasError('scope_expired', 'That chat has left the canvas this request belongs to.');
  }

  /**
   * Records the canvas an unattached lease's commit made real. This happens
   * before the registry hears about it, so a refused notification leaves the
   * lease pinned: its retry answers for that canvas instead of following the
   * chat to whichever canvas it is on by then.
   */
  pin(scope: CanvasScope, canvasId: string): void {
    const pinned = this.pinned.get(scope.scopeId);
    if (pinned === canvasId) return;
    // A lease has one canvas. A second, different one is a bug on this side,
    // not a request to retarget the lease.
    if (pinned !== undefined)
      throw canvasError('scope_expired', 'That turn is already working on another canvas.');
    for (const scopeId of [...this.pinned.keys()]) {
      if (this.registry.isScopeActive(scopeId)) continue;
      this.pinned.delete(scopeId);
      this.notified.delete(scopeId);
    }
    this.pinned.set(scope.scopeId, canvasId);
  }

  /**
   * Pins that canvas and tells the registry about it, once. A revoked lease is
   * pinned but never announced: it keeps a complete attached canvas with no
   * binding, because nothing it could still authorize is left.
   */
  claim(scope: CanvasScope, canvasId: string): void {
    this.pin(scope, canvasId);
    if (this.notified.has(scope.scopeId)) return;
    if (!this.registry.isScopeActive(scope.scopeId)) return;
    // Marked done only once the callback returned: a notification that threw
    // has not happened, and the next retry attempts it again.
    this.registry.bindScopeCanvas(scope.scopeId, canvasId);
    this.notified.add(scope.scopeId);
  }

  /** Nothing can retry under a lease once the workspace has closed. */
  forget(): void {
    this.pinned.clear();
    this.notified.clear();
  }
}
