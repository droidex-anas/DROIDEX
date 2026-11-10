// Where an element shows on the board: the frame it is drawn in, and its box
// there trimmed to the frame, where the design is visible. The outlines are
// drawn from these boxes, and Alt's distances keep clear of the chips under them.

import type { PlacedFrame } from './canvasGeometry';
import { isDrawn } from './previewDocument';
import type { FrameRect } from './protocol';
import type { ElementSelection } from './useElementEditor';

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Where Edit's picked element shows: its frame, and its box there trimmed to the frame. */
export interface PickedOnBoard {
  selection: ElementSelection;
  frame: FrameRect;
  box: Box;
}

/** Null when the picked element is hidden, or none of it shows in its frame. */
export function pickedOnBoard(
  drawn: readonly PlacedFrame[],
  selection: ElementSelection | null,
): PickedOnBoard | null {
  // A hidden element has no box to outline; the panel says it is hidden.
  if (!selection || !isDrawn(selection.shown.rect)) return null;
  const shown = onBoard(drawn, selection.draft.element.designId, selection.shown.rect);
  return shown && { selection, ...shown };
}

/** The frame an element is drawn in and its visible box there, if any of it shows. */
export function onBoard(drawn: readonly PlacedFrame[], designId: string, element: FrameRect) {
  const frame = drawn.find((placed) => placed.designId === designId)?.rect;
  const box = frame && inFrame(frame, element);
  return frame && box ? { frame, box } : null;
}

/**
 * An element's box inside its frame, trimmed to it; null when none of it is
 * visible, as when it only touches the frame's edge from outside. An element
 * with no width or height of its own still shows as a line.
 */
function inFrame(frame: FrameRect, element: FrameRect): Box | null {
  const left = Math.max(element.x, 0);
  const top = Math.max(element.y, 0);
  const width = Math.min(element.x + element.width, frame.width) - left;
  const height = Math.min(element.y + element.height, frame.height) - top;
  const trimmedAway = (shown: number, own: number) => shown < 0 || (shown === 0 && own > 0);
  if (trimmedAway(width, element.width) || trimmedAway(height, element.height)) return null;
  return { left, top, width, height };
}
