// What the Canvas pane is showing for one chat, and what the user has picked on
// its board. The sidecar owns the canvas and `client.ts` owns catching a board
// up with its change sequence, so the first half holds only the projection the
// pane renders; the viewport belongs to the board's own hook and the inspector
// to Task 7. The root store learns nothing but the canvas the chat ended up
// attached to.
//
// Mode and selection live here rather than inside `CanvasBoard` because the
// toolbar, the navigator and the frame menu all read them, and all three are
// the board's siblings under `CanvasWorkspace`. `mode`, `selectedFrameIds` and
// `CanvasBoardHandle.focusFrame` are the names 5d's navigator and toolbar
// consume.

import type { CanvasSnapshot } from './protocol';

export const CREATE_RECOVERY_MESSAGE = 'Canvas creation may still be in progress.';

/** The short recovery line a Canvas failure carries; never a stack trace. */
export function recoveryMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : 'Canvas could not finish that request.';
}

export type CanvasPaneState =
  // Reading which canvas this chat is attached to.
  | { status: 'opening' }
  // No canvas yet: the Create / Open saved canvas empty state.
  | { status: 'unattached'; error: string }
  // Explicit Create in flight.
  | { status: 'creating' }
  // The reply was lost or Create failed; only the same mutation may be retried.
  | { status: 'create-recovering'; message: string }
  // Attached, waiting for the first snapshot.
  | { status: 'loading'; canvasId: string }
  | { status: 'ready'; canvasId: string; snapshot: CanvasSnapshot }
  | { status: 'failed'; message: string };

export type CanvasPaneEvent =
  // The attachment as the sidecar reports it, which outranks any cached id.
  | { type: 'attached'; canvasId: string | null }
  | { type: 'created'; canvasId: string | null }
  | { type: 'selected'; canvasId: string }
  | { type: 'creating' }
  | { type: 'create-failed'; message: string }
  | { type: 'snapshot'; snapshot: CanvasSnapshot }
  | { type: 'failed'; message: string }
  | { type: 'reopened' };

/**
 * A cached attachment lets a reopened pane show its canvas instead of blinking
 * through the empty state; the sidecar is still asked, and its answer wins.
 */
export function initialCanvasPaneState(
  cachedCanvasId: string | null,
  pendingCreate = false,
): CanvasPaneState {
  if (pendingCreate) return { status: 'create-recovering', message: CREATE_RECOVERY_MESSAGE };
  return cachedCanvasId === null
    ? { status: 'opening' }
    : { status: 'loading', canvasId: cachedCanvasId };
}

/** The canvas the pane is watching, or null while it has none to watch. */
export function watchedCanvasId(state: CanvasPaneState): string | null {
  return state.status === 'loading' || state.status === 'ready' ? state.canvasId : null;
}

export function reduceCanvasPane(state: CanvasPaneState, event: CanvasPaneEvent): CanvasPaneState {
  switch (event.type) {
    case 'created':
    case 'selected':
    case 'attached': {
      if (
        event.type === 'attached' &&
        (state.status === 'creating' || state.status === 'create-recovering')
      )
        return state;
      if (event.canvasId === null)
        return state.status === 'unattached' ? state : { status: 'unattached', error: '' };
      // The answer that confirms what the pane already shows must not throw
      // away a snapshot it has since loaded.
      if (watchedCanvasId(state) === event.canvasId) return state;
      return { status: 'loading', canvasId: event.canvasId };
    }
    case 'creating':
      return { status: 'creating' };
    case 'create-failed':
      return { status: 'create-recovering', message: event.message };
    case 'snapshot': {
      const { snapshot } = event;
      if (watchedCanvasId(state) !== snapshot.canvasId) return state;
      // A resync answers with a snapshot taken before the changes already
      // applied to this projection; rolling back to it would lose them.
      if (state.status === 'ready' && snapshot.sequence <= state.snapshot.sequence) return state;
      return { status: 'ready', canvasId: snapshot.canvasId, snapshot };
    }
    case 'failed':
      return { status: 'failed', message: event.message };
    case 'reopened':
      return { status: 'opening' };
  }
}

