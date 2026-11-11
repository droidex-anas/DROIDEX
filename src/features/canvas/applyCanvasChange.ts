import type { CanvasChange, CanvasFrame, CanvasSnapshot } from './protocol';

/**
 * The projection a change produces from the one it extends. Changed frames
 * replace their current entry in place, removed frames leave, and frames a
 * create added follow the ones the canvas already held, which is the order the
 * sidecar places them in. A reorder's `order` then restacks the frames.
 * Annotations follow the same rule, and only a change that carries them moves
 * the annotation layer. A frame keeps the build it has, the same object, until
 * a change sends a new one.
 *
 * The caller owns ordering: only a change whose sequence is exactly the
 * snapshot's plus one belongs here.
 */
export function applyCanvasChange(snapshot: CanvasSnapshot, change: CanvasChange): CanvasSnapshot {
  const layer = change.annotations;
  return {
    canvasId: snapshot.canvasId,
    sequence: change.sequence,
    frames: stacked(
      merged(
        snapshot.frames,
        changedFrames(snapshot.frames, change),
        change.removedDesignIds,
        (frame) => frame.designId,
      ),
      change.order,
    ),
    annotationsVersion: layer ? layer.version : snapshot.annotationsVersion,
    annotations: layer
      ? merged(
          snapshot.annotations,
          layer.upserted,
          layer.removedIds,
          (annotation) => annotation.id,
        )
      : snapshot.annotations,
  };
}

/** The frames a change touched, each with the build it sent or else the one it had. */
function changedFrames(current: readonly CanvasFrame[], change: CanvasChange): CanvasFrame[] {
  const known = new Map(current.map((frame) => [frame.designId, frame]));
  const builds = new Map(change.builds.map(({ designId, build }) => [designId, build]));
  // The sidecar sends a frame new to the canvas with its build, so each has one.
  const changed = change.frames.flatMap((fields) => {
    const build = builds.get(fields.designId) ?? known.get(fields.designId)?.build;
    return build ? [{ ...fields, build }] : [];
  });
  const named = new Set(change.frames.map((fields) => fields.designId));
  for (const [designId, build] of builds) {
    const frame = known.get(designId);
    if (frame && !named.has(designId)) changed.push({ ...frame, build });
  }
  return changed;
}

function merged<Entry>(
  current: readonly Entry[],
  changed: readonly Entry[],
  removedIds: readonly string[],
  idOf: (entry: Entry) => string,
): Entry[] {
  const removed = new Set(removedIds);
  // A removal wins over a report of the same entry: nothing on a canvas can
  // both be gone and have a current state.
  const pending = new Map(
    changed.filter((entry) => !removed.has(idOf(entry))).map((entry) => [idOf(entry), entry]),
  );
  const entries = [];
  for (const entry of current) {
    const id = idOf(entry);
    if (removed.has(id)) continue;
    entries.push(pending.get(id) ?? entry);
    pending.delete(id);
  }
  entries.push(...pending.values());
  return entries;
}

// A frame the order does not name keeps the front, after the ones it does.
function stacked(frames: CanvasFrame[], order: readonly string[] | undefined): CanvasFrame[] {
  if (!order) return frames;
  const rank = new Map(order.map((designId, index) => [designId, index]));
  const rankOf = (frame: CanvasFrame) => rank.get(frame.designId) ?? order.length;
  return frames.sort((left, right) => rankOf(left) - rankOf(right));
}
