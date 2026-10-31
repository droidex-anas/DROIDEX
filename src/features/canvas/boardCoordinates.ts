import type { Point } from './canvasGeometry';

/** Client pixels include the app's CSS zoom; board geometry does not. */
export function boardPoint(root: HTMLElement, client: Point): Point {
  const box = root.getBoundingClientRect();
  return {
    x: ((client.x - box.left) * root.offsetWidth) / box.width,
    y: ((client.y - box.top) * root.offsetHeight) / box.height,
  };
}

/** Wheel units become board-local pixels before either pan or zoom uses them. */
export function boardWheelDelta(root: HTMLElement, event: WheelEvent): Point {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    const style = getComputedStyle(root);
    const linePx = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
    return { x: event.deltaX * linePx, y: event.deltaY * linePx };
  }
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return { x: event.deltaX * root.clientWidth, y: event.deltaY * root.clientHeight };
  }
  const box = root.getBoundingClientRect();
  return {
    x: (event.deltaX * root.offsetWidth) / box.width,
    y: (event.deltaY * root.offsetHeight) / box.height,
  };
}
