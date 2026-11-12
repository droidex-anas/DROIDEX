// The selected path's anchors and handles on the board, over its frame: an
// anchor is a small square, a handle a round grip on a thin line to the anchor
// it shapes. A grip drags its point, previewing at most once a frame and
// committing once on release. On a focused anchor the arrows nudge it, a burst
// of presses committing once, and Tab moves between anchors. A move writes
// only to the shape it started from: Escape, the window losing focus, a new
// read of the shape or the grips going away take it back. Every grip takes a
// small control's press at any zoom.

import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { MAX_PREVIEW_PATH_DATA_BYTES, type PreviewMatrix } from '../previewDocumentShape';
import type { ElementRef } from '../protocol';
import type { PathSegment } from './pathData';
import { movedData, moveGrip, pathGrips, type PathGrip, type Point } from './pathModel';
import type { PathShape } from './usePathShape';

/** Screen pixels a press travels before it drags, so a shaky click never moves a point. */
const DRAG_START_PX = 4;
/** A burst of arrow presses commits once, this long after its last. */
const NUDGE_SETTLE_MS = 400;

interface Press {
  pointerId: number;
  grip: PathGrip;
  target: Element;
  start: Point;
  dragging: boolean;
}

/**
 * A move under way, from a press or the first nudge of a burst: the shape it
 * started from, the element it writes to, the data it shows (null for the
 * path's own), and each nudged grip's total step, by its index.
 */
interface Move {
  from: PathSegment[];
  element: ElementRef;
  d: string | null;
  nudges: Map<number, Point>;
}

