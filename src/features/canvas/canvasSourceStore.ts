// Who owns an unsaved draft. The source drawer's panel is mounted only while the
// Canvas tab is the active utility tab and the pane is open, so component state
// cannot hold a buffer: selecting another tab, hiding the pane or visiting
// Projects unmounts the panel, and the user never asked to throw their typing
// away. This store keeps one `CanvasSourceState` per canvas, outside React, and
// drops it only when the drawer is closed deliberately.
//
// It is also what makes one Save one write. The panel's state arrives
// synchronously here, so a second Save in the same event sees the first one
// already in flight instead of a batched, still-clean snapshot.

import {
  canvasSourceReducer,
  emptyCanvasSourceState,
  isSaving,
  submittedWrite,
  type CanvasSourceAction,
  type CanvasSourceState,
} from './canvasSourceState';
import type { WriteFilesInput } from './protocol';

const states = new Map<string, CanvasSourceState>();
const listeners = new Map<string, Set<() => void>>();

/** The drawer's state for one canvas, empty until it has been opened on it. */
export function readCanvasSource(canvasId: string): CanvasSourceState {
  return states.get(canvasId) ?? emptyCanvasSourceState;
}

export function dispatchCanvasSource(canvasId: string, action: CanvasSourceAction): void {
  const held = readCanvasSource(canvasId);
  const next = canvasSourceReducer(held, action);
  if (next === held) return;
  states.set(canvasId, next);
  for (const listener of listeners.get(canvasId) ?? []) listener();
}

export function subscribeCanvasSource(canvasId: string, listener: () => void): () => void {
  const held = listeners.get(canvasId) ?? new Set<() => void>();
  held.add(listener);
  listeners.set(canvasId, held);
  return () => {
    held.delete(listener);
    if (held.size === 0) listeners.delete(canvasId);
  };
}

/**
 * Submits the open frame's dirty buffers, or returns null when there is nothing
 * to write or a Save is already waiting for its outcome. The caller sends the
 * request it gets back verbatim: retrying an uncertain Save returns the same
 * `mutationId` and files, which is what lets the sidecar's ledger answer with
 * that write's own receipt rather than committing a second revision.
 */
export function beginCanvasSave(canvasId: string, mutationId: string): WriteFilesInput | null {
  if (isSaving(readCanvasSource(canvasId))) return null;
  dispatchCanvasSource(canvasId, { type: 'saving', mutationId });
  return submittedWrite(readCanvasSource(canvasId));
}

/**
 * Drops everything the drawer held for one canvas. Only the deliberate close
 * calls this — and only once the user has answered for any unsaved buffer.
 */
export function forgetCanvasSource(canvasId: string): void {
  if (!states.delete(canvasId)) return;
  for (const listener of listeners.get(canvasId) ?? []) listener();
}
