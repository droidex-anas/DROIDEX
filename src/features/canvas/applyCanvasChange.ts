import type { CanvasChange, CanvasSnapshot } from './protocol';

/**
 * The projection a change produces from the one it extends. Changed frames
 * replace their current entry in place, removed frames leave, and frames a
 * create added follow the ones the canvas already held, which is the order the
 * sidecar places them in.
 *
 * The caller owns ordering: only a change whose sequence is exactly the
 * snapshot's plus one belongs here.
 */
export function applyCanvasChange(snapshot: CanvasSnapshot, change: CanvasChange): CanvasSnapshot {
  const removed = new Set(change.removedDesignIds);
  // A removal wins over a report of the same frame: nothing on a canvas can
  // both be gone and have a current state.
  const changed = new Map(
    change.frames
      .filter((frame) => !removed.has(frame.designId))
      .map((frame) => [frame.designId, frame]),
  );
  const frames = [];
  for (const frame of snapshot.frames) {
    if (removed.has(frame.designId)) continue;
    frames.push(changed.get(frame.designId) ?? frame);
    changed.delete(frame.designId);
  }
  frames.push(...changed.values());
  return { canvasId: snapshot.canvasId, sequence: change.sequence, frames };
}
