// The board's viewport and everything that moves it: the measured board box,
// pan, pointer-anchored zoom, the one Fit it may take before the user has
// navigated, the eased programmatic focus, and the quiet window a wheel gesture
// needs because it has no end event.
//
// The board owns the pointer gesture machine and pans through `panByScreen`
// from it. Nothing here knows about frames beyond the rects it is asked to fit.

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { boardPoint, boardWheelDelta } from './boardCoordinates';
import type { CanvasMotion } from './canvasMotion';
import {
  fitFrames,
  interpolateViewport,
  wheelZoomScale,
  zoomAtPoint,
  type Point,
  type Viewport,
} from './canvasGeometry';
import type { FrameRect } from './protocol';

/**
 * A wheel gesture has no end event — trackpad momentum keeps arriving after the
 * fingers lift — so going quiet is the only honest sign that one is over.
 */
const SCROLL_IDLE_MS = 140;

const IDENTITY: Viewport = { x: 0, y: 0, scale: 1 };

export interface BoardViewport {
  viewport: Viewport;
  /** The board element's own box in board-local pixels, as last measured. */
  size: Point;
  panByScreen: (screenDelta: Point) => void;
  /** Fit and focus are the same operation; focus just passes one rect. */
  fitTo: (rects: readonly FrameRect[]) => void;
  /** Eases to `scale` about the board's centre, as the zoom menu and keys ask. */
  zoomTo: (scale: number) => void;
  /** Ends any running focus animation, so a hand gesture is never fought. */
  stopAnimating: () => void;
  /** True while a wheel gesture is still arriving. */
  scrolling: boolean;
  /** Marks the viewport as the user's, which retires the board's one Fit. */
  markNavigated: () => void;
}

