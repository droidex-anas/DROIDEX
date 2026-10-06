// Which Canvas mutations are still authorized. The pane registers a user scope
// for the length of one request; `CanvasTurns` registers a turn lease at the
// turn's admission seam and revokes it when that turn settles. `CanvasWorkspace`
// reads this registry through `CanvasLeaseRegistry` and concludes nothing else
// from it.

import { canvasError, EXPIRED_TURN } from './canvasError.js';
import type { CanvasLeaseRegistry } from './canvasLeases.js';
import type { CanvasScope } from './protocol.js';

export class CanvasScopes implements CanvasLeaseRegistry {
  private readonly active = new Map<string, CanvasScope>();

  /** The scope while it is still authorized, which is all a caller may act on. */
  get(scopeId: string): CanvasScope | undefined {
    return this.active.get(scopeId);
  }

  register(scope: CanvasScope): void {
    if (this.active.has(scope.scopeId))
      throw canvasError('invalid_input', 'That request identity is already running.');
    this.active.set(scope.scopeId, scope);
  }

  /** Idempotent, so a turn can revoke in every path that ends it. */
  revoke(scopeId: string): void {
    this.active.delete(scopeId);
  }

  isScopeActive(scopeId: string): boolean {
    return this.active.has(scopeId);
  }

  /**
   * Fills an unattached chat's lease with the canvas its first create minted
   * (spec §6). Only a turn lease can be unattached, and only until it is bound:
   * a second, different canvas is a bug on the workspace's side, not a request
   * to retarget the lease.
   */
  bindScopeCanvas(scopeId: string, canvasId: string): void {
    const scope = this.active.get(scopeId);
    if (!scope) throw canvasError('scope_expired', EXPIRED_TURN);
    if (scope.canvasId === canvasId) return;
    if (scope.origin === 'user' || scope.canvasId !== null)
      throw canvasError('scope_expired', 'That turn is already working on another canvas.');
    scope.canvasId = canvasId;
  }
}
