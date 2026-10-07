import type { Point } from './canvasGeometry';

/** Client pixels include the app's CSS zoom; board geometry does not. */
export function boardPoint(root: HTMLElement, client: Point): Point {
  const box = root.getBoundingClientRect();
  return {
    x: ((client.x - box.left) * root.offsetWidth) / box.width,
    y: ((client.y - box.top) * root.offsetHeight) / box.height,
  };
}
