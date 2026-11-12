// The frames a hand gesture holds, drawn outside React. React learns only when
// a hold begins and ends, which is when a held frame hides its toolbar and
// takes the grabbing cursor, and keeps drawing each frame where its hold began.
// Every move between draws straight into the page: each held frame's place
// and size, its size chip's text, a translate on the overlays that follow it
// (`data-follows-frame`), and the snap marks, which go to SnapGuides. Letting
// go puts back what React drew, so the commit that places the frames starts
// from it.

import { frameSizeLabel } from './canvasGeometry';
import type { SnapMarks } from './frameSnap';
import type { FrameRect } from './protocol';

export interface HeldFrame {
  designId: string;
  /** Where the hold began, which React keeps the frame drawn at until it ends. */
  from: FrameRect;
  rect: FrameRect;
}

const NOTHING_HELD: readonly string[] = [];
const NO_MARKS: SnapMarks = { guides: [], gaps: [] };

export class HeldFrames {
  private heldIds: readonly string[] = NOTHING_HELD;
  private frames: readonly HeldFrame[] = [];
  private marks: SnapMarks | null = null;
  private board: HTMLElement | null = null;
  /** The overlays a move gave a translate, which letting go takes off again. */
  private readonly moved = new Set<HTMLElement>();
  private readonly listeners = new Set<() => void>();
  private readonly markListeners = new Set<() => void>();

  /** The frames held now, by design ID: the same array from a hold's start to its end. */
  readHeld = (): readonly string[] => this.heldIds;

  /** What the held frames snapped on, or null while nothing is held. */
  readMarks = (): SnapMarks | null => this.marks;

  /** Holds `frames`, drawn on `board`, where they are now. */
  hold(board: HTMLElement, frames: readonly HeldFrame[]): void {
    this.board = board;
    this.frames = frames;
    this.marks = NO_MARKS;
    this.heldIds = frames.map(({ designId }) => designId);
    this.notify(this.listeners);
    this.notify(this.markListeners);
  }

  /** Draws the held frames where the hand has them now, and what they snapped on. */
  move(frames: readonly HeldFrame[], marks: SnapMarks): void {
    if (this.board === null) return;
    this.frames = frames;
    this.marks = marks;
    this.draw(this.board);
    this.notify(this.markListeners);
  }

  release(): void {
    if (this.board === null) return;
    this.restore(this.board);
    this.board = null;
    this.frames = [];
    this.marks = null;
    this.heldIds = NOTHING_HELD;
    this.notify(this.listeners);
    this.notify(this.markListeners);
  }

  /** Calls `listener` as a hold begins and ends; the call returned stops it. */
  subscribe = (listener: () => void): (() => void) => listen(this.listeners, listener);

  /** Calls `listener` whenever the marks change; the call returned stops it. */
  onMarks = (listener: () => void): (() => void) => listen(this.markListeners, listener);

  private draw(board: HTMLElement): void {
    const offsets = new Map<string, string>();
    for (const { designId, from, rect } of this.frames) {
      const offset = `${String(rect.x - from.x)}px ${String(rect.y - from.y)}px`;
      offsets.set(designId, offset);
      const root = frameRoot(board, designId);
      if (root) drawRect(root, rect);
    }
    for (const follower of board.querySelectorAll<HTMLElement>('[data-follows-frame]')) {
      const offset = follower.dataset.followsFrame
        ?.split(' ')
        .map((designId) => offsets.get(designId))
        .find((each) => each !== undefined);
      if (offset !== undefined) this.shift(follower, offset);
    }
  }

  private shift(element: HTMLElement, offset: string): void {
    element.style.translate = offset;
    this.moved.add(element);
  }

  private restore(board: HTMLElement): void {
    for (const element of this.moved) element.style.translate = '';
    this.moved.clear();
    for (const { designId, from } of this.frames) {
      const root = frameRoot(board, designId);
      if (root) drawRect(root, from);
    }
  }

  private notify(listeners: ReadonlySet<() => void>): void {
    for (const listener of listeners) listener();
  }
}

function listen(listeners: Set<() => void>, listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function frameRoot(board: HTMLElement, designId: string): HTMLElement | null {
  return board.querySelector<HTMLElement>(`[data-design-frame="${CSS.escape(designId)}"]`);
}

/**
 * Places the frame by its offsets, never a transform: a transform would make
 * the frame a stacking context, trapping its size chip and corners under any
 * neighbour drawn after it.
 */
function drawRect(root: HTMLElement, rect: FrameRect): void {
  root.style.left = `${String(rect.x)}px`;
  root.style.top = `${String(rect.y)}px`;
  root.style.width = `${String(rect.width)}px`;
  root.style.height = `${String(rect.height)}px`;
  // The text node React rendered, so its next render still finds and updates it.
  const text = root.querySelector('[data-frame-size-text]')?.firstChild;
  const label = frameSizeLabel(rect);
  if (text && text.nodeValue !== label) text.nodeValue = label;
}
