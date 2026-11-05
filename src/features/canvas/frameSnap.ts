// Smart snapping for a frame under the hand: the edges and centres of the
// other frames it pulls onto, the equal spacing it settles into between its
// neighbours, and the lines and gaps the board draws to say so. A snapped rect
// is in whole pixels, as every rect a drag commits is.

import {
  boundsOf,
  clampDimension,
  roundRect,
  type FrameHandle,
  type Point,
} from './canvasGeometry';
import type { FrameRect } from './protocol';

/** Screen pixels within which an edge, a centre or a spacing pulls the hand. */
const SNAP_PX = 6;

/** Rounding leaves aligned edges up to half a pixel apart, and an odd gap split in two one apart. */
const ALIGNED_PX = 0.5;
const EQUAL_GAP_PX = 1;

type Axis = 'x' | 'y';

/** An alignment line at `at` on `axis`, running from `from` to `to` along the other axis. */
export interface SnapGuide {
  axis: Axis;
  at: number;
  from: number;
  to: number;
}

/** A measured space between two frames, from `from` to `to` on `axis`, drawn across at `at`. */
export interface SnapGap {
  axis: Axis;
  from: number;
  to: number;
  at: number;
}

/** What a snapped drag shows: the lines it aligned on and the gaps it measured. */
export interface SnapMarks {
  guides: SnapGuide[];
  gaps: SnapGap[];
}

export interface FrameSnap extends SnapMarks {
  rect: FrameRect;
}

export interface GroupSnap extends SnapMarks {
  rects: FrameRect[];
}

/** How a handle moves a rect along one axis: all of it, its far edge, or not at all. */
type AxisHold = 'move' | 'end' | null;

function holdOf(handle: FrameHandle, axis: Axis): AxisHold {
  switch (handle) {
    case 'move':
      return 'move';
    case 'southeast':
      return 'end';
    case 'east':
      return axis === 'x' ? 'end' : null;
    case 'south':
      return axis === 'y' ? 'end' : null;
  }
}

/**
 * `rect` pulled onto the nearest edge, centre or equal spacing among `others`
 * within a few screen pixels, which is `SNAP_PX / scale` world units. A move
 * snaps all three of its lines on each axis; a resize snaps only the edge in
 * the hand, so the frame never jumps from under it.
 */
export function snapFrameRect(
  rect: FrameRect,
  handle: FrameHandle,
  others: readonly FrameRect[],
  scale: number,
): FrameSnap {
  const threshold = SNAP_PX / scale;
  let snapped = rect;
  for (const axis of ['x', 'y'] as const) {
    const hold = holdOf(handle, axis);
    if (hold === null) continue;
    const offset = nearestOffset(snapOffsets(snapped, hold, others, axis), threshold);
    snapped = hold === 'move' ? shift(snapped, axis, offset) : grow(snapped, axis, offset);
  }
  snapped = roundRect(snapped);
  return {
    rect: snapped,
    guides: guidesFor(snapped, handle, others),
    gaps:
      handle === 'move' ? [...gapsFor(snapped, others, 'x'), ...gapsFor(snapped, others, 'y')] : [],
  };
}

/**
 * Frames carried together by `offset`, snapped as one: their bounds pull onto
 * `others` as a single moved frame's would, and each frame keeps its place in
 * the group.
 */
export function snapGroupMove(
  starts: readonly FrameRect[],
  offset: Point,
  others: readonly FrameRect[],
  scale: number,
): GroupSnap {
  const bounds = boundsOf(starts);
  if (bounds === null) return { rects: [], guides: [], gaps: [] };
  const moved = { ...bounds, x: bounds.x + offset.x, y: bounds.y + offset.y };
  const { rect, ...marks } = snapFrameRect(moved, 'move', others, scale);
  const carried = { x: rect.x - bounds.x, y: rect.y - bounds.y };
  return {
    rects: starts.map((start) =>
      roundRect({ ...start, x: start.x + carried.x, y: start.y + carried.y }),
    ),
    ...marks,
  };
}