export function useBoardViewport(
  board: RefObject<HTMLElement | null>,
  /** The frames the board's single opening Fit should frame. */
  frames: readonly { rect: FrameRect }[],
  /** Spec §11's timings; a zero `focusMs` is reduced motion asking for none. */
  motion: CanvasMotion,
): BoardViewport {
  const [viewport, setViewport] = useState<Viewport>(IDENTITY);
  const [scrolling, setScrolling] = useState(false);
  const [size, setSize] = useState<Point>({ x: 0, y: 0 });

  const animation = useRef<number | null>(null);
  const scroll = useRef<ScrollGesture>({ active: false, suppressed: false, idle: null });
  const measured = useRef<Point>({ x: 0, y: 0 });
  const opening = useRef({ fitted: false, navigated: false });
  // What the listeners below need from the current render. They are registered
  // once, or run from an animation frame, so they cannot close over it. The
  // frames are also how a resize finds something to fit.
  const latest = useRef({ viewport, frames });
  latest.current = { viewport, frames };

  const stopAnimating = useCallback(() => {
    if (animation.current !== null) cancelAnimationFrame(animation.current);
    animation.current = null;
  }, []);

  const markNavigated = useCallback(() => {
    opening.current.navigated = true;
  }, []);

  const panByScreen = useCallback((screenDelta: Point) => {
    setViewport((current) => ({
      ...current,
      x: current.x + screenDelta.x,
      y: current.y + screenDelta.y,
    }));
  }, []);

  /** Every programmatic move: fit, focus and the zoom commands. */
  const animateTo = useCallback(
    (target: Viewport) => {
      // A programmatic move owns the rest of an arriving wheel gesture, whether
      // or not it animates, so trailing momentum cannot undo what was asked for.
      if (scroll.current.active) scroll.current.suppressed = true;
      stopAnimating();
      opening.current.navigated = true;
      if (motion.focusMs === 0) {
        setViewport(target);
        return;
      }
      const from = latest.current.viewport;
      const started = performance.now();
      const step = () => {
        const progress = Math.min(1, (performance.now() - started) / motion.focusMs);
        setViewport(interpolateViewport(from, target, easeProgress(progress, motion.ease)));
        animation.current = progress < 1 ? requestAnimationFrame(step) : null;
      };
      animation.current = requestAnimationFrame(step);
    },
    [motion, stopAnimating],
  );

  const fitTo = useCallback(
    (rects: readonly FrameRect[]) => {
      if (rects.length > 0) animateTo(fitFrames(rects, measured.current));
    },
    [animateTo],
  );

  const zoomTo = useCallback(
    (scale: number) => {
      const centre = { x: measured.current.x / 2, y: measured.current.y / 2 };
      animateTo(zoomAtPoint(latest.current.viewport, centre, scale));
    },
    [animateTo],
  );

  /** Spec §4: the board may fit once, before the user has navigated. */
  const fitOnce = useCallback(() => {
    const held = latest.current.frames;
    if (opening.current.fitted || opening.current.navigated) return;
    if (held.length === 0 || measured.current.x === 0) return;
    opening.current.fitted = true;
    setViewport(
      fitFrames(
        held.map((frame) => frame.rect),
        measured.current,
      ),
    );
  }, []);

  useEffect(() => {
    fitOnce();
  }, [fitOnce, frames]);

  useEffect(() => {
    const root = board.current;
    if (!root) return undefined;
    const observer = new ResizeObserver(() => {
      measured.current = { x: root.clientWidth, y: root.clientHeight };
      setSize(measured.current);
      fitOnce();
    });
    observer.observe(root);
    return () => {
      observer.disconnect();
    };
  }, [board, fitOnce]);

  /**
   * Extends the wheel gesture in flight. `scroll.current` is what the wheel
   * handler reads synchronously while one is running; `scrolling` mirrors it for
   * the callers that have to wait until it is over.
   */
  const markScrolling = useCallback(() => {
    if (scroll.current.idle !== null) clearTimeout(scroll.current.idle);
    if (!scroll.current.active) {
      scroll.current.active = true;
      setScrolling(true);
    }
    scroll.current.idle = setTimeout(() => {
      scroll.current = { active: false, suppressed: false, idle: null };
      setScrolling(false);
    }, SCROLL_IDLE_MS);
  }, []);

  // Wheel has to be a non-passive listener of its own: React's root listener is
  // passive, so the default Electron page zoom could not be prevented there.
  useEffect(() => {
    const root = board.current;
    if (!root) return undefined;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      markScrolling();
      // Fit owns the rest of this wheel gesture, even after its animation ends.
      if (scroll.current.suppressed) return;
      stopAnimating();
      const pointer = boardPoint(root, { x: event.clientX, y: event.clientY });
      const delta = boardWheelDelta(root, event);
      opening.current.navigated = true;
      setViewport((current) => {
        // A plain wheel or two-finger scroll pans. A pinch arrives as a wheel
        // with `ctrlKey` set, and cmd held is the mouse's way of asking for the
        // same thing; both zoom under the pointer.
        if (event.ctrlKey || event.metaKey) {
          return zoomAtPoint(
            current,
            pointer,
            wheelZoomScale(current.scale, delta.y, event.ctrlKey),
          );
        }
        return { ...current, x: current.x - delta.x, y: current.y - delta.y };
      });
    };
    root.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      root.removeEventListener('wheel', onWheel);
    };
  }, [board, markScrolling, stopAnimating]);

  useEffect(
    () => () => {
      if (animation.current !== null) cancelAnimationFrame(animation.current);
      if (scroll.current.idle !== null) clearTimeout(scroll.current.idle);
    },
    [],
  );

  return { viewport, size, panByScreen, fitTo, zoomTo, stopAnimating, scrolling, markNavigated };
}

interface ScrollGesture {
  active: boolean;
  suppressed: boolean;
  idle: ReturnType<typeof setTimeout> | null;
}

function bezier(a: number, b: number, t: number): number {
  return ((1 - 3 * b + 3 * a) * t + (3 * b - 6 * a)) * t * t + 3 * a * t;
}

function bezierSlope(a: number, b: number, t: number): number {
  return 3 * (1 - 3 * b + 3 * a) * t * t + 2 * (3 * b - 6 * a) * t + 3 * a;
}

/**
 * The motion token's CSS easing curve, evaluated at `progress`. The curve is
 * given as x and y control points, so finding y means solving the x polynomial
 * for the parameter first; six Newton steps land well inside a pixel.
 */
function easeProgress(progress: number, [x1, y1, x2, y2]: CanvasMotion['ease']): number {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  let t = progress;
  for (let step = 0; step < 6; step += 1) {
    const error = bezier(x1, x2, t) - progress;
    const slope = bezierSlope(x1, x2, t);
    if (Math.abs(error) < 1e-5 || slope === 0) break;
    t -= error / slope;
  }
  return bezier(y1, y2, t);
}
