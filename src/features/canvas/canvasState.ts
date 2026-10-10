import type { CanvasFrame, CanvasSnapshot } from './protocol';

export type CanvasPaneState =
  // Reading which canvas this chat is attached to.
  | { status: 'opening' }
  // No canvas yet: the Create / Open saved canvas empty state.
  // `outdatedName` is a canvas an earlier DROIDEX made for this chat, which
  // this one cannot open: the pane says so instead of looking new.
  | { status: 'unattached'; error: string; outdatedName?: string }
  // Explicit Create or an attach the user asked for, in flight.
  | { status: 'attaching' }
  // The reply was lost or the attachment failed; `canvasChats` retains the
  // operation, so Try again replays exactly it.
  | { status: 'attach-recovering'; message: string }
  // Attached, waiting for the first snapshot.
  | { status: 'loading'; canvasId: string }
  | {
      status: 'ready';
      canvasId: string;
      snapshot: CanvasSnapshot;
      /** The frame the source drawer is open on, or null while it is closed. */
      sourceDesignId: string | null;
    }
  | { status: 'failed'; message: string };

export type CanvasPaneEvent =
  // The attachment as the sidecar reports it, which outranks any cached id.
  | { type: 'attached'; canvasId: string | null; outdatedName?: string }
  | { type: 'settled'; canvasId: string | null }
  | { type: 'selected'; canvasId: string }
  | { type: 'attaching' }
  | { type: 'attach-failed'; message: string }
  | { type: 'snapshot'; snapshot: CanvasSnapshot }
  | { type: 'failed'; message: string }
  | { type: 'reopened' }
  // The toolbar's Source action (Task 5d binds it) and the drawer closing.
  | { type: 'open-source'; designId: string }
  | { type: 'close-source' };

/** The event the toolbar's Source action dispatches for one frame. */
export function openSourcePanel(designId: string): CanvasPaneEvent {
  return { type: 'open-source', designId };
}

/** The frame whose source the drawer is showing, or null while it is closed. */
export function openSourceFrame(state: CanvasPaneState): CanvasFrame | null {
  if (state.status !== 'ready' || state.sourceDesignId === null) return null;
  return state.snapshot.frames.find((frame) => frame.designId === state.sourceDesignId) ?? null;
}

/**
 * A cached attachment lets a reopened pane show its canvas instead of blinking
 * through the empty state; the sidecar is still asked, and its answer wins. An
 * attachment this chat still owes outranks the cache: the pane has to offer its
 * recovery rather than a second Create.
 */
export function initialCanvasPaneState(
  cachedCanvasId: string | null,
  owedMessage: string | null = null,
): CanvasPaneState {
  if (owedMessage !== null) return { status: 'attach-recovering', message: owedMessage };
  return cachedCanvasId === null
    ? { status: 'opening' }
    : { status: 'loading', canvasId: cachedCanvasId };
}

/** The canvas the pane is watching, or null while it has none to watch. */
export function watchedCanvasId(state: CanvasPaneState): string | null {
  return state.status === 'loading' || state.status === 'ready' ? state.canvasId : null;
}

/**
 * A canvas an earlier DROIDEX made cannot open. Its name is often the chat's
 * whole first prompt, so only its start is quoted.
 */
export function outdatedCanvasMessage(name: string): string {
  const shown = name.length > 48 ? `${name.slice(0, 47).trimEnd()}…` : name;
  return `“${shown}” was made by an earlier DROIDEX and can’t be opened here.`;
}

/** No canvas to show: an earlier error stays, and an outdated canvas is named. */
function unattached(state: CanvasPaneState, event: CanvasPaneEvent): CanvasPaneState {
  const outdatedName = event.type === 'attached' ? event.outdatedName : undefined;
  if (state.status !== 'unattached')
    return { status: 'unattached', error: '', ...(outdatedName ? { outdatedName } : {}) };
  return outdatedName === undefined || state.outdatedName === outdatedName
    ? state
    : { ...state, outdatedName };
}

export function reduceCanvasPane(state: CanvasPaneState, event: CanvasPaneEvent): CanvasPaneState {
  switch (event.type) {
    case 'settled':
    case 'selected':
    case 'attached': {
      if (
        event.type === 'attached' &&
        (state.status === 'attaching' || state.status === 'attach-recovering')
      )
        return state;
      if (event.canvasId === null) return unattached(state, event);
      // The answer that confirms what the pane already shows must not throw
      // away a snapshot it has since loaded.
      if (watchedCanvasId(state) === event.canvasId) return state;
      return { status: 'loading', canvasId: event.canvasId };
    }
    case 'attaching':
      return { status: 'attaching' };
    case 'attach-failed':
      return { status: 'attach-recovering', message: event.message };
    case 'snapshot': {
      const { snapshot } = event;
      if (watchedCanvasId(state) !== snapshot.canvasId) return state;
      // A resync answers with a snapshot taken before the changes already
      // applied to this projection; rolling back to it would lose them.
      if (state.status === 'ready' && snapshot.sequence <= state.snapshot.sequence) return state;
      return {
        status: 'ready',
        canvasId: snapshot.canvasId,
        snapshot,
        sourceDesignId: keptSourceDesignId(state, snapshot),
      };
    }
    case 'failed':
      return { status: 'failed', message: event.message };
    case 'reopened':
      return { status: 'opening' };
    case 'open-source':
    case 'close-source': {
      if (state.status !== 'ready') return state;
      const designId = event.type === 'open-source' ? event.designId : null;
      return { ...state, sourceDesignId: designId };
    }
  }
}

/**
 * The drawer's frame across one change: it follows that frame wherever the board
 * puts it, and closes only once the frame is gone.
 */
function keptSourceDesignId(state: CanvasPaneState, snapshot: CanvasSnapshot): string | null {
  const open = state.status === 'ready' ? state.sourceDesignId : null;
  if (open === null) return null;
  return snapshot.frames.some((frame) => frame.designId === open) ? open : null;
}

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
