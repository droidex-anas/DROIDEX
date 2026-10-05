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
  // The canvas each unattached lease bootstrapped, recorded only once the
  // registry callback returned. A lease keeps the canvas it created: it may not
  // bootstrap a second one, and the registry is not assumed to tolerate a
  // second call.
  private readonly bound = new Map<string, string>();

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
    return this.requireCanvas(scope, canvasId);
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
   * The canvas an unattached lease already bootstrapped, if it did. Its chat
   * has to still be on that canvas: a lease neither follows the chat elsewhere
   * nor bootstraps a replacement for a canvas the chat has left.
   */
  boundCanvas(scope: CanvasScope): string | null {
    const canvasId = this.bound.get(scope.scopeId);
    if (canvasId === undefined) return null;
    if (this.heads.attachedCanvasId(scope.appSessionId) !== canvasId)
      throw canvasError('scope_expired', 'That chat has left the canvas this turn created.');
    return canvasId;
  }

  /**
   * Fills an unattached lease's canvas binding, once and only while the lease
   * is live. A revoked lease keeps a complete attached canvas with no binding:
   * nothing it could still authorize is left to bind for.
   */
  bind(scope: CanvasScope, canvasId: string): void {
    for (const scopeId of [...this.bound.keys()]) {
      if (!this.registry.isScopeActive(scopeId)) this.bound.delete(scopeId);
    }
    if (this.bound.get(scope.scopeId) === canvasId) return;
    if (!this.registry.isScopeActive(scope.scopeId)) return;
    // Recorded only once the callback returned: a binding that threw has not
    // happened, and the retry that answers that receipt attempts it again.
    this.registry.bindScopeCanvas(scope.scopeId, canvasId);
    this.bound.set(scope.scopeId, canvasId);
  }

  /** Nothing can retry under a lease once the workspace has closed. */
  forget(): void {
    this.bound.clear();
  }
}
