// Who hears about committed Canvas changes. Agent tools mutate the workspace
// directly, so this is the only way the pane learns about their work, and a
// subscriber that throws may cost its own change and nothing else.

import type { CanvasChange } from './protocol.js';

export type CanvasChangeListener = (change: CanvasChange) => void;

export class CanvasChangeFeed {
  private readonly listeners = new Set<CanvasChangeListener>();

  subscribe(listener: CanvasChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(change: CanvasChange): void {
    for (const listener of this.listeners) {
      try {
        listener(change);
      } catch (error) {
        console.error(`A Canvas ${change.canvasId} change listener failed:`, error);
      }
    }
  }

  /** Nothing is published after the workspace closes. */
  clear(): void {
    this.listeners.clear();
  }
}
