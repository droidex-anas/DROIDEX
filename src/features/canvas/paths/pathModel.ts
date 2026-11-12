// A `<path>`'s data as the board moves its points. Segments keep their
// commands as written, upper case absolute and lower case relative, and each
// number keeps the text it was written as. A grip moves points in the path's
// own units; a number the move changes is written again as a plain decimal at
// two places at most, and every other number keeps its text, so a drag changes
// only what it moved. The board writes moved data back with spaces between its
// parts, and a move that changes no number writes nothing.

import { MAX_NUMBER, type PathNumber, type PathSegment } from './pathData';

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
  /**
   * The axes the grip may move along. A horizontal or vertical line keeps the
   * other coordinate of the point it ends at or starts from, so that point
   * moves only along it; with both held it does not move.
   */
  axes: { x: boolean; y: boolean };
}

/** Where one segment starts and ends, and the control points it writes, in absolute units. */
interface Placed {
  start: Point;
  end: Point;
  controls: Point[];
  /** The segment whose end this one starts from; -1 for the path's start. */
  from: number;
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
  const placed = place(segments);
  const startingAt = placed.map((): number[] => []);
  placed.forEach(({ from }, at) => {
    if (from >= 0) startingAt[from].push(at);
  });
  placed.forEach(({ start, end, controls }, segment) => {
    const kind = kindOf(segments[segment]);
    if (kind === 'Z') return;
    controls.forEach((point, control) => {
      // A cubic's first control shapes the anchor it leaves, its last the one it
      // reaches; a quadratic's one control shapes both.
      let anchors = [end];
      if (kind === 'Q') anchors = [start, end];
      else if (kind === 'C' && control === 0) anchors = [start];
      grips.push({ kind: 'handle', segment, control, point, anchors, axes: BOTH_AXES });
    });
    const lines = [segment, ...startingAt[segment]].map((at) => kindOf(segments[at]));
    const axes = { x: !lines.includes('V'), y: !lines.includes('H') };
    grips.push({ kind: 'anchor', segment, control: -1, point: end, anchors: [], axes });
  });
  return grips;
}

/**
 * The data a move from `before` to `after` writes, spaced for an edit, with
 * every number back where it started in its source text; null when none moved,
 * so a move that ends where it started leaves the source as it was.
 */
export function movedData(
  before: readonly PathSegment[],
  after: readonly PathSegment[],
): string | null {
  const kept = after.map((segment, index) => ({
    ...segment,
    numbers: segment.numbers.map((number, at) => {
      const was = before[index].numbers[at];
      return Math.abs(number.value - was.value) < KEPT ? was : number;
    }),
  }));
  const moved = kept.some((segment, index) =>
    segment.numbers.some((number, at) => number !== before[index].numbers[at]),
  );
  return moved ? writePath(kept) : null;
}

/**
 * The path with one grip moved by `delta` path units, along the grip's free
 * axes. An anchor carries the cubic handles on either side of it. Every point
 * the move does not reach stays where it is drawn, so a relative segment after
 * it is written again. Null where a moved number is past what path data holds.
 */
export function moveGrip(
  segments: readonly PathSegment[],
  grip: PathGrip,
  delta: Point,
): PathSegment[] | null {
  const kind = kindOf(segments[grip.segment]);
  const along = { x: grip.axes.x ? delta.x : 0, y: grip.axes.y ? delta.y : 0 };
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
  if (next && kindOf(segments[grip.segment + 1]) === 'C')
    next.controls = [moved(next.controls[0]), ...next.controls.slice(1)];
  return rewrite(segments, placed);
}

const BOTH_AXES = { x: true, y: true };

function kindOf({ command }: PathSegment): string {
  return command.toUpperCase();
}

/** Every segment placed in absolute units, following the current point as SVG does. */
function place(segments: readonly PathSegment[]): Placed[] {
  let current = ORIGIN;
  let subpath = ORIGIN;
  let currentFrom = -1;
  let subpathFrom = -1;
  return segments.map((segment, index) => {
    const placed = { ...placeSegment(segment, current, subpath), from: currentFrom };
    const kind = kindOf(segment);
    current = placed.end;
    if (kind === 'M') {
      subpath = current;
      subpathFrom = index;
    }
    // A close goes back to its subpath's start, which the next segment starts from.
    currentFrom = kind === 'Z' ? subpathFrom : index;
    return placed;
  });
}

function placeSegment(
  { command, numbers }: PathSegment,
  start: Point,
  subpath: Point,
): Omit<Placed, 'from'> {
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
function rewrite(
  segments: readonly PathSegment[],
  placed: readonly Placed[],
): PathSegment[] | null {
  let current = ORIGIN;
  let subpath = ORIGIN;
  const rewritten: PathSegment[] = [];
  for (const [index, segment] of segments.entries()) {
    const kind = kindOf(segment);
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
    const numbers: PathNumber[] = [];
    for (const [at, number] of segment.numbers.entries()) {
      const kept = Math.abs(wanted[at] - number.value) < KEPT ? number : written(wanted[at]);
      if (!kept) return null;
      numbers.push(kept);
    }
    const moved = { ...segment, numbers };
    current = placeSegment(moved, current, subpath).end;
    if (kind === 'M') subpath = current;
    rewritten.push(moved);
  }
  return rewritten;
}

/** Plain decimals, never an exponent, as the grammar reads at any size it takes. */
const DECIMAL = new Intl.NumberFormat('en-US', { useGrouping: false, maximumFractionDigits: 2 });

/** A moved number at two decimals at most; null past what path data holds. */
function written(value: number): PathNumber | null {
  if (!Number.isFinite(value) || Math.abs(value) > MAX_NUMBER) return null;
  // A small negative rounds to "-0".
  const text = DECIMAL.format(value).replace(/^-0$/, '0');
  return { value: Number(text), text };
}
