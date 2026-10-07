// The board: one transformed world layer, the pan/zoom/Fit gestures on it, and
// transient frame dragging that writes layout once, on release.
//
// Frames render a placeholder body here. 5c mounts `DesignPreview` in the same
// slot and toggles `capturePointer` for Select and Interact; the header stays
// the drag handle in both modes (spec §4).

import { useCallback, useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { boardPoint } from './boardCoordinates';
import {
  fitFrames,
  interpolateViewport,
  wheelZoomScale,
  zoomAtPoint,
  type Point,
  type Viewport,
} from './canvasGeometry';
import { waitingLabel } from './previewLabels';
import type { ArrangeFramesInput, CanvasFrame, CanvasSnapshot, FrameRect } from './protocol';
import { useBoardGestures } from './useBoardGestures';

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
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [overlayCapture, setOverlayCapture] = useState(capturePointer);
  const [scrollActive, setScrollActive] = useState(false);

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

  const gestures = useBoardGestures({
    board,
    frames: snapshot.frames,
    scale: viewport.scale,
    spaceHeld,
    onStart: () => {
      view.current.navigated = true;
      stopAnimation();
    },
    onPan: (delta) => {
      setViewport((current) => ({ ...current, x: current.x + delta.x, y: current.y + delta.y }));
    },
    onArrangeFrames,
  });

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
      const pointer = boardPoint(root, { x: event.clientX, y: event.clientY });
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
      if (scroll.current.idle !== null) clearTimeout(scroll.current.idle);
    },
    [],
  );

  const { frames } = snapshot;
  return (
    <div
      ref={board}
      data-testid="canvas-board"
      tabIndex={0}
      aria-label="Design board"
      className="relative h-full min-h-0 w-full overflow-hidden bg-droid-bg outline-none"
      style={{ cursor: boardCursor(gestures.panning, spaceHeld), touchAction: 'none' }}
      onPointerDown={gestures.onBackgroundPointerDown}
      onPointerMove={gestures.onPointerMove}
      onPointerUp={(event) => {
        gestures.endGesture(event, true);
      }}
      onPointerCancel={(event) => {
        gestures.endGesture(event, false);
      }}
      onLostPointerCapture={(event) => {
        gestures.endGesture(event, false);
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
      onBlur={(event) => {
        setSpaceHeld(false);
        gestures.onBlur(event);
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
            rect={gestures.rectFor(frame)}
            capturePointer={overlayCapture}
            onHeaderPointerDown={gestures.onFramePointerDown}
          />
        ))}
      </div>

      <div
        // The board's own controls are not background: a pan started here would
        // capture the pointer and the button would never see its click.
        onPointerDown={(event) => {
          event.stopPropagation();
        }}
        className="pointer-events-none absolute inset-x-3 bottom-3 flex items-center justify-between gap-3"
      >
        <span className="rounded-full bg-droid-elevated px-2.5 py-1 text-[11px] text-droid-text-secondary">
          {Math.round(viewport.scale * 100)}%
        </span>
        <div className="flex min-w-0 items-center gap-2">
          {gestures.layoutError && (
            <p
              role="alert"
              className="truncate rounded-full bg-droid-elevated px-2.5 py-1 text-[11px] text-droid-red"
            >
              {gestures.layoutError}
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

interface ScrollGesture {
  active: boolean;
  idle: ReturnType<typeof setTimeout> | null;
}

function boardCursor(panning: boolean, spaceHeld: boolean): string {
  if (panning) return 'grabbing';
  return spaceHeld ? 'grab' : 'default';
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