function start(rect: FrameRect, axis: Axis): number {
  return axis === 'x' ? rect.x : rect.y;
}

function size(rect: FrameRect, axis: Axis): number {
  return axis === 'x' ? rect.width : rect.height;
}

function end(rect: FrameRect, axis: Axis): number {
  return start(rect, axis) + size(rect, axis);
}

function across(axis: Axis): Axis {
  return axis === 'x' ? 'y' : 'x';
}

/** Left, centre and right on x; top, centre and bottom on y. */
function lines(rect: FrameRect, axis: Axis): number[] {
  return [start(rect, axis), start(rect, axis) + size(rect, axis) / 2, end(rect, axis)];
}

/** The lines of `rect` that a handle moves, and so the only ones that may snap. */
function heldLines(rect: FrameRect, hold: Exclude<AxisHold, null>, axis: Axis): number[] {
  return hold === 'move' ? lines(rect, axis) : [end(rect, axis)];
}

function shift(rect: FrameRect, axis: Axis, by: number): FrameRect {
  return axis === 'x' ? { ...rect, x: rect.x + by } : { ...rect, y: rect.y + by };
}

function grow(rect: FrameRect, axis: Axis, by: number): FrameRect {
  return axis === 'x'
    ? { ...rect, width: clampDimension(rect.width + by) }
    : { ...rect, height: clampDimension(rect.height + by) };
}

/** Every distance the held lines could travel to land on another frame's line or spacing. */
function snapOffsets(
  rect: FrameRect,
  hold: Exclude<AxisHold, null>,
  others: readonly FrameRect[],
  axis: Axis,
): number[] {
  const held = heldLines(rect, hold, axis);
  const offsets = others.flatMap((other) =>
    lines(other, axis).flatMap((target) => held.map((line) => target - line)),
  );
  if (hold === 'move') offsets.push(...spacingOffsets(rect, others, axis));
  return offsets;
}

function nearestOffset(offsets: readonly number[], threshold: number): number {
  let nearest = 0;
  let distance = Infinity;
  for (const offset of offsets) {
    if (Math.abs(offset) <= threshold && Math.abs(offset) < distance) {
      nearest = offset;
      distance = Math.abs(offset);
    }
  }
  return nearest;
}

/** Whether two rects share any span along `axis`, which is what puts them in one row or column. */
function overlapsOn(a: FrameRect, b: FrameRect, axis: Axis): boolean {
  return start(a, axis) < end(b, axis) && end(a, axis) > start(b, axis);
}

/**
 * The frames level with `rect` along `axis`, and its nearest neighbour on
 * either side of it there. A frame overlapping it on `axis` is beside neither.
 */
function rowOf(rect: FrameRect, others: readonly FrameRect[], axis: Axis) {
  const row = others.filter((other) => overlapsOn(other, rect, across(axis)));
  let before: FrameRect | null = null;
  let after: FrameRect | null = null;
  for (const other of row) {
    if (end(other, axis) <= start(rect, axis) && (!before || end(other, axis) > end(before, axis)))
      before = other;
    if (
      start(other, axis) >= end(rect, axis) &&
      (!after || start(other, axis) < start(after, axis))
    )
      after = other;
  }
  return { row, before, after };
}

/**
 * The spaces between neighbouring frames of `rect`'s row, other than the two
 * beside it. Neighbours are measured with `rect` in the row, so two frames it
 * sits between are not each other's, and frames that touch have no space.
 */
function rowGaps(rect: FrameRect, row: readonly FrameRect[], axis: Axis): [FrameRect, FrameRect][] {
  const all = [...row, rect];
  const pairs: [FrameRect, FrameRect][] = [];
  for (const left of row) {
    let right: FrameRect | null = null;
    for (const other of all) {
      if (start(other, axis) < end(left, axis) || !overlapsOn(left, other, across(axis))) continue;
      if (!right || start(other, axis) < start(right, axis)) right = other;
    }
    if (right && right !== rect && start(right, axis) > end(left, axis)) pairs.push([left, right]);
  }
  return pairs;
}

