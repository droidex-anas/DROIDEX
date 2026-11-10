// What Alt measures between two boxes on the board, as a design tool does, on
// each axis on its own: the space between them where they stand apart; where
// one holds the other, how far each edge of the first sits from the same edge
// of the second, which is an element's padding inside its parent; and where
// they only overlap, how far each edge of the first sits from the nearer edge
// of the second.

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

function middle(rect: FrameRect, axis: Axis): number {
  return (start(rect, axis) + end(rect, axis)) / 2;
}

function holds(outer: FrameRect, inner: FrameRect, axis: Axis): boolean {
  return start(outer, axis) <= start(inner, axis) && end(inner, axis) <= end(outer, axis);
}

function line(axis: Axis, a: number, b: number, at: number): SnapGap {
  return { axis, from: Math.min(a, b), to: Math.max(a, b), at };
}

/** The span two boxes share across `axis`; `low` passes `high` where they stand apart there. */
function sharedAcross(from: FrameRect, to: FrameRect, axis: Axis) {
  const cross = across(axis);
  return {
    low: Math.max(start(from, cross), start(to, cross)),
    high: Math.min(end(from, cross), end(to, cross)),
  };
}

/**
 * A gap runs through the middle of the span the boxes share across it, so it
 * meets both; where they share none, it leaves the middle of the selection's
 * facing edge, as a designer reads it.
 */
function gapOn(from: FrameRect, to: FrameRect, axis: Axis): SnapGap | null {
  const { low, high } = sharedAcross(from, to, axis);
  const at = low < high ? (low + high) / 2 : middle(from, across(axis));
  if (end(from, axis) <= start(to, axis)) return line(axis, end(from, axis), start(to, axis), at);
  if (end(to, axis) <= start(from, axis)) return line(axis, end(to, axis), start(from, axis), at);
  return null;
}

/**
 * Each edge of `from` on `axis` to the same edge of `to` when one box holds
 * the other there, else to the nearer edge of `to`. The lines run through the
 * middle of the span the boxes share across them, or of the space between.
 */
function edgesOn(from: FrameRect, to: FrameRect, axis: Axis): SnapGap[] {
  const { low, high } = sharedAcross(from, to, axis);
  const at = (low + high) / 2;
  const targets = [start(to, axis), end(to, axis)];
  const nested = holds(from, to, axis) || holds(to, from, axis);
  return [start(from, axis), end(from, axis)].map((edge, index) => {
    const matching = targets[index];
    const other = targets[1 - index];
    const target = nested || Math.abs(matching - edge) <= Math.abs(other - edge) ? matching : other;
    return line(axis, edge, target, at);
  });
}

/**
 * The distances from `from` (the selection) to `to` (what the pointer is
 * over), in the units both rects share, decided on each axis on its own. A
 * distance that reads 0 is left out.
 */
export function measureBetween(from: FrameRect, to: FrameRect): SnapGap[] {
  return AXES.flatMap((axis) => {
    const gap = gapOn(from, to, axis);
    return gap ? [gap] : edgesOn(from, to, axis);
  }).filter((measured) => measured.to - measured.from >= HALF_PX_FROM);
}

/** A distance in whole pixels, or to the half pixel when a sub-pixel layout would round it away. */
export function distanceLabel(px: number): string {
  const whole = Math.round(px);
  if (Math.abs(px - whole) < HALF_PX_FROM) return String(whole);
  return String(Math.floor(px) + 0.5);
}
