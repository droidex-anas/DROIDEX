// Delete on the board: the selected frames go through the board's removal
// write, and once they are gone the keyboard moves to the frame beside them,
// so a reader is never left on nothing.

import { useEffect, useRef, type RefObject } from 'react';
import type { BoardInteraction, BoardInteractionEvent } from './canvasState';
import type { CanvasFrame } from './protocol';

export function useFrameRemoval({
  board,
  canvasId,
  frames,
  order,
  interaction,
  dispatch,
  focusLabel,
  onRemoveFrames,
}: {
  board: RefObject<HTMLElement | null>;
  canvasId: string;
  frames: readonly CanvasFrame[];
  /** The frames in reading order, which picks the neighbour. */
  order: readonly string[];
  interaction: BoardInteraction;
  dispatch: (event: BoardInteractionEvent) => void;
  focusLabel: (designId: string) => void;
  onRemoveFrames: (frames: CanvasFrame[]) => Promise<boolean>;
}): () => boolean {
  // What a removal reads once it settles, to tell whether the user moved on.
  const settled = useRef<SettledReads>({ canvasId, frames, selected: [] });
  settled.current = { canvasId, frames, selected: interaction.selectedFrameIds };
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  return () => {
    const { mode, selectedFrameIds } = interaction;
    // A selected mark never sits beside selected frames; it takes Delete itself.
    if (mode !== 'select') return false;
    const removing = frames.filter((frame) => selectedFrameIds.includes(frame.designId));
    if (removing.length === 0) return false;
    const removedIds = removing.map((frame) => frame.designId);
    const neighbour = neighbourOf(order, removedIds);
    void onRemoveFrames(removing).then((removed) => {
      const now = settled.current;
      if (!removed || neighbour === null || !mounted.current || now.canvasId !== canvasId) return;
      // A selection or focus the user chose meanwhile is theirs to keep.
      if (!now.selected.every((designId) => removedIds.includes(designId))) return;
      if (!keyboardOn(board.current)) return;
      if (!now.frames.some((frame) => frame.designId === neighbour)) return;
      dispatch({ type: 'pick', designId: neighbour, additive: false });
      focusLabel(neighbour);
    });
    return true;
  };
}

interface SettledReads {
  canvasId: string;
  frames: readonly CanvasFrame[];
  selected: readonly string[];
}

/** The next frame on in reading order after the removed ones, else the one before them. */
function neighbourOf(order: readonly string[], removedIds: readonly string[]): string | null {
  const kept = (designId: string) => !removedIds.includes(designId);
  const last = Math.max(...removedIds.map((designId) => order.indexOf(designId)));
  const after = order.slice(last + 1).find(kept);
  return after ?? order.slice(0, last).reverse().find(kept) ?? null;
}

/** Focus is still on the board, or was dropped to the page when the focused frame left. */
function keyboardOn(board: HTMLElement | null): boolean {
  const active = document.activeElement;
  if (!board) return false;
  return active === null || active === document.body || board.contains(active);
}
