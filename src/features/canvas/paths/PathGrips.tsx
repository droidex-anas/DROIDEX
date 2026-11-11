// The selected path's anchors and handles on the board, over its frame: an
// anchor is a small square, a handle a round grip on a thin line to the anchor
// it shapes. A grip drags its point, previewing at most once a frame and
// committing once on release, and Escape takes the drag back. On a focused
// anchor the arrows nudge it, a burst of presses committing once, and Tab moves
// between anchors. Every grip takes a 28px press at any zoom.

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { MAX_PREVIEW_PATH_DATA_BYTES, type PreviewMatrix } from '../previewDocumentShape';
import type { PathSegment } from './pathData';
import { moveGrip, pathGrips, writePath, type PathGrip, type Point } from './pathModel';
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

export function PathGrips({
  shape,
  frame,
  scale,
  preview,
  commit,
}: {
  shape: PathShape;
  /** Where the path's frame is drawn on the board. */
  frame: Point;
  scale: number;
  /** Draws data on the path, or its own for null. */
  preview: (d: string | null) => void;
  commit: (d: string) => void;
}) {
  /** A move's segments, shown while `from` is still the shape read: until the next read after its commit. */
  const [moved, setMoved] = useState<{ from: PathSegment[]; segments: PathSegment[] } | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const press = useRef<Press | null>(null);
  /** The data the next frame previews, and then the data a commit writes. */
  const shown = useRef<string | null>(null);
  const frameRequest = useRef<number | null>(null);
  const nudgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopEscape = useRef<(() => void) | null>(null);

  const segments = moved?.from === shape.segments ? moved.segments : shape.segments;
  const grips = pathGrips(segments);
  const { matrix } = shape;

  useEffect(
    () => () => {
      if (frameRequest.current !== null) cancelAnimationFrame(frameRequest.current);
      if (nudgeTimer.current !== null) clearTimeout(nudgeTimer.current);
      stopEscape.current?.();
    },
    [],
  );

  const show = (next: PathSegment[]) => {
    const d = writePath(next);
    // Data past what the preview takes is never drawn, so the move holds where it last was.
    if (d.length > MAX_PREVIEW_PATH_DATA_BYTES) return;
    setMoved({ from: shape.segments, segments: next });
    shown.current = d;
    frameRequest.current ??= requestAnimationFrame(() => {
      frameRequest.current = null;
      if (shown.current !== null) preview(shown.current);
    });
  };

  /** Ends a move: commits what it shows, or takes it back. */
  const settle = (keep: boolean) => {
    if (frameRequest.current !== null) cancelAnimationFrame(frameRequest.current);
    frameRequest.current = null;
    if (nudgeTimer.current !== null) clearTimeout(nudgeTimer.current);
    nudgeTimer.current = null;
    const d = shown.current;
    shown.current = null;
    if (d === null) return;
    if (keep && d !== writePath(shape.segments)) {
      commit(d);
      return;
    }
    preview(null);
    setMoved(null);
  };

  const endPress = (keep: boolean) => {
    const held = press.current;
    if (!held) return;
    press.current = null;
    stopEscape.current?.();
    stopEscape.current = null;
    setDragging(false);
    if (held.dragging) settle(keep);
  };

  const startDrag = (held: Press) => {
    held.dragging = true;
    setDragging(true);
    // The board's Escape would drop the selection, so a drag takes it first.
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      if (held.target.hasPointerCapture(held.pointerId))
        held.target.releasePointerCapture(held.pointerId);
      endPress(false);
    };
    window.addEventListener('keydown', onKey, true);
    stopEscape.current = () => {
      window.removeEventListener('keydown', onKey, true);
    };
  };

  const onPointerDown = (event: PointerEvent, grip: PathGrip) => {
    if (event.button !== 0 || !shape.movable) return;
    event.stopPropagation();
    // A nudge still settling commits first; the next move waits for it to save.
    if (nudgeTimer.current !== null) {
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
  };

  const onPointerMove = (event: PointerEvent) => {
    const held = press.current;
    if (held?.pointerId !== event.pointerId) return;
    const screen = { x: event.clientX - held.start.x, y: event.clientY - held.start.y };
    if (!held.dragging) {
      if (Math.hypot(screen.x, screen.y) < DRAG_START_PX) return;
      startDrag(held);
    }
    const delta = toPathUnits(matrix, { x: screen.x / scale, y: screen.y / scale });
    show(moveGrip(shape.segments, held.grip, delta));
  };

  const onKeyDown = (event: KeyboardEvent, grip: PathGrip) => {
    const step = arrowStep(event);
    if (step) {
      event.preventDefault();
      event.stopPropagation();
      if (!shape.movable || press.current) return;
      show(moveGrip(segments, grip, step));
      if (nudgeTimer.current !== null) clearTimeout(nudgeTimer.current);
      nudgeTimer.current = setTimeout(() => {
        settle(true);
      }, NUDGE_SETTLE_MS);
      return;
    }
    if (event.key === 'Escape' && nudgeTimer.current !== null) {
      event.stopPropagation();
      settle(false);
      return;
    }
    // Removing a point is not offered, and the board's Delete would remove the whole path.
    if (event.key === 'Delete' || event.key === 'Backspace') event.stopPropagation();
  };

  const anchors = grips.filter(({ kind }) => kind === 'anchor').length;
  let anchor = 0;
  return (
    <div
      data-path-grips
      data-dragging={dragging || undefined}
      data-readonly={!shape.movable || undefined}
      className="canvas-path-grips"
      style={{ left: frame.x, top: frame.y }}
    >
      <svg aria-hidden className="canvas-path-lines">
        {grips.flatMap((grip, index) =>
          grip.anchors.map((to, end) => {
            const a = drawnAt(matrix, grip.point);
            const b = drawnAt(matrix, to);
            return (
              <line key={`${String(index)}:${String(end)}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
            );
          }),
        )}
      </svg>
      {grips.map((grip, index) => {
        const at = drawnAt(matrix, grip.point);
        if (grip.kind === 'anchor') anchor += 1;
        return (
          <button
            key={index}
            type="button"
            data-path-grip={grip.kind}
            data-selected={focused === index || undefined}
            aria-disabled={!shape.movable || undefined}
            tabIndex={grip.kind === 'anchor' && shape.movable ? 0 : -1}
            aria-label={
              grip.kind === 'anchor'
                ? `Point ${String(anchor)} of ${String(anchors)}`
                : `Handle of point ${String(anchor + 1)}`
            }
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
            onPointerUp={(event) => {
              if (press.current?.pointerId === event.pointerId) endPress(true);
            }}
            onPointerCancel={() => {
              endPress(false);
            }}
            onLostPointerCapture={() => {
              endPress(false);
            }}
            onKeyDown={(event) => {
              onKeyDown(event, grip);
            }}
          />
        );
      })}
    </div>
  );
}

/** One path unit on the arrows, ten with Shift, in the path's own axes. */
function arrowStep(event: KeyboardEvent): Point | null {
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
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