// ── The board's mode and selection ───────────────────────────────────

/**
 * Spec §4: Select gives the board pointer ownership through a transparent
 * overlay over the guests; Interact removes it so the preview receives real
 * pointer and keyboard events.
 */
export type BoardMode = 'select' | 'interact';

export interface BoardInteraction {
  mode: BoardMode;
  /** Selected frames, in the order the user picked them. One frame per design,
   * so a frame is named by its design ID throughout. */
  selectedFrameIds: string[];
  /**
   * The one frame Interact is driving. It always holds a live preview slot, so
   * typing into a form cannot be interrupted by a frame scrolling into view.
   */
  interactedFrameId: string | null;
}

export const SELECT_MODE: BoardInteraction = {
  mode: 'select',
  selectedFrameIds: [],
  interactedFrameId: null,
};

export type BoardInteractionEvent =
  /** A click on a frame. `additive` is shift-click, which toggles membership. */
  | { type: 'pick'; designId: string; additive: boolean }
  /** A finished rubber-band. */
  | { type: 'pick-band'; designIds: string[]; additive: boolean }
  /** A click on the board background. */
  | { type: 'clear' }
  /** Double-click, or Enter on a single selected frame. */
  | { type: 'interact'; designId: string }
  | { type: 'escape' }
  /** Frames the canvas no longer has, so nothing points at a deleted design. */
  | { type: 'frames'; designIds: string[] };

/**
 * Spec §4: Escape returns to selection and Escape again clears it, so the two
 * steps out of Interact are never one. Picking while interacting moves Interact
 * to the frame picked, which keeps the live slot under the hand; picking
 * several leaves Interact, because it drives one frame.
 */
export function reduceBoardInteraction(
  state: BoardInteraction,
  event: BoardInteractionEvent,
): BoardInteraction {
  switch (event.type) {
    case 'pick': {
      const selected = event.additive
        ? toggle(state.selectedFrameIds, event.designId)
        : [event.designId];
      return settle(state, selected);
    }
    case 'pick-band': {
      const selected = event.additive
        ? [
            ...state.selectedFrameIds,
            ...event.designIds.filter((id) => !state.selectedFrameIds.includes(id)),
          ]
        : event.designIds;
      return settle(state, selected);
    }
    case 'clear':
      return settle(state, []);
    case 'interact':
      return {
        mode: 'interact',
        selectedFrameIds: [event.designId],
        interactedFrameId: event.designId,
      };
    case 'escape':
      if (state.mode === 'interact') return { ...state, mode: 'select', interactedFrameId: null };
      return state.selectedFrameIds.length === 0 ? state : settle(state, []);
    case 'frames': {
      const held = new Set(event.designIds);
      const selected = state.selectedFrameIds.filter((id) => held.has(id));
      if (
        selected.length === state.selectedFrameIds.length &&
        (state.interactedFrameId === null || held.has(state.interactedFrameId))
      )
        return state;
      return settle(state, selected);
    }
  }
}

/**
 * The state a new selection leaves, with Interact following a single frame.
 * A selection that did not actually change keeps its identity, so re-picking
 * the frame already selected costs the board nothing.
 */
function settle(state: BoardInteraction, selected: string[]): BoardInteraction {
  const interacted = state.mode === 'select' || selected.length !== 1 ? null : selected[0];
  const next: BoardInteraction = {
    mode: state.mode === 'interact' && interacted !== null ? 'interact' : 'select',
    selectedFrameIds: selected,
    interactedFrameId: interacted,
  };
  if (
    next.mode === state.mode &&
    next.interactedFrameId === state.interactedFrameId &&
    sameIds(next.selectedFrameIds, state.selectedFrameIds)
  )
    return state;
  return next;
}

function sameIds(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function toggle(ids: string[], designId: string): string[] {
  return ids.includes(designId) ? ids.filter((id) => id !== designId) : [...ids, designId];
}
