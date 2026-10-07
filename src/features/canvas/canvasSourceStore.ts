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
  type CanvasSourceAction,
  type CanvasSourceState,
} from './canvasSourceState';
import { CanvasRequestError } from './client';
import type { WriteFilesInput, WriteReceipt } from './protocol';

const states = new Map<string, { state: CanvasSourceState }>();
const listeners = new Map<string, Set<() => void>>();

/** The drawer's state for one canvas, empty until it has been opened on it. */
export function readCanvasSource(canvasId: string): CanvasSourceState {
  return states.get(canvasId)?.state ?? emptyCanvasSourceState;
}

export function dispatchCanvasSource(canvasId: string, action: CanvasSourceAction): void {
  const held = readCanvasSource(canvasId);
  const next = canvasSourceReducer(held, action);
  if (next === held) return;
  const lifetime = states.get(canvasId);
  if (lifetime) lifetime.state = next;
  else states.set(canvasId, { state: next });
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
 * Owns execution independently of panel mounts. Both the canvas lifetime and the
 * submitted operation must still match before a callback can settle anything.
 */
export async function saveCanvasSource(
  canvasId: string,
  mutationId: string,
  writeSource: (canvasId: string, write: WriteFilesInput) => Promise<WriteReceipt>,
): Promise<void> {
  const lifetime = states.get(canvasId);
  if (!lifetime || isSaving(lifetime.state)) return;
  const next = canvasSourceReducer(lifetime.state, { type: 'saving', mutationId });
  const operation = next.save;
  if (operation?.status !== 'saving') return;
  lifetime.state = next;
  const isCurrent = () => states.get(canvasId) === lifetime && lifetime.state.save === operation;
  for (const listener of listeners.get(canvasId) ?? []) listener();
  if (!isCurrent()) return;
  try {
    const receipt = await writeSource(canvasId, operation.write);
    if (isCurrent())
      dispatchCanvasSource(canvasId, { type: 'saved', revisionId: receipt.revisionId });
  } catch (error: unknown) {
    if (!isCurrent()) return;
    dispatchCanvasSource(canvasId, {
      type: error instanceof CanvasRequestError ? 'saveRefused' : 'saveFailed',
      message:
        error instanceof Error && error.message.length > 0
          ? error.message
          : 'That save’s outcome is unknown. Try that save again.',
    });
  }
}

/**
 * Drops everything the drawer held for one canvas. Only the deliberate close
 * calls this — and only once the user has answered for any unsaved buffer.
 */
export function forgetCanvasSource(canvasId: string): void {
  if (!states.delete(canvasId)) return;
  for (const listener of listeners.get(canvasId) ?? []) listener();
}
