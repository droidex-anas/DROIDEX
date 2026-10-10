import type { CanvasBuilds } from './CanvasBuilds.js';
import type { CanvasScopes } from './canvasScopes.js';

/** The identity of one subscription, including while storage is still opening. */
interface CanvasWatch {
  pageId: string;
  canvasId: string;
  state: 'pending' | 'watching';
}

/**
 * Which canvases each renderer page is watching. A change on a canvas no page
 * has open is never broadcast, and one page closing its pane cannot silence
 * another page that still has the same canvas open.
 */
export class CanvasWatches {
  private readonly byPage = new Map<string, Map<string, CanvasWatch>>();

  constructor(
    private readonly builds: CanvasBuilds,
    private readonly scopes: CanvasScopes,
  ) {}

  begin(pageId: string, canvasId: string): CanvasWatch {
    const open = this.byPage.get(pageId) ?? new Map<string, CanvasWatch>();
    const watch: CanvasWatch = {
      pageId,
      canvasId,
      state: open.get(canvasId)?.state ?? 'pending',
    };
    open.set(canvasId, watch);
    this.byPage.set(pageId, open);
    return watch;
  }

  /** A cancelled or replaced subscription cannot install a watch after an await. */
  watch(watch: CanvasWatch): boolean {
    if (!this.isCurrent(watch)) return false;
    watch.state = 'watching';
    return true;
  }

  /** By page ID, because unsubscribing awaits nothing and needs no token. */
  unwatch(pageId: string, canvasId: string): void {
    if (this.byPage.get(pageId)?.delete(canvasId)) this.cancelUnowned(canvasId);
  }

  /** A page that reloaded or closed holds nothing; its watches go with it. */
  forget(pageId: string): void {
    const open = this.byPage.get(pageId);
    this.byPage.delete(pageId);
    if (!open) return;
    for (const canvasId of open.keys()) this.cancelUnowned(canvasId);
  }

  isWatched(canvasId: string): boolean {
    for (const open of this.byPage.values())
      if (open.get(canvasId)?.state === 'watching') return true;
    return false;
  }

  /** Captures owners now; a replacement pane or turn cannot revive this read. */
  rebuildAuthority(canvasId: string, designId: string): () => boolean {
    const watching: CanvasWatch[] = [];
    for (const open of this.byPage.values()) {
      const watch = open.get(canvasId);
      if (watch?.state === 'watching') watching.push(watch);
    }
    const turns = this.scopes
      .activeTurns(canvasId)
      .filter(
        (scope) => scope.allowedDesignIds === 'canvas' || scope.allowedDesignIds.includes(designId),
      );
    return () =>
      watching.some((watch) => this.isCurrent(watch)) ||
      turns.some((scope) => this.scopes.get(scope.scopeId) === scope);
  }

  private isCurrent(watch: CanvasWatch): boolean {
    return this.byPage.get(watch.pageId)?.get(watch.canvasId) === watch;
  }

  private cancelUnowned(canvasId: string): void {
    if (this.isWatched(canvasId) || this.scopes.activeTurns(canvasId).length > 0) return;
    this.builds.cancelCanvas(canvasId);
  }
}
