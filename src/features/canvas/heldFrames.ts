// The frames a hand gesture holds, outside React: where each one's hold began,
// where the hand has it now, and the lines it snapped on. The board follows the
// frames to draw them and the overlays over them; only SnapGuides reads the
// marks.

import type { SnapMarks } from './frameSnap';
import type { FrameRect } from './protocol';

export interface HeldFrame {
  designId: string;
  /** Where the hold began, which the frame stays laid out at while a transform carries it. */
  from: FrameRect;
  rect: FrameRect;
}

const NOTHING_HELD: readonly HeldFrame[] = [];

export class HeldFrames {
  private frames: readonly HeldFrame[] = NOTHING_HELD;
  private marks: SnapMarks | null = null;
  private readonly listeners = new Set<() => void>();

  /** The frames held now: the same array until the hand moves them. */
  readFrames = (): readonly HeldFrame[] => this.frames;

  /** What the held frames snapped on, or null while nothing is held. */
  readMarks = (): SnapMarks | null => this.marks;

  place(frames: readonly HeldFrame[], marks: SnapMarks): void {
    this.frames = frames;
    this.marks = marks;
    this.notify();
  }

  release(): void {
    if (this.marks === null) return;
    this.frames = NOTHING_HELD;
    this.marks = null;
    this.notify();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
