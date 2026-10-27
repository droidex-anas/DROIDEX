// The board a canvas pane shows and what is selected on it. The canvas menu
// reads it from outside the pane's tree: expanded, the menu sits in the
// window's header (`CanvasHeader`), which App renders apart from the pane.

import { useSyncExternalStore } from 'react';
import type { CanvasFrame } from './protocol';

export interface BoardOnScreen {
  appSessionId: string;
  canvasId: string;
  /** The pane's chat is attached to this canvas, so it can add frames to it. */
  attached: boolean;
  /** Every frame on the board, in the canvas's order. */
  frames: readonly CanvasFrame[];
  /** The selected frames, in the order the user picked them. */
  selected: CanvasFrame[];
  focusFrame: (designId: string) => void;
}

const boards = new Map<string, BoardOnScreen>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Shows `board` until the returned cleanup runs; a later pane on the same canvas replaces it. */
export function showBoard(board: BoardOnScreen): () => void {
  boards.set(board.canvasId, board);
  notify();
  return () => {
    if (boards.get(board.canvasId) !== board) return;
    boards.delete(board.canvasId);
    notify();
  };
}

export function useBoardOnScreen(canvasId: string | null): BoardOnScreen | null {
  return useSyncExternalStore(subscribe, () =>
    canvasId === null ? null : (boards.get(canvasId) ?? null),
  );
}
