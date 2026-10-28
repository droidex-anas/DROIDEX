import { useCallback, useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import { useReducedMotion } from 'framer-motion';

const MIN_SCALE = 0.25;
const DOUBLE_CLICK_SCALE = 2;
export const ZOOM_STEP = 1.25;

// Scale is relative to the fitted size; offsets are the translation applied on
// top of the content's own layout position, whose centre is the transform origin.
interface ZoomView {
  scale: number;
  x: number;
  y: number;
  // Button and keyboard zooms ease; pinch, wheel and drag track the hand 1:1.
  eased: boolean;
}

interface Point {
  x: number;
  y: number;
}

// Where the untransformed content sits, in client coordinates, and the window
// it may travel in.
interface Layout {
  center: Point;
  width: number;
  height: number;
  viewport: DOMRect;
}

const FIT_VIEW: ZoomView = { scale: 1, x: 0, y: 0, eased: true };

// offsetLeft/offsetTop ignore transforms, so this is the fitted position no
// matter how far the content is zoomed or panned. The stage is the offset parent.
function measureLayout(
  stageRef: RefObject<HTMLElement | null>,
  contentRef: RefObject<HTMLElement | null>,
): Layout | null {
  const stage = stageRef.current;
  const content = contentRef.current;
  if (!stage || !content) return null;
  const viewport = stage.getBoundingClientRect();
  return {
    center: {
      x: viewport.left + content.offsetLeft + content.offsetWidth / 2,
      y: viewport.top + content.offsetTop + content.offsetHeight / 2,
    },
    width: content.offsetWidth,
    height: content.offsetHeight,
    viewport,
  };
}

// Content larger than the window keeps the window covered; smaller content
// stays wholly inside it. Both are the range between the two edge-aligned
// offsets, whichever way round they fall.
function clampAxis(offset: number, center: number, half: number, start: number, end: number) {
  const startAligned = start - center + half;
  const endAligned = end - center - half;
  const low = Math.min(startAligned, endAligned);
  const high = Math.max(startAligned, endAligned);
  return Math.min(high, Math.max(low, offset));
}

// At fit size or smaller the content re-centres, so a panned image cannot be lost.
function clampView(view: ZoomView, layout: Layout): ZoomView {
  if (view.scale <= 1) return { ...view, x: 0, y: 0 };
  const { center, viewport } = layout;
  return {
    ...view,
    x: clampAxis(view.x, center.x, (layout.width * view.scale) / 2, viewport.left, viewport.right),
    y: clampAxis(view.y, center.y, (layout.height * view.scale) / 2, viewport.top, viewport.bottom),
  };
}

function limitScale(requested: number, maxScale: number): number {
  return Math.min(maxScale, Math.max(MIN_SCALE, requested));
}

// Keeps the content point under `focus` fixed while the scale changes.
function zoomAbout(
  view: ZoomView,
  scale: number,
  focus: Point,
  layout: Layout,
  eased: boolean,
): ZoomView {
  const ratio = scale / view.scale;
  const fromCenter = { x: focus.x - layout.center.x, y: focus.y - layout.center.y };
  return clampView(
    {
      scale,
      x: fromCenter.x - (fromCenter.x - view.x) * ratio,
      y: fromCenter.y - (fromCenter.y - view.y) * ratio,
      eased,
    },
    layout,
  );
}

function viewportCenter(layout: Layout): Point {
  const { viewport } = layout;
  return { x: viewport.left + viewport.width / 2, y: viewport.top + viewport.height / 2 };
}

/**
 * Zoom and pan for a full-window viewer: `contentRef` is the transformed
 * element, laid out inside `stageRef`, which fills the window. Ctrl/Cmd + wheel
 * zooms toward the pointer (a trackpad pinch arrives as Ctrl + wheel; touch
 * screens get no pinch), a plain wheel or a drag pans once zoomed in, and
 * double-click toggles between fit and 2x. `maxScale` is relative to the
 * fitted size.
 */
export function useZoomPan({
  stageRef,
  contentRef,
  enabled,
  maxScale,
}: {
  stageRef: RefObject<HTMLElement | null>;
  contentRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  maxScale: number;
}) {
  const [view, setView] = useState<ZoomView>(FIT_VIEW);
  const drag = useRef<{ pointerId: number; start: Point; origin: Point; layout: Layout } | null>(
    null,
  );
  const [dragging, setDragging] = useState(false);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !enabled) return;
    // Registered natively: React's wheel listener is passive, and a pinch must
    // not fall through to Chromium's page zoom.
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const layout = measureLayout(stageRef, contentRef);
      if (!layout) return;
      if (event.ctrlKey || event.metaKey) {
        const focus = { x: event.clientX, y: event.clientY };
        const factor = Math.exp(-event.deltaY * 0.01);
        setView((current) =>
          zoomAbout(current, limitScale(current.scale * factor, maxScale), focus, layout, false),
        );
        return;
      }
      setView((current) =>
        current.scale <= 1
          ? current
          : clampView(
              {
                ...current,
                x: current.x - event.deltaX,
                y: current.y - event.deltaY,
                eased: false,
              },
              layout,
            ),
      );
    };
    // A smaller window shrinks the room to pan in; pull the view back inside it.
    const onResize = () => {
      const layout = measureLayout(stageRef, contentRef);
      if (layout) setView((current) => clampView(current, layout));
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('resize', onResize);
    return () => {
      stage.removeEventListener('wheel', onWheel);
      window.removeEventListener('resize', onResize);
    };
  }, [contentRef, enabled, maxScale, stageRef]);

  // A larger window shrinks how far the image is scaled down to fit, which
  // lowers the ceiling relative to the fit; bring a deeper zoom back under it.
  useEffect(() => {
    const layout = measureLayout(stageRef, contentRef);
    if (!layout) return;
    setView((current) =>
      current.scale <= maxScale
        ? current
        : zoomAbout(current, maxScale, viewportCenter(layout), layout, false),
    );
  }, [contentRef, maxScale, stageRef]);

  // Stable across zoom steps so a caller's key listener is not re-registered
  // on every wheel tick.
  const zoomBy = useCallback(
    (factor: number) => {
      const layout = measureLayout(stageRef, contentRef);
      if (!layout) return;
      const focus = viewportCenter(layout);
      setView((current) =>
        zoomAbout(current, limitScale(current.scale * factor, maxScale), focus, layout, true),
      );
    },
    [contentRef, maxScale, stageRef],
  );

  const reset = useCallback(() => {
    setView(FIT_VIEW);
  }, []);

  const toggleAt = (clientX: number, clientY: number) => {
    const layout = measureLayout(stageRef, contentRef);
    if (!layout) return;
    const focus = { x: clientX, y: clientY };
    setView((current) =>
      current.scale > 1
        ? FIT_VIEW
        : zoomAbout(current, limitScale(DOUBLE_CLICK_SCALE, maxScale), focus, layout, true),
    );
  };

  const endDrag = (event: PointerEvent<HTMLElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
  };

  const contentHandlers = {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      // A second finger must not take over the pan from the first.
      if (drag.current || view.scale <= 1 || event.button !== 0) return;
      const layout = measureLayout(stageRef, contentRef);
      if (!layout) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = {
        pointerId: event.pointerId,
        start: { x: event.clientX, y: event.clientY },
        origin: { x: view.x, y: view.y },
        layout,
      };
      setDragging(true);
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const active = drag.current;
      if (active?.pointerId !== event.pointerId) return;
      setView((current) =>
        clampView(
          {
            ...current,
            x: active.origin.x + event.clientX - active.start.x,
            y: active.origin.y + event.clientY - active.start.y,
            eased: false,
          },
          active.layout,
        ),
      );
    },
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
  };

  let cursor = 'cursor-zoom-in';
  if (view.scale > 1) cursor = dragging ? 'cursor-grabbing' : 'cursor-grab';

  return {
    scale: view.scale,
    canZoomIn: view.scale < maxScale,
    canZoomOut: view.scale > MIN_SCALE,
    zoomBy,
    reset,
    toggleAt,
    contentHandlers,
    contentCursor: cursor,
    contentStyle: {
      transform: `translate(${String(view.x)}px, ${String(view.y)}px) scale(${String(view.scale)})`,
      transition:
        view.eased && !reduceMotion ? 'transform 180ms cubic-bezier(0.16, 1, 0.3, 1)' : 'none',
    },
  };
}
