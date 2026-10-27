// The board's keyboard: what one key press on the board, a frame's label or
// the board's own tools does. The board supplies its state and the actions a
// key can take; the meaning of each key lives in boardKeys.ts.

import type { KeyboardEvent } from 'react';
import {
  frameHeaderOf,
  frameStep,
  isBoardControl,
  isBoardEditor,
  modeShortcut,
  zoomShortcut,
} from './boardKeys';
import type { ZoomCommand } from './BoardControls';
import { arrowDirection, nudgeStep, type Point } from './canvasGeometry';
import type { BoardInteraction, BoardInteractionEvent, BoardMode } from './canvasState';

/** Board-local pixels one arrow key pans by when nothing is selected. */
const ARROW_PAN_PX = 32;

export interface BoardKeyActions {
  interaction: BoardInteraction;
  /** The frames in reading order, which the arrows walk on a label. */
  order: readonly string[];
  dispatch: (event: BoardInteractionEvent) => void;
  /** Ends a gesture or puts down an annotation tool; true when there was one. */
  cancel: () => boolean;
  annotationKey: (event: KeyboardEvent) => boolean;
  /** Edit's own keys, on the frame the keyboard is on or the one selected. */
  editKey: (event: KeyboardEvent, designId: string | null) => boolean;
  zoom: (command: ZoomCommand) => void;
  setMode: (mode: BoardMode) => void;
  holdSpace: () => void;
  /** Pans by board-local pixels. */
  pan: (delta: Point) => void;
  /** Moves the selected frames by world units. */
  nudge: (step: Point) => void;
  focusBoard: () => void;
  focusLabel: (designId: string) => void;
}

export function onBoardKeyDown(event: KeyboardEvent<HTMLDivElement>, actions: BoardKeyActions) {
  // Inputs and editors keep their shortcuts, including Escape.
  if (isBoardEditor(event.target)) return;
  const header = frameHeaderOf(event.target);
  // Board commands belong to the board and its frame labels. Its own tools take
  // the zoom and mode keys too, so a key still works after one was clicked;
  // Space, Enter and the arrows stay theirs.
  const onBoard = event.target === event.currentTarget || header !== null;
  let handled = false;
  if (event.key === 'Escape') {
    escape(header, actions);
    handled = true;
  } else if (onBoard || isBoardControl(event.target)) {
    handled =
      runShortcut(event, actions) ||
      actions.annotationKey(event) ||
      (onBoard &&
        (actions.editKey(event, header ?? soleSelection(actions.interaction)) ||
          runBoardKey(event, header, actions)));
  }
  if (handled) event.preventDefault();
}

function soleSelection({ selectedFrameIds }: BoardInteraction): string | null {
  return selectedFrameIds.length === 1 ? selectedFrameIds[0] : null;
}

/** Escape: a gesture first, then a tool, mode or selection; from a frame in Select, back to the board. */
function escape(header: string | null, actions: BoardKeyActions) {
  if (actions.cancel()) return;
  actions.dispatch({ type: 'escape' });
  if (header !== null && actions.interaction.mode === 'select') actions.focusBoard();
}

/** The zoom and mode keys, which the board's own tools take as well. */
function runShortcut(event: KeyboardEvent, actions: BoardKeyActions): boolean {
  const zoom = zoomShortcut(event);
  if (zoom) actions.zoom(zoom);
  const mode = zoom ? null : modeShortcut(event);
  if (mode) actions.setMode(mode);
  return zoom !== null || mode !== null;
}

/**
 * A key on the board or a frame's label. On a label the arrows, Home and End
 * move to another frame and select it, so Enter acts on the frame the
 * keyboard is on; there ⌥ and the arrows move the selection instead.
 */
function runBoardKey(
  event: KeyboardEvent,
  header: string | null,
  actions: BoardKeyActions,
): boolean {
  const { interaction } = actions;
  const next = header === null ? null : frameStep(event, actions.order, header);
  if (next !== null) {
    if (next !== header) {
      actions.dispatch({ type: 'pick', designId: next, additive: false });
      actions.focusLabel(next);
    }
    return true;
  }
  if (event.key === ' ') {
    actions.holdSpace();
    return true;
  }
  if (event.key === 'Enter' && interaction.selectedFrameIds.length === 1) {
    actions.dispatch({ type: 'interact', designId: interaction.selectedFrameIds[0] });
    return true;
  }
  const direction = arrowDirection(event.key);
  if (!direction || (header !== null && !event.altKey)) return false;
  if (interaction.selectedFrameIds.length === 0) {
    actions.pan({ x: -direction.x * ARROW_PAN_PX, y: -direction.y * ARROW_PAN_PX });
    return true;
  }
  actions.nudge(nudgeStep(direction, event.shiftKey));
  return true;
}
