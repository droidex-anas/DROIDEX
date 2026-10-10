// Who hears about committed Canvas changes. Agent tools mutate the workspace
// directly, so this is the only way the pane learns about their work, and a
// subscriber that throws may cost its own change and nothing else.

import type { CanvasChange } from './protocol.js';

export type CanvasChangeListener = (change: CanvasChange) => void;

interface Subscriber {
  listener: CanvasChangeListener;
  /** Told once the feed ends, so a waiter stops waiting for a change that cannot come. */
  onClose?: () => void;
}

export class CanvasChangeFeed {
  private readonly subscribers = new Set<Subscriber>();
  private closed = false;

  subscribe(listener: CanvasChangeListener, onClose?: () => void): () => void {
    if (this.closed) {
      onClose?.();
      return () => undefined;
    }
    const subscriber = { listener, onClose };
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  publish(change: CanvasChange): void {
    for (const { listener } of this.subscribers) {
      try {
        listener(change);
      } catch (error) {
        console.error(`A Canvas ${change.canvasId} change listener failed:`, error);
      }
    }
  }

  /** Nothing is published after the workspace closes. */
  close(): void {
    this.closed = true;
    const ending = [...this.subscribers];
    this.subscribers.clear();
    for (const { onClose } of ending) onClose?.();
  }
}
