// A `<path>`'s data as the board moves its points. Segments keep their
// commands as written, upper case absolute and lower case relative, and each
// number keeps the text it was written as. A grip moves points in the path's
// own units; a number the move changes is written again at two decimals at
// most, and every other number keeps its text, so a drag changes only what it
// moved. The board writes the data back with spaces between its parts.

import type { PathNumber, PathSegment } from './pathData';

export interface Point {
  x: number;
  y: number;
}

/** A point a grip moves: a segment's end, or one of the control points it writes. */
export interface PathGrip {
  kind: 'anchor' | 'handle';
  segment: number;
  /** For a handle, which of the segment's written control points; -1 for an anchor. */
  control: number;
  point: Point;
  /** What a handle's line runs to: the anchor or anchors it shapes. */
  anchors: Point[];
}

/** Where one segment starts and ends, and the control points it writes, in absolute units. */
interface Placed {
  start: Point;
  end: Point;
  controls: Point[];
}

const ORIGIN: Point = { x: 0, y: 0 };
/** A number within half a written hundredth of where it should be keeps its text. */
const KEPT = 0.005;

/** The path data with spaces between its parts, as an edit writes it. */
export function writePath(segments: readonly PathSegment[]): string {
  return segments
    .map(({ command, written, numbers }) => {
      const values = numbers.map(({ text }) => text).join(' ');
      return written ? command + values : values;
    })
    .join(' ');
}

/** The anchors and handles of a path, in path order: each segment's handles before its anchor. */
export function pathGrips(segments: readonly PathSegment[]): PathGrip[] {
  const grips: PathGrip[] = [];
  place(segments).forEach(({ start, end, controls }, segment) => {
    const kind = segments[segment].command.toUpperCase();
    if (kind === 'Z') return;
    controls.forEach((point, control) => {
      // A cubic's first control shapes the anchor it leaves, its last the one it
      // reaches; a quadratic's one control shapes both.
      let anchors = [end];
      if (kind === 'Q') anchors = [start, end];
      else if (kind === 'C' && control === 0) anchors = [start];
      grips.push({ kind: 'handle', segment, control, point, anchors });
    });
    grips.push({ kind: 'anchor', segment, control: -1, point: end, anchors: [] });
  });
  return grips;
}

/**
 * The path with one grip moved by `delta` path units. An anchor carries the
 * cubic handles on either side of it, and a horizontal or vertical segment's
 * anchor moves along its own axis only. Every point the move does not reach
 * stays where it is drawn, so a relative segment after it is written again.
 */
export function moveGrip(
  segments: readonly PathSegment[],
  grip: PathGrip,
  delta: Point,
): PathSegment[] {
  const kind = segments[grip.segment].command.toUpperCase();
  const along = grip.kind === 'anchor' ? alongAxis(kind, delta) : delta;
  const moved = (point: Point) => ({ x: point.x + along.x, y: point.y + along.y });
  const placed = place(segments);
  const target = placed[grip.segment];
  if (grip.kind === 'handle') {
    target.controls = target.controls.map((point, index) =>
      index === grip.control ? moved(point) : point,
    );
    return rewrite(segments, placed);
  }
  target.end = moved(target.end);
  if (kind === 'C' || kind === 'S')
    target.controls = target.controls.map((point, index, all) =>
      index === all.length - 1 ? moved(point) : point,
    );
  const next = placed.at(grip.segment + 1);
  if (next && segments[grip.segment + 1].command.toUpperCase() === 'C')
    next.controls = [moved(next.controls[0]), ...next.controls.slice(1)];
  return rewrite(segments, placed);
}

function alongAxis(kind: string, delta: Point): Point {
  if (kind === 'H') return { x: delta.x, y: 0 };
  if (kind === 'V') return { x: 0, y: delta.y };
  return delta;
}

/** Every segment placed in absolute units, following the current point as SVG does. */
function place(segments: readonly PathSegment[]): Placed[] {
  let current = ORIGIN;
  let subpath = ORIGIN;
  return segments.map((segment) => {
    const placed = placeSegment(segment, current, subpath);
    current = placed.end;
    if (segment.command.toUpperCase() === 'M') subpath = current;
    return placed;
  });
}

function placeSegment({ command, numbers }: PathSegment, start: Point, subpath: Point): Placed {
  const kind = command.toUpperCase();
  const origin = command === kind ? ORIGIN : start;
  const at = (index: number) => ({
    x: origin.x + numbers[index].value,
    y: origin.y + numbers[index + 1].value,
  });
  if (kind === 'Z') return { start, end: subpath, controls: [] };
  if (kind === 'H')
    return { start, end: { x: origin.x + numbers[0].value, y: start.y }, controls: [] };
  if (kind === 'V')
    return { start, end: { x: start.x, y: origin.y + numbers[0].value }, controls: [] };
  if (kind === 'A') return { start, end: at(5), controls: [] };
  const controls = Array.from({ length: numbers.length / 2 - 1 }, (_, pair) => at(pair * 2));
  return { start, end: at(numbers.length - 2), controls };
}

/** Each segment's numbers for its placed points, from where the segment before now ends. */
function rewrite(segments: readonly PathSegment[], placed: readonly Placed[]): PathSegment[] {
  let current = ORIGIN;
  let subpath = ORIGIN;
  return segments.map((segment, index) => {
    const kind = segment.command.toUpperCase();
    const origin = segment.command === kind ? ORIGIN : current;
    const { controls, end } = placed[index];
    let wanted: number[];
    if (kind === 'H') wanted = [end.x - origin.x];
    else if (kind === 'V') wanted = [end.y - origin.y];
    else if (kind === 'A')
      wanted = [
        ...segment.numbers.slice(0, 5).map(({ value }) => value),
        end.x - origin.x,
        end.y - origin.y,
      ];
    else wanted = [...controls, end].flatMap((point) => [point.x - origin.x, point.y - origin.y]);
    const numbers = segment.numbers.map((number, at) =>
      Math.abs(wanted[at] - number.value) < KEPT ? number : written(wanted[at]),
    );
    const rewritten = { ...segment, numbers };
    current = placeSegment(rewritten, current, subpath).end;
    if (kind === 'M') subpath = current;
    return rewritten;
  });
}

/** A moved number, at two decimals at most. */
function written(value: number): PathNumber {
  const rounded = Math.round(value * 100) / 100;
  // Rounding a small negative gives -0, which would write as "-0".
  const kept = rounded === 0 ? 0 : rounded;
  return { value: kept, text: String(kept) };
}
