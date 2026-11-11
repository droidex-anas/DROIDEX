// The board's live view, outside React. Pan, wheel, pinch and eased moves go
// through the stage, which writes the world layer's transform and
// `--board-scale` at once; the browser draws them in the next frame. React's
// viewport takes the stage's only when a move settles, so a gesture frame
// renders nothing but the few views that follow the stage themselves.

import { useSyncExternalStore } from 'react';
import type { Viewport } from './canvasGeometry';

export class BoardStage {
  private node: HTMLElement | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(private current: Viewport) {}

  /** Where the view is now, mid-gesture included. */
  get viewport(): Viewport {
    return this.current;
  }

  moveTo(next: Viewport): void {
    this.current = next;
    this.write();
    for (const listener of this.listeners) listener();
  }

  /** The world layer's ref: the stage writes to it from the moment it mounts. */
  attach = (node: HTMLElement | null): void => {
    this.node = node;
    this.write();
  };

  /** Calls `listener` after each move; the call returned stops it. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private write(): void {
    if (!this.node) return;
    const { x, y, scale } = this.current;
    this.node.style.transform = `translate(${String(x)}px, ${String(y)}px) scale(${String(scale)})`;
    // The board stylesheet divides frame chrome by this, so it keeps its size.
    this.node.style.setProperty('--board-scale', String(scale));
  }
}

/**
 * What `read` takes from the live view, rendered again as it changes while
 * `follow` holds; a view that need not follow reads the view as it renders.
 */
export function useStage<T>(stage: BoardStage, read: (viewport: Viewport) => T, follow = true): T {
  const snapshot = () => read(stage.viewport);
  return useSyncExternalStore(follow ? stage.subscribe : stayStill, snapshot, snapshot);
}

function stayStill(): () => void {
  return () => undefined;
}
