// Where the guides a snapped drag lined up on and the spaces it measured, or
// Alt's distances, go on screen. SnapGuides draws them there.

import { canvasToScreen, type Viewport } from './canvasGeometry';
import { SIZE_ROOM_PX } from './ElementOutlines';
import type { SnapGap, SnapMarks } from './frameSnap';

/** Screen pixels a centred distance keeps clear of the line's end ticks. */
const TICK_CLEARANCE_PX = 4;

/** What SnapGuides draws. */
export interface GuideMarks extends SnapMarks {
  /** For Alt's distances, the bottom edge of the box they leave, which its size chip hangs under. */
  sizedBottom?: number;
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

/** One measured space as drawn: its line, and its distance centred on it or beside it. */
interface PlacedGap {
  line: Box;
  pill: { left: number; top: number };
  beside: boolean;
}

/**
 * Where each guide line and measured space goes on screen, given each
 * distance's size on screen in the order of `marks.gaps`.
 */
export function layOutGuides(
  marks: GuideMarks,
  viewport: Viewport,
  pillSizes: readonly Size[],
): { lines: Box[]; gaps: PlacedGap[] } {
  const { sizedBottom } = marks;
  const chipTop =
    sizedBottom === undefined
      ? null
      : Math.round(canvasToScreen(viewport, { x: 0, y: sizedBottom }).y);
  return {
    // A guide on x is a vertical line at that x, so it runs along y.
    lines: marks.guides.map((guide) =>
      lineBox(guide.axis === 'x' ? 'y' : 'x', guide.from, guide.to, guide.at, viewport),
    ),
    gaps: marks.gaps.map((gap, index) => placeGap(gap, viewport, chipTop, pillSizes[index])),
  };
}

/**
 * A measured space: a line with end ticks, and its distance centred on it, or
 * beside it when the line is too short to hold the distance clear of its ticks.
 * `chipTop` is the screen row a size chip's gap starts on, if one shows.
 */
function placeGap(gap: SnapGap, viewport: Viewport, chipTop: number | null, pill: Size): PlacedGap {
  const line = lineBox(gap.axis, gap.from, gap.to, gap.at, viewport);
  const vertical = gap.axis === 'y';
  // A line down from a sized box runs through its size chip, so its distance starts
  // below the chip. Rows compare in whole screen pixels, as the line is drawn.
  const clearBelow =
    vertical && line.top === chipTop ? line.top + SIZE_ROOM_PX + TICK_CLEARANCE_PX : null;
  const start = vertical ? line.top : line.left;
  const end = start + (vertical ? line.height : line.width);
  const pillLength = vertical ? pill.height : pill.width;
  const free = clearBelow === null ? start : Math.max(start, clearBelow);
  let along = (free + end) / 2;
  if (clearBelow !== null) along = Math.max(along, clearBelow + pillLength / 2);
  return {
    line,
    pill: vertical
      ? { left: line.left + line.width / 2, top: along }
      : { left: along, top: line.top + line.height / 2 },
    beside: end - free < pillLength + 2 * TICK_CLEARANCE_PX,
  };
}

/** A one-pixel line from `from` to `to` along `along`, at `at` across it, in whole screen pixels. */
function lineBox(along: 'x' | 'y', from: number, to: number, at: number, viewport: Viewport): Box {
  const start = canvasToScreen(viewport, along === 'x' ? { x: from, y: at } : { x: at, y: from });
  const end = canvasToScreen(viewport, along === 'x' ? { x: to, y: at } : { x: at, y: to });
  const left = Math.round(start.x);
  const top = Math.round(start.y);
  return {
    left,
    top,
    width: along === 'x' ? Math.round(end.x) - left : 1,
    height: along === 'y' ? Math.round(end.y) - top : 1,
  };
}
