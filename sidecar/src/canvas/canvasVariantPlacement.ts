import { canvasError } from './canvasError.js';
import type { FrameRect } from './schema.js';

/** The same gap used for ordinary Canvas frame creation. */
export const FRAME_GAP_PX = 80;

/**
 * Variants sit in one row below the source, from its left edge and evenly
 * spaced. A row that would touch another frame moves down past it whole, so a
 * second set of variants lands below the first.
 */
export function placeVariants(
  source: FrameRect,
  existing: readonly FrameRect[],
  count: number,
  size: Pick<FrameRect, 'width' | 'height'>,
): FrameRect[] {
  const occupied = [source, ...existing];
  let y = bottomWithGap(source);
  for (;;) {
    const row = Array.from({ length: count }, (_, column) => ({
      x: source.x + column * (size.width + FRAME_GAP_PX),
      y,
      ...size,
    }));
    if (
      row.some(
        (rect) =>
          !Number.isFinite(rect.x) ||
          !Number.isFinite(rect.y) ||
          rect.x + size.width + FRAME_GAP_PX <= rect.x ||
          bottomWithGap(rect) <= rect.y,
      )
    )
      throw canvasError(
        'invalid_input',
        'Move the source closer to the board origin and try again.',
      );
    const blocking = occupied.filter((rect) => row.some((slot) => collides(slot, rect)));
    if (blocking.length === 0) return row;
    // Each blocker ends below this row's top, so the row always moves down.
    y = blocking.reduce((lowest, rect) => Math.max(lowest, bottomWithGap(rect)), y);
  }
}

function bottomWithGap(rect: FrameRect): number {
  return rect.y + rect.height + FRAME_GAP_PX;
}

function collides(left: FrameRect, right: FrameRect): boolean {
  return (
    left.x < right.x + right.width + FRAME_GAP_PX &&
    left.x + left.width + FRAME_GAP_PX > right.x &&
    left.y < bottomWithGap(right) &&
    bottomWithGap(left) > right.y
  );
}