export function PathGrips({
  shape,
  designId,
  frame,
  scale,
  preview,
  commit,
}: {
  shape: PathShape;
  /** The path's frame, whose drag carries the grips (HeldFrames). */
  designId: string;
  /** Where the path's frame is drawn on the board. */
  frame: Point;
  scale: number;
  /** Draws data on `element`'s path, or its own for null. */
  preview: (d: string | null, element: ElementRef) => void;
  commit: (d: string, element: ElementRef) => void;
}) {
  /** A move's segments, shown while `from` is still the shape read: until the next read after its commit. */
  const [moved, setMoved] = useState<{ from: PathSegment[]; segments: PathSegment[] } | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const press = useRef<Press | null>(null);
  const move = useRef<Move | null>(null);
  const frameRequest = useRef<number | null>(null);
  const nudgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopListening = useRef<(() => void) | null>(null);
  // A timer, a frame or a window key ends the move against the shape drawn now.
  const latest = useRef({ shape, preview, commit });
  latest.current = { shape, preview, commit };

  const segments = moved?.from === shape.segments ? moved.segments : shape.segments;
  const grips = pathGrips(segments);
  const { matrix } = shape;

  /** Ends the move: commits what it shows while its shape is still the one to write, else takes it back. */
  const settle = (keep: boolean) => {
    if (frameRequest.current !== null) cancelAnimationFrame(frameRequest.current);
    frameRequest.current = null;
    if (nudgeTimer.current !== null) clearTimeout(nudgeTimer.current);
    nudgeTimer.current = null;
    stopListening.current?.();
    stopListening.current = null;
    const held = press.current;
    press.current = null;
    if (held) {
      setDragging(false);
      if (held.target.hasPointerCapture(held.pointerId))
        held.target.releasePointerCapture(held.pointerId);
    }
    const ending = move.current;
    move.current = null;
    if (!ending) return;
    const now = latest.current;
    if (keep && ending.d !== null && isCurrent(now.shape, ending)) {
      now.commit(ending.d, ending.element);
      return;
    }
    now.preview(null, ending.element);
    setMoved(null);
  };

  // A move whose shape is read again, from another revision or run, or stops being writable, is taken back.
  useEffect(() => {
    const held = move.current;
    if (held && !isCurrent(shape, held)) settle(false);
  });
  const takeBack = useEffectEvent(() => {
    settle(false);
  });
  useEffect(
    () => () => {
      takeBack();
    },
    [],
  );

  /** Starts a move from the shape as read, taking Escape and the window's blur until it ends. */
  const begin = () => {
    if (move.current) return;
    move.current = { from: shape.segments, element: shape.element, d: null, nudges: new Map() };
    // The board's Escape would drop the selection, so a move takes it first, wherever focus is.
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      settle(false);
    };
    const onBlur = () => {
      settle(false);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onBlur);
    stopListening.current = () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onBlur);
    };
  };

  /** Shows the move at `next`; a move past what path data or the preview takes holds where it last was. */
  const show = (next: PathSegment[] | null) => {
    const held = move.current;
    if (!held || !next) return;
    if (!isCurrent(latest.current.shape, held)) {
      settle(false);
      return;
    }
    const d = movedData(held.from, next);
    if (d !== null && d.length > MAX_PREVIEW_PATH_DATA_BYTES) return;
    held.d = d;
    setMoved({ from: held.from, segments: next });
    frameRequest.current ??= requestAnimationFrame(() => {
      frameRequest.current = null;
      const live = move.current;
      if (live) latest.current.preview(live.d, live.element);
    });
  };

  const canMove = (grip: PathGrip) => shape.movable && (grip.axes.x || grip.axes.y);

  const onPointerDown = (event: PointerEvent, grip: PathGrip) => {
    if (event.button !== 0 || !canMove(grip)) return;
    event.stopPropagation();
    // One pointer moves a point at a time.
    if (press.current) return;
    // A nudge still settling commits first. No move starts on a shape whose
    // commit is saving: it waits for the revision that commit builds.
    if (move.current) {
      settle(true);
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    press.current = {
      pointerId: event.pointerId,
      grip,
      target: event.currentTarget,
      start: { x: event.clientX, y: event.clientY },
      dragging: false,
    };
    // The press is the move's start, so a new read before it drags takes it back too.
    begin();
  };

  const onPointerMove = (event: PointerEvent) => {
    const held = press.current;
    if (held?.pointerId !== event.pointerId) return;
    const screen = { x: event.clientX - held.start.x, y: event.clientY - held.start.y };
    if (!held.dragging) {
      if (Math.hypot(screen.x, screen.y) < DRAG_START_PX) return;
      held.dragging = true;
      setDragging(true);
    }
    const from = move.current?.from;
    if (!from) return;
    const delta = toPathUnits(matrix, { x: screen.x / scale, y: screen.y / scale });
    show(moveGrip(from, held.grip, delta));
  };

  /** The pressing pointer was cancelled or lost its capture: its drag is taken back. */
  const onPointerLost = (event: PointerEvent) => {
    if (press.current?.pointerId === event.pointerId) settle(false);
  };

  const onPointerUp = (event: PointerEvent) => {
    const held = press.current;
    if (held?.pointerId !== event.pointerId) return;
    settle(held.dragging);
  };

  /** Moves the grip at `index` one step further in the burst, which commits once it rests. */
  const nudge = (index: number, step: Point) => {
    begin();
    const held = move.current;
    if (!held) return;
    // Each grip moves by its burst's total from where the burst started, so
    // presses that cancel out leave its numbers as written.
    const total = held.nudges.get(index) ?? { x: 0, y: 0 };
    held.nudges.set(index, { x: total.x + step.x, y: total.y + step.y });
    const started = pathGrips(held.from);
    let next: PathSegment[] | null = held.from;
    for (const [at, delta] of held.nudges) if (next) next = moveGrip(next, started[at], delta);
    show(next);
    // Showing it may have found the burst's shape read again and taken it back.
    if (move.current !== held) return;
    if (nudgeTimer.current !== null) clearTimeout(nudgeTimer.current);
    nudgeTimer.current = setTimeout(() => {
      if (move.current === held) settle(true);
    }, NUDGE_SETTLE_MS);
  };

  const onKeyDown = (event: KeyboardEvent, grip: PathGrip, index: number) => {
    const step = arrowStep(event);
    if (step) {
      event.preventDefault();
      event.stopPropagation();
      // A step along an axis the point is held on moves nothing.
      const free = (step.x !== 0 && grip.axes.x) || (step.y !== 0 && grip.axes.y);
      if (canMove(grip) && !press.current && free) nudge(index, step);
      return;
    }
    // Removing a point is not offered, and the board's Delete would remove the whole path.
    if (event.key === 'Delete' || event.key === 'Backspace') event.stopPropagation();
  };

  // Points are numbered in path order, each by the segment it ends.
  const points = new Map(
    grips.filter(({ kind }) => kind === 'anchor').map(({ segment }, at) => [segment, at + 1]),
  );
  const pointLabel = (grip: PathGrip) => {
    if (grip.kind === 'anchor')
      return `Point ${String(points.get(grip.segment))} of ${String(points.size)}`;
    const shaped = grip.anchors.map(({ segment }) => String(points.get(segment)));
    return shaped.length === 1
      ? `Handle of point ${shaped[0]}`
      : `Handle of points ${shaped.join(' and ')}`;
  };
  return (
    <div
      data-path-grips
      data-follows-frame={designId}
      data-dragging={dragging || undefined}
      data-readonly={!shape.movable || undefined}
      className="canvas-path-grips"
      style={{ left: frame.x, top: frame.y }}
    >
      <svg aria-hidden className="canvas-path-lines">
        {grips.flatMap((grip, index) =>
          grip.anchors.map(({ point }, end) => {
            const a = drawnAt(matrix, grip.point);
            const b = drawnAt(matrix, point);
            return (
              <line key={`${String(index)}:${String(end)}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
            );
          }),
        )}
      </svg>
      {grips.map((grip, index) => {
        const at = drawnAt(matrix, grip.point);
        const fixed = !canMove(grip);
        return (
          <button
            key={index}
            type="button"
            data-path-grip={grip.kind}
            data-selected={focused === index || undefined}
            aria-disabled={fixed || undefined}
            tabIndex={grip.kind === 'anchor' && !fixed ? 0 : -1}
            aria-label={pointLabel(grip)}
            className="canvas-path-grip"
            style={{ left: at.x, top: at.y }}
            onFocus={() => {
              setFocused(index);
            }}
            onBlur={() => {
              setFocused((current) => (current === index ? null : current));
            }}
            onPointerDown={(event) => {
              onPointerDown(event, grip);
            }}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerLost}
            onLostPointerCapture={onPointerLost}
            onKeyDown={(event) => {
              onKeyDown(event, grip, index);
            }}
          />
        );
      })}
    </div>
  );
}

/** One path unit on the arrows, ten with Shift, in the path's own axes. */
function arrowStep(event: KeyboardEvent): Point | null {
  // While an input method composes, the arrows pick among its candidates.
  if (event.nativeEvent.isComposing || event.metaKey || event.ctrlKey || event.altKey) return null;
  const size = event.shiftKey ? 10 : 1;
  if (event.key === 'ArrowLeft') return { x: -size, y: 0 };
  if (event.key === 'ArrowRight') return { x: size, y: 0 };
  if (event.key === 'ArrowUp') return { x: 0, y: -size };
  if (event.key === 'ArrowDown') return { x: 0, y: size };
  return null;
}

function drawnAt([a, b, c, d, e, f]: PreviewMatrix, { x, y }: Point): Point {
  return { x: a * x + c * y + e, y: b * x + d * y + f };
}

/** A distance in the design's pixels, in the path's units: through the matrix's inverse, without its move. */
function toPathUnits([a, b, c, d]: PreviewMatrix, { x, y }: Point): Point {
  const determinant = a * d - b * c;
  return { x: (d * x - c * y) / determinant, y: (a * y - b * x) / determinant };
}

/** Whether a move may still write: the shape it started from is the one read, for the element selected, and still movable. */
function isCurrent(shape: PathShape, move: Move): boolean {
  return shape.movable && shape.segments === move.from && shape.element === move.element;
}
