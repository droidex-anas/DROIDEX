// The board: one transformed world layer, the pan/zoom/Fit gestures on it, and
// transient frame dragging that writes layout once, on release.
//
// Frames render a placeholder body here. 5c mounts `DesignPreview` in the same
// slot and toggles `capturePointer` for Select and Interact; the header stays
// the drag handle in both modes (spec §4).

import { useCallback, useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import {
  fitFrames,
  interpolateViewport,
  reduceFrameDrag,
  wheelZoomScale,
  zoomAtPoint,
  type FrameDrag,
  type Point,
  type Viewport,
} from './canvasGeometry';
import { waitingLabel } from './previewLabels';
import type { ArrangeFramesInput, CanvasFrame, CanvasSnapshot, FrameRect } from './protocol';

/** Spec §11: a programmatic fit or focus, eased. */
const FOCUS_DURATION_MS = 220;

/**
 * A wheel gesture has no end event — trackpad momentum keeps arriving after the
 * fingers lift — so going quiet is the only honest sign that one is over.
 */
const SCROLL_IDLE_MS = 140;

const IDENTITY: Viewport = { x: 0, y: 0, scale: 1 };

export interface CanvasBoardProps {
  snapshot: CanvasSnapshot;
  /**
   * The one layout write a frame drag makes, sent on pointer release. 5a's
   * shell binds it to `CanvasClient.arrangeFrames` for this canvas.
   */
  onArrangeFrames: (input: ArrangeFramesInput) => Promise<unknown>;
  /**
   * Spec §4: Select mode installs a transparent input overlay over the guest
   * previews and Interact removes it. 5c owns the modes; the board owns when
   * flipping hit-testing is safe to do.
   */
  capturePointer?: boolean;
}

export function CanvasBoard({
  snapshot,
  onArrangeFrames,
  capturePointer = true,
}: CanvasBoardProps) {
  const reducedMotion = useReducedMotion() === true;
  const board = useRef<HTMLDivElement>(null);

  const [viewport, setViewport] = useState<Viewport>(IDENTITY);
  const [drag, setDrag] = useState<DraggedFrame | null>(null);
  const [pending, setPending] = useState<PendingLayout | null>(null);
  const [panning, setPanning] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [layoutError, setLayoutError] = useState('');
  const [overlayCapture, setOverlayCapture] = useState(capturePointer);
  const [scrollActive, setScrollActive] = useState(false);

  const gesture = useRef<Gesture | null>(null);
  const move = useRef<Coalesced>({ pointer: null, frame: null });
  const animation = useRef<number | null>(null);
  const scroll = useRef<ScrollGesture>({ active: false, idle: null });
  const size = useRef<Point>({ x: 0, y: 0 });
  const view = useRef({ fitted: false, navigated: false });
  // What the event handlers below need from the current render; they are
  // registered once, or run from an animation frame, so they cannot close over
  // it. The frames are also how a resize finds something to fit.
  const latest = useRef({ viewport, frames: snapshot.frames });
  latest.current = { viewport, frames: snapshot.frames };

  const stopAnimation = useCallback(() => {
    if (animation.current !== null) cancelAnimationFrame(animation.current);
    animation.current = null;
  }, []);

  /** Fit and focus are the same operation; focus just passes one rect. */
  const fitTo = useCallback(
    (rects: FrameRect[]) => {
      if (rects.length === 0) return;
      const target = fitFrames(rects, size.current);
      stopAnimation();
      view.current.navigated = true;
      if (reducedMotion) {
        setViewport(target);
        return;
      }
      const from = latest.current.viewport;
      const started = performance.now();
      const step = () => {
        const progress = Math.min(1, (performance.now() - started) / FOCUS_DURATION_MS);
        setViewport(interpolateViewport(from, target, easeFocus(progress)));
        animation.current = progress < 1 ? requestAnimationFrame(step) : null;
      };
      animation.current = requestAnimationFrame(step);
    },
    [reducedMotion, stopAnimation],
  );

  /** Spec §4: the board may fit once, before the user has navigated. */
  const fitOnce = useCallback(() => {
    const { frames } = latest.current;
    if (view.current.fitted || view.current.navigated) return;
    if (frames.length === 0 || size.current.x === 0) return;
    view.current.fitted = true;
    setViewport(
      fitFrames(
        frames.map((frame) => frame.rect),
        size.current,
      ),
    );
  }, []);

  useEffect(() => {
    fitOnce();
  }, [fitOnce, snapshot]);

  useEffect(() => {
    const root = board.current;
    if (!root) return undefined;
    const observer = new ResizeObserver(() => {
      size.current = { x: root.clientWidth, y: root.clientHeight };
      fitOnce();
    });
    observer.observe(root);
    return () => {
      observer.disconnect();
    };
  }, [fitOnce]);

  /**
   * Extends the wheel gesture in flight. `scroll.current` is what the wheel
   * handler reads synchronously while one is running; `scrollActive` mirrors it
   * for the effects that have to wait until it is over.
   */
  const markScrolling = useCallback(() => {
    if (scroll.current.idle !== null) clearTimeout(scroll.current.idle);
    if (!scroll.current.active) {
      scroll.current.active = true;
      setScrollActive(true);
    }
    scroll.current.idle = setTimeout(() => {
      scroll.current = { active: false, idle: null };
      setScrollActive(false);
    }, SCROLL_IDLE_MS);
  }, []);

  // Wheel has to be a non-passive listener of its own: React's root listener is
  // passive, so the default Electron page zoom could not be prevented there.
  useEffect(() => {
    const root = board.current;
    if (!root) return undefined;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const fresh = !scroll.current.active;
      markScrolling();
      // Momentum from a gesture that was already running when a fit started is
      // not a new request; only a gesture begun after it takes the viewport.
      if (animation.current !== null) {
        if (!fresh) return;
        stopAnimation();
      }
      const box = root.getBoundingClientRect();
      const pointer = { x: event.clientX - box.left, y: event.clientY - box.top };
      view.current.navigated = true;
      setViewport((current) =>
        zoomAtPoint(current, pointer, wheelZoomScale(current.scale, event.deltaY, event.ctrlKey)),
      );
    };
    root.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      root.removeEventListener('wheel', onWheel);
    };
  }, [markScrolling, stopAnimation]);

  useEffect(() => {
    if (overlayCapture === capturePointer) return undefined;
    // Flipping hit-testing mid-gesture would hand the rest of that gesture to a
    // different target, so the change waits for the wheel gesture to go quiet.
    // The frame after that paints the new state, so it is committed before any
    // later input is read against it.
    if (scrollActive) return undefined;
    const frame = requestAnimationFrame(() => {
      setOverlayCapture(capturePointer);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [capturePointer, overlayCapture, scrollActive]);

  useEffect(
    () => () => {
      if (animation.current !== null) cancelAnimationFrame(animation.current);
      if (move.current.frame !== null) cancelAnimationFrame(move.current.frame);
      if (scroll.current.idle !== null) clearTimeout(scroll.current.idle);
    },
    [],
  );

  /** Applies a pointer position to whichever gesture is running. */
  const applyPointer = (pointer: Point) => {
    const active = gesture.current;
    if (active === null) return;
    if (active.kind === 'pan') {
      const deltaX = pointer.x - active.last.x;
      const deltaY = pointer.y - active.last.y;
      active.last = pointer;
      setViewport((current) => ({ ...current, x: current.x + deltaX, y: current.y + deltaY }));
      return;
    }
    const stepped = reduceFrameDrag(active.drag, {
      type: 'move',
      pointerId: active.drag.pointerId,
      pointer,
      scale: latest.current.viewport.scale,
    }).drag;
    if (stepped === null) return;
    active.drag = stepped;
    setDrag({ designId: stepped.designId, rect: stepped.rect });
  };

  const flushMove = () => {
    move.current.frame = null;
    if (move.current.pointer !== null) applyPointer(move.current.pointer);
  };

  const stopCoalescing = useCallback(() => {
    if (move.current.frame !== null) cancelAnimationFrame(move.current.frame);
    move.current = { pointer: null, frame: null };
  }, []);

  const startPan = (pointerId: number, client: Point) => {
    const root = board.current;
    if (!root) return;
    root.setPointerCapture(pointerId);
    gesture.current = { kind: 'pan', pointerId, last: client };
    view.current.navigated = true;
    stopAnimation();
    setPanning(true);
  };

  const onBackgroundPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || gesture.current !== null) return;
    startPan(event.pointerId, { x: event.clientX, y: event.clientY });
  };

  const onFramePointerDown = (frame: CanvasFrame, event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || gesture.current !== null) return;
    event.stopPropagation();
    const client = { x: event.clientX, y: event.clientY };
    if (spaceHeld) {
      startPan(event.pointerId, client);
      return;
    }
    const root = board.current;
    if (!root) return;
    root.setPointerCapture(event.pointerId);
    stopAnimation();
    // The gesture starts from where the user sees the frame, which is not the
    // snapshot's rect while an earlier drag is still unacknowledged.
    const rect = renderedRect(frame, drag, pending);
    gesture.current = {
      kind: 'frame',
      drag: {
        designId: frame.designId,
        pointerId: event.pointerId,
        expectedLayoutVersion: frame.layoutVersion,
        origin: client,
        startRect: rect,
        rect,
      },
    };
    setDrag({ designId: frame.designId, rect });
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const active = gesture.current;
    if (active === null || event.pointerId !== pointerIdOf(active)) return;
    move.current.pointer = { x: event.clientX, y: event.clientY };
    // Spec §11: the transform updates once per animation frame, and the pointer
    // is followed 1:1 with no easing behind the hand.
    move.current.frame ??= requestAnimationFrame(flushMove);
  };

  const endGesture = (event: React.PointerEvent<HTMLDivElement>, released: boolean) => {
    const active = gesture.current;
    if (active === null || event.pointerId !== pointerIdOf(active)) return;
    stopCoalescing();
    // The release carries the hand's last position, and the frame coalescing it
    // may never have run; this settles `active.drag` on its final rect.
    if (released) applyPointer({ x: event.clientX, y: event.clientY });
    gesture.current = null;
    if (active.kind === 'pan') {
      setPanning(false);
      return;
    }
    const { commit } = reduceFrameDrag(
      active.drag,
      released ? { type: 'release', pointerId: active.drag.pointerId } : { type: 'cancel' },
    );
    setDrag(null);
    if (commit === null) return;
    const { designId, expectedLayoutVersion } = active.drag;
    setPending({ designId, rect: commit, afterLayoutVersion: expectedLayoutVersion });
    setLayoutError('');
    onArrangeFrames({
      mutationId: crypto.randomUUID(),
      frames: [{ designId, expectedLayoutVersion, rect: commit }],
    }).catch((error: unknown) => {
      // The snapshot's rect is authoritative again, so the frame returns to it.
      setPending((held) => (held?.rect === commit ? null : held));
      setLayoutError(layoutFailure(error));
    });
  };

  const cancelGesture = useCallback(() => {
    const active = gesture.current;
    if (active === null) return;
    gesture.current = null;
    stopCoalescing();
    board.current?.releasePointerCapture(pointerIdOf(active));
    setPanning(false);
    setDrag(null);
  }, [stopCoalescing]);

  // Escape has to reach a drag whatever has focus, so it is listened for only
  // while one is running.
  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancelGesture();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [cancelGesture, dragging]);

  // A released drag is drawn where the user left it until the sidecar answers;
  // a newer layout version is that answer, whatever rect it settled on.
  useEffect(() => {
    if (pending === null) return;
    const frame = snapshot.frames.find((candidate) => candidate.designId === pending.designId);
    if (!frame || frame.layoutVersion > pending.afterLayoutVersion) setPending(null);
  }, [pending, snapshot]);

  const { frames } = snapshot;
  return (
    <div
      ref={board}
      data-testid="canvas-board"
      tabIndex={0}
      aria-label="Design board"
      className="relative h-full min-h-0 w-full overflow-hidden bg-droid-bg outline-none"
      style={{ cursor: boardCursor(panning, spaceHeld), touchAction: 'none' }}
      onPointerDown={onBackgroundPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => {
        endGesture(event, true);
      }}
      onPointerCancel={(event) => {
        endGesture(event, false);
      }}
      onLostPointerCapture={(event) => {
        endGesture(event, false);
      }}
      onKeyDown={(event) => {
        // Space-pan belongs to the board itself. Spec §4: a control or an editor
        // inside it keeps its own Space, so a key from a descendant is left be.
        if (event.key !== ' ' || event.target !== event.currentTarget) return;
        event.preventDefault();
        setSpaceHeld(true);
      }}
      onKeyUp={(event) => {
        if (event.key === ' ') setSpaceHeld(false);
      }}
      onBlur={() => {
        setSpaceHeld(false);
      }}
    >
      <div
        className="absolute left-0 top-0"
        style={{
          transform: `translate(${String(viewport.x)}px, ${String(viewport.y)}px) scale(${String(viewport.scale)})`,
          transformOrigin: '0 0',
          willChange: 'transform',
        }}
      >
        {frames.map((frame) => (
          <BoardFrame
            key={frame.designId}
            frame={frame}
            rect={renderedRect(frame, drag, pending)}
            capturePointer={overlayCapture}
            onHeaderPointerDown={onFramePointerDown}
          />
        ))}
      </div>

      <div className="pointer-events-none absolute inset-x-3 bottom-3 flex items-center justify-between gap-3">
        <span className="rounded-full bg-droid-elevated px-2.5 py-1 text-[11px] text-droid-text-secondary">
          {Math.round(viewport.scale * 100)}%
        </span>
        <div className="flex min-w-0 items-center gap-2">
          {layoutError && (
            <p
              role="alert"
              className="truncate rounded-full bg-droid-elevated px-2.5 py-1 text-[11px] text-droid-red"
            >
              {layoutError}
            </p>
          )}
          <button
            type="button"
            disabled={frames.length === 0}
            onClick={() => {
              fitTo(frames.map((frame) => frame.rect));
            }}
            className="pointer-events-auto rounded-full bg-droid-elevated px-2.5 py-1 text-[11px] text-droid-text-secondary transition-colors hover:bg-droid-active disabled:opacity-60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-droid-accent/60"
          >
            Fit
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * One frame on the board. The header is the drag handle in every mode, and the
 * body carries the transparent overlay that gives the board pointer ownership
 * in Select (spec §4); 5c mounts the live preview under it.
 */
function BoardFrame({
  frame,
  rect,
  capturePointer,
  onHeaderPointerDown,
}: {
  frame: CanvasFrame;
  rect: FrameRect;
  capturePointer: boolean;
  onHeaderPointerDown: (frame: CanvasFrame, event: React.PointerEvent<HTMLElement>) => void;
}) {
  return (
    <div
      className="absolute flex flex-col gap-1"
      style={{ left: rect.x, top: rect.y, width: rect.width }}
    >
      <div
        onPointerDown={(event) => {
          onHeaderPointerDown(frame, event);
        }}
        className="flex items-center justify-between gap-2 rounded-lg px-1.5 py-0.5 text-[11px] text-droid-text-secondary transition-colors hover:bg-droid-elevated"
        style={{ cursor: 'grab', touchAction: 'none' }}
      >
        <span className="truncate">{frame.name}</span>
        <span className="shrink-0 text-droid-text-muted">
          {Math.round(rect.width)} × {Math.round(rect.height)}
        </span>
      </div>
      <div
        className="relative overflow-hidden rounded-xl bg-droid-raised shadow-droid-sm"
        style={{ height: rect.height }}
      >
        <div className="flex h-full w-full items-center justify-center px-4 text-center text-[12px] text-droid-text-secondary">
          {waitingLabel(frame.build)}
        </div>
        <div
          data-canvas-input-overlay
          className="absolute inset-0"
          style={{ pointerEvents: capturePointer ? 'auto' : 'none' }}
        />
      </div>
    </div>
  );
}

/** The frame the hand is holding, as the board draws it. */
interface DraggedFrame {
  designId: string;
  rect: FrameRect;
}

/** A released drag the sidecar has not acknowledged yet. */
interface PendingLayout {
  designId: string;
  rect: FrameRect;
  /** The layout version the commit expected; anything newer is the answer. */
  afterLayoutVersion: number;
}

type Gesture = { kind: 'pan'; pointerId: number; last: Point } | { kind: 'frame'; drag: FrameDrag };

/** The hand's latest position and the frame that will apply it. */
interface Coalesced {
  pointer: Point | null;
  frame: number | null;
}

interface ScrollGesture {
  active: boolean;
  idle: ReturnType<typeof setTimeout> | null;
}

function pointerIdOf(gesture: Gesture): number {
  return gesture.kind === 'pan' ? gesture.pointerId : gesture.drag.pointerId;
}

/** Where a frame is drawn: under the hand, awaiting an answer, or acknowledged. */
function renderedRect(
  frame: CanvasFrame,
  drag: DraggedFrame | null,
  pending: PendingLayout | null,
): FrameRect {
  if (drag?.designId === frame.designId) return drag.rect;
  if (pending?.designId === frame.designId) return pending.rect;
  return frame.rect;
}

function boardCursor(panning: boolean, spaceHeld: boolean): string {
  if (panning) return 'grabbing';
  return spaceHeld ? 'grab' : 'default';
}

function layoutFailure(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'That frame could not be moved.';
}

// cubic-bezier(0.22, 1, 0.36, 1) from spec §11, solved for y at a given x.
const EASE_X1 = 0.22;
const EASE_X2 = 0.36;

function bezier(a: number, b: number, t: number): number {
  return ((1 - 3 * b + 3 * a) * t + (3 * b - 6 * a)) * t * t + 3 * a * t;
}

function bezierSlope(a: number, b: number, t: number): number {
  return 3 * (1 - 3 * b + 3 * a) * t * t + 2 * (3 * b - 6 * a) * t + 3 * a;
}

function easeFocus(progress: number): number {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  let t = progress;
  for (let step = 0; step < 6; step += 1) {
    const error = bezier(EASE_X1, EASE_X2, t) - progress;
    const slope = bezierSlope(EASE_X1, EASE_X2, t);
    if (Math.abs(error) < 1e-5 || slope === 0) break;
    t -= error / slope;
  }
  // Both y control points are 1, which collapses the curve to this.
  return 1 - (1 - t) ** 3;
}
