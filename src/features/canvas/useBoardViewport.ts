// The board's viewport and everything that moves it: the measured board box,
// pan, pointer-anchored zoom, the one Fit it may take before the user has
// navigated, the eased programmatic focus, and the quiet window a wheel gesture
// needs because it has no end event.
//
// The board itself owns the pointer gesture machine and calls `panByScreen`
// from it. Nothing here knows about frames beyond the rects it is asked to fit.

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import {
  fitFrames,
  interpolateViewport,
  panBy,
  wheelZoomScale,
  zoomAtPoint,
  type Point,
  type Viewport,
} from './canvasGeometry';
import type { FrameRect } from './protocol';

/** Spec §11: a programmatic fit or focus, eased. */
const FOCUS_DURATION_MS = 220;

/**
 * A wheel gesture has no end event — trackpad momentum keeps arriving after the
 * fingers lift — so going quiet is the only honest sign that one is over.
 */
const SCROLL_IDLE_MS = 140;

const IDENTITY: Viewport = { x: 0, y: 0, scale: 1 };

export interface BoardViewport {
  viewport: Viewport;
  /** The board element's own box in screen pixels, as last measured. */
  size: Point;
  panByScreen: (screenDelta: Point) => void;
  /** Fit and focus are the same operation; focus just passes one rect. */
  fitTo: (rects: FrameRect[]) => void;
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
  reducedMotion: boolean,
): BoardViewport {
  const [viewport, setViewport] = useState<Viewport>(IDENTITY);
  const [scrolling, setScrolling] = useState(false);
  const [size, setSize] = useState<Point>({ x: 0, y: 0 });

  const animation = useRef<number | null>(null);
  const scroll = useRef<{ active: boolean; idle: ReturnType<typeof setTimeout> | null }>({
    active: false,
    idle: null,
  });
  const measured = useRef<Point>({ x: 0, y: 0 });
  const opening = useRef({ fitted: false, navigated: false });
  // What the listeners below need from the current render. They are registered
  // once, or run from an animation frame, so they cannot close over it.
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
    setViewport((current) => panBy(current, screenDelta));
  }, []);

  const fitTo = useCallback(
    (rects: FrameRect[]) => {
      if (rects.length === 0) return;
      const target = fitFrames(rects, measured.current);
      stopAnimating();
      opening.current.navigated = true;
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
    [reducedMotion, stopAnimating],
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
      scroll.current = { active: false, idle: null };
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
      const fresh = !scroll.current.active;
      markScrolling();
      // Momentum from a gesture that was already running when a fit started is
      // not a new request; only a gesture begun after it takes the viewport.
      if (animation.current !== null) {
        if (!fresh) return;
        stopAnimating();
      }
      opening.current.navigated = true;
      // A plain wheel or two-finger scroll pans. A pinch arrives as a wheel with
      // `ctrlKey` set, and ctrl/cmd held is the mouse's way of asking for the
      // same thing; both zoom under the pointer.
      if (!event.ctrlKey && !event.metaKey) {
        setViewport((current) => panBy(current, { x: -event.deltaX, y: -event.deltaY }));
        return;
      }
      const box = root.getBoundingClientRect();
      const pointer = { x: event.clientX - box.left, y: event.clientY - box.top };
      setViewport((current) =>
        zoomAtPoint(current, pointer, wheelZoomScale(current.scale, event.deltaY)),
      );
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

  return { viewport, size, panByScreen, fitTo, stopAnimating, scrolling, markNavigated };
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
