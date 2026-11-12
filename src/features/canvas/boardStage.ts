// The board's live view, outside React. Pan, wheel, pinch and eased moves go
// through the stage, which writes the world layer's transform and
// `--board-scale` at once; the browser draws them in the next frame. React's
// viewport takes the stage's only when a move settles, so a gesture frame
// renders nothing but the few views that follow the stage themselves.

import { useSyncExternalStore } from 'react';
import type { Viewport } from './canvasGeometry';

export class BoardStage {
  private node: HTMLElement | null = null;
  private chromeHeld = false;
  private frame: number | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(private current: Viewport) {}

  /** Where the view is now, mid-gesture included, drawn or not. */
  get viewport(): Viewport {
    return this.current;
  }

  /** Moves and draws the view now, for a caller that already runs once a frame or a move over once made. */
  moveTo(next: Viewport): void {
    this.current = next;
    this.draw();
  }

  /**
   * Moves the view now and draws it in the next animation frame, so input that
   * arrives several times a frame, as the wheel's does, is drawn once.
   */
  moveSoon(next: Viewport): void {
    this.current = next;
    this.frame ??= requestAnimationFrame(() => {
      this.frame = null;
      this.draw();
    });
  }

  /** Draws a move `moveSoon` still has waiting, as a view settling needs before React takes it. */
  flush(): void {
    if (this.frame !== null) this.draw();
  }

  /**
   * Leaves `--board-scale` where it is until `releaseChrome`, so the frame
   * chrome zooms with the frames. A wheel zoom asks for this: restyling every
   * frame's chrome at each step costs more than a 120 Hz frame has.
   */
  holdChrome(): void {
    this.chromeHeld = true;
  }

  releaseChrome(): void {
    this.chromeHeld = false;
    this.write();
  }

  /** The world layer's ref: the stage writes to it from the moment it mounts. */
  attach = (node: HTMLElement | null): void => {
    this.node = node;
    if (node) this.write();
    else this.cancelFrame();
  };

  /** Calls `listener` after each move; the call returned stops it. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private draw(): void {
    this.cancelFrame();
    this.write();
    for (const listener of this.listeners) listener();
  }

  private cancelFrame(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  private write(): void {
    if (!this.node) return;
    const { x, y, scale } = this.current;
    this.node.style.transform = `translate(${String(x)}px, ${String(y)}px) scale(${String(scale)})`;
    // The board stylesheet divides frame chrome by this, so it keeps its size.
    if (!this.chromeHeld) this.node.style.setProperty('--board-scale', String(scale));
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
