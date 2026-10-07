import { canvasError } from './canvasError.js';
import type { FrameRect } from './schema.js';

/** The same gap used for ordinary Canvas frame creation. */
export const FRAME_GAP_PX = 80;

/** V2: the original sits above rows of two independently reserved variants. */
export function placeVariants(
  source: FrameRect,
  existing: readonly FrameRect[],
  count: number,
  size: Pick<FrameRect, 'width' | 'height'>,
): FrameRect[] {
  const occupied = [source, ...existing];
  const positions: FrameRect[] = [];
  let y = source.y + source.height + FRAME_GAP_PX;
  while (positions.length < count) {
    const columns = Math.min(2, count - positions.length);
    const row = Array.from({ length: columns }, (_, column) => ({
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
    if (blocking.length > 0) {
      // Jump over tall occupied frames instead of walking arbitrarily many rows.
      const nextY = blocking.reduce(
        (next, rect) => Math.max(next, bottomWithGap(rect)),
        y + size.height + FRAME_GAP_PX,
      );
      if (nextY <= y)
        throw canvasError(
          'invalid_input',
          'Move the source closer to the board origin and try again.',
        );
      y = nextY;
      continue;
    }
    positions.push(...row);
    occupied.push(...row);
    y += size.height + FRAME_GAP_PX;
  }
  return positions;
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
