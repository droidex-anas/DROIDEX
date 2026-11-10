// The board a canvas pane shows and what is selected on it. The canvas menu
// reads it from outside the pane's tree: expanded, the menu sits in the
// window's header (`CanvasHeader`), which App renders apart from the pane, and
// App sizes the chat column by the columns docked beside the board.

import { useSyncExternalStore } from 'react';
import type { CanvasFrame } from './protocol';

export interface BoardOnScreen {
  appSessionId: string;
  canvasId: string;
  /** The pane's chat is attached to this canvas, so it can add frames to it. */
  attached: boolean;
  /** The pane's chat has a turn running, so a frame with no source is being written. */
  agentWorking: boolean;
  /** Every frame on the board, in the canvas's order. */
  frames: readonly CanvasFrame[];
  /** The selected frames, in the order the user picked them. */
  selected: CanvasFrame[];
  focusFrame: (designId: string) => void;
  /** Columns docked beside the board, each `w-sidebar` wide: Layers and Edit's element panel. */
  sideColumns: number;
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

/** The columns docked beside the board a chat's canvas pane shows; 0 without one. */
export function useSideColumns(appSessionId: string | null): number {
  return useSyncExternalStore(subscribe, () => {
    for (const board of boards.values()) {
      if (board.appSessionId === appSessionId) return board.sideColumns;
    }
    return 0;
  });
}

export function useBoardOnScreen(canvasId: string | null): BoardOnScreen | null {
  return useSyncExternalStore(subscribe, () =>
    canvasId === null ? null : (boards.get(canvasId) ?? null),
  );
}
