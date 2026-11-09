// What Alt measures between two boxes on the board, as a design tool does:
// the space between them on each axis they stand apart on, or, where they
// overlap, how far each edge of the first sits from the same edge of the
// second, which is an element's padding inside its parent.

import type { SnapGap } from './frameSnap';
import type { FrameRect } from './protocol';

type Axis = SnapGap['axis'];

const AXES: readonly Axis[] = ['x', 'y'];

/** A sub-pixel distance reads as a half pixel once rounding would be off by this much. */
const HALF_PX_FROM = 0.25;

function start(rect: FrameRect, axis: Axis): number {
  return axis === 'x' ? rect.x : rect.y;
}

function end(rect: FrameRect, axis: Axis): number {
  return axis === 'x' ? rect.x + rect.width : rect.y + rect.height;
}

function across(axis: Axis): Axis {
  return axis === 'x' ? 'y' : 'x';
}

function overlapsOn(a: FrameRect, b: FrameRect, axis: Axis): boolean {
  return start(a, axis) < end(b, axis) && end(a, axis) > start(b, axis);
}

/**
 * Where a line on `axis` runs across: through the middle of the span both
 * boxes share, so it meets them both, else through the middle of `from`.
 */
function lineAt(from: FrameRect, to: FrameRect, axis: Axis): number {
  const cross = across(axis);
  const low = Math.max(start(from, cross), start(to, cross));
  const high = Math.min(end(from, cross), end(to, cross));
  if (high > low) return (low + high) / 2;
  return (start(from, cross) + end(from, cross)) / 2;
}

function gapOn(from: FrameRect, to: FrameRect, axis: Axis): SnapGap {
  const at = lineAt(from, to, axis);
  if (end(from, axis) <= start(to, axis))
    return { axis, from: end(from, axis), to: start(to, axis), at };
  return { axis, from: end(to, axis), to: start(from, axis), at };
}

/** From each edge of `from` on `axis` to the same edge of `to`: left to left, right to right. */
function insetsOn(from: FrameRect, to: FrameRect, axis: Axis): SnapGap[] {
  const at = lineAt(from, to, axis);
  return [
    [start(from, axis), start(to, axis)],
    [end(from, axis), end(to, axis)],
  ].map(([edge, target]) => ({
    axis,
    from: Math.min(edge, target),
    to: Math.max(edge, target),
    at,
  }));
}

/**
 * The distances from `from` (the selection) to `to` (what the pointer is
 * over), in the units both rects share. Boxes apart on an axis measure the
 * gap there and nothing else; boxes that overlap on both axes, including one
 * inside the other, measure the four insets between their matching edges.
 * A distance that reads 0 is left out.
 */
export function measureBetween(from: FrameRect, to: FrameRect): SnapGap[] {
  const apart = AXES.filter((axis) => !overlapsOn(from, to, axis));
  const lines =
    apart.length > 0
      ? apart.map((axis) => gapOn(from, to, axis))
      : AXES.flatMap((axis) => insetsOn(from, to, axis));
  return lines.filter((line) => line.to - line.from >= HALF_PX_FROM);
}

/** A distance in whole pixels, or to the half pixel when a sub-pixel layout would round it away. */
export function distanceLabel(px: number): string {
  const whole = Math.round(px);
  if (Math.abs(px - whole) < HALF_PX_FROM) return String(whole);
  return String(Math.floor(px) + 0.5);
}