function gapBetween([left, right]: [FrameRect, FrameRect], axis: Axis): number {
  return start(right, axis) - end(left, axis);
}

/**
 * Where a moved `rect` would sit an equal distance from both neighbours, or
 * the same distance from one of them as two other frames in its row are apart.
 */
function spacingOffsets(rect: FrameRect, others: readonly FrameRect[], axis: Axis): number[] {
  const { row, before, after } = rowOf(rect, others, axis);
  const from = start(rect, axis);
  const offsets: number[] = [];
  if (before && after) {
    const room = start(after, axis) - end(before, axis) - size(rect, axis);
    if (room >= 0) offsets.push(end(before, axis) + room / 2 - from);
  }
  for (const pair of rowGaps(rect, row, axis)) {
    const gap = gapBetween(pair, axis);
    if (before) offsets.push(end(before, axis) + gap - from);
    if (after) offsets.push(start(after, axis) - gap - size(rect, axis) - from);
  }
  return offsets;
}

/** A line through each place a held line of `rect` meets another frame's, spanning both. */
function guidesFor(rect: FrameRect, handle: FrameHandle, others: readonly FrameRect[]) {
  const guides: SnapGuide[] = [];
  for (const axis of ['x', 'y'] as const) {
    const hold = holdOf(handle, axis);
    if (hold === null) continue;
    const held = heldLines(rect, hold, axis);
    const cross = across(axis);
    for (const other of others) {
      for (const target of lines(other, axis)) {
        if (!held.some((line) => Math.abs(line - target) <= ALIGNED_PX)) continue;
        const from = Math.min(start(rect, cross), start(other, cross));
        const to = Math.max(end(rect, cross), end(other, cross));
        const same = guides.find((guide) => guide.axis === axis && guide.at === target);
        if (same) {
          same.from = Math.min(same.from, from);
          same.to = Math.max(same.to, to);
        } else guides.push({ axis, at: target, from, to });
      }
    }
  }
  return guides;
}

function alignedOn(a: FrameRect, b: FrameRect, axis: Axis): boolean {
  return lines(a, axis).some((line) =>
    lines(b, axis).some((target) => Math.abs(line - target) <= ALIGNED_PX),
  );
}

function gapOf([left, right]: [FrameRect, FrameRect], axis: Axis): SnapGap {
  const cross = across(axis);
  const overlapFrom = Math.max(start(left, cross), start(right, cross));
  const overlapTo = Math.min(end(left, cross), end(right, cross));
  return { axis, from: end(left, axis), to: start(right, axis), at: (overlapFrom + overlapTo) / 2 };
}

/**
 * The spaces worth naming beside a moved `rect` along `axis`: every space in
 * its row that equals one beside it, or else the space to a neighbour it lines
 * up with, so a row of frames reads its rhythm while it is being set.
 */
function gapsFor(rect: FrameRect, others: readonly FrameRect[], axis: Axis): SnapGap[] {
  const { row, before, after } = rowOf(rect, others, axis);
  const beside: [FrameRect, FrameRect][] = [];
  if (before && start(rect, axis) > end(before, axis)) beside.push([before, rect]);
  if (after && start(after, axis) > end(rect, axis)) beside.push([rect, after]);
  const equal = new Set<[FrameRect, FrameRect]>();
  const candidates = [...beside, ...rowGaps(rect, row, axis)];
  for (const pair of beside) {
    for (const other of candidates) {
      if (
        other === pair ||
        Math.abs(gapBetween(other, axis) - gapBetween(pair, axis)) > EQUAL_GAP_PX
      )
        continue;
      equal.add(pair).add(other);
    }
  }
  if (equal.size > 0) return [...equal].map((pair) => gapOf(pair, axis));
  return beside
    .filter(([left, right]) => alignedOn(left, right, across(axis)))
    .map((pair) => gapOf(pair, axis));
}
