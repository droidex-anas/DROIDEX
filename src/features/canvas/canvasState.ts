// What the Canvas pane is showing for one chat. The sidecar owns the canvas and
// `client.ts` owns catching a board up with its change sequence, so this holds
// only the projection the pane renders. Viewport, selection and inspector state
// belong to the board (Task 5b onwards); the root store learns nothing but the
// canvas the chat ended up attached to.

import type { CanvasSnapshot } from './protocol';

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
  | { type: 'created'; canvasId: string }
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
export function initialCanvasPaneState(cachedCanvasId: string | null): CanvasPaneState {
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
