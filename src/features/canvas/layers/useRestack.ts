import { useState, type PointerEvent, type RefObject } from 'react';
import { boardPoint } from '../boardCoordinates';
import { moveRow } from './layerKeys';

// The design system's distance a press travels before it becomes a drag.
const DRAG_THRESHOLD_PX = 4;

interface Drag {
  designId: string;
  /** The pointer that pressed the handle; any other one is ignored until it lets go. */
  pointerId: number;
  /** Where the press started, in list pixels. */
  startY: number;
  /** The boundary between rows a frame can drop at that the pointer is nearest; null until it passes the threshold. */
  gap: number | null;
}

/**
 * Restacks the frames of a list whose rows, front to back, are `rows`, each
 * `rowPx` tall and each a frame's designId or null for a row inside an open
 * frame: from the keyboard by frame index, or by dragging a frame row's handle
 * to a boundary before another frame's row or at the end. The list holds the
 * pointer through a drag, so the dragged row may scroll out of the mounted
 * range; the drag follows its frame, not its index, in case the rows change under it.
 */
export function useRestack(
  list: RefObject<HTMLElement | null>,
  rows: readonly (string | null)[],
  rowPx: number,
  /** Every frame's designId, back to front. */
  onReorder: ((designIds: string[]) => void) | undefined,
) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const frameIds = rows.filter((row): row is string => row !== null);
  const from = drag ? frameIds.indexOf(drag.designId) : -1;
  const gap = drag?.gap ?? null;
  const to = gap === null ? -1 : framesBefore(rows, gap);
  // Dropping on either side of the frame itself moves nothing, so it marks nothing.
  const dropGap = gap !== null && from >= 0 && to !== from && to !== from + 1 ? gap : null;

  const restack = (designId: string, at: number) => {
    onReorder?.(moveRow(frameIds, frameIds.indexOf(designId), at).reverse());
  };
  // The pointer's height in the list's own pixels, which the app's UI zoom does not scale.
  const listY = (event: PointerEvent<HTMLElement>) =>
    list.current ? boardPoint(list.current, { x: event.clientX, y: event.clientY }).y : 0;
  return {
    /** Moves a frame `by` frames toward the back (+1) or front (-1); false when it is already at that end. */
    step: (designId: string, by: number): boolean => {
      const at = frameIds.indexOf(designId) + by;
      if (at < 0 || at >= frameIds.length) return false;
      restack(designId, at);
      return true;
    },
    dragging: gap !== null,
    /** The row boundary the dragged frame would drop at, as a row index. */
    dropGap,
    /** Ends a drag without moving its frame. */
    cancel: () => {
      if (!drag) return;
      if (list.current?.hasPointerCapture(drag.pointerId))
        list.current.releasePointerCapture(drag.pointerId);
      setDrag(null);
    },
    grab: (event: PointerEvent<HTMLElement>, designId: string) => {
      if (event.button !== 0 || drag || !list.current) return;
      event.preventDefault();
      event.stopPropagation();
      list.current.setPointerCapture(event.pointerId);
      setDrag({ designId, pointerId: event.pointerId, startY: listY(event), gap: null });
    },
    listHandlers: {
      onPointerMove: (event: PointerEvent<HTMLElement>) => {
        if (drag?.pointerId !== event.pointerId) return;
        const y = listY(event);
        if (drag.gap === null && Math.abs(y - drag.startY) < DRAG_THRESHOLD_PX) return;
        const next = nearestGap(rows, y / rowPx);
        if (next !== drag.gap) setDrag({ ...drag, gap: next });
      },
      onPointerUp: (event: PointerEvent<HTMLElement>) => {
        if (drag?.pointerId !== event.pointerId) return;
        setDrag(null);
        if (dropGap !== null) restack(drag.designId, to > from ? to - 1 : to);
      },
      onLostPointerCapture: (event: PointerEvent<HTMLElement>) => {
        if (drag?.pointerId === event.pointerId) setDrag(null);
      },
    },
  };
}

/** How many frames' rows come before the row boundary `gap`. */
function framesBefore(rows: readonly (string | null)[], gap: number): number {
  return rows.slice(0, gap).filter((row) => row !== null).length;
}

/** The boundary nearest `at`, in rows, among those before a frame's row and the end. */
function nearestGap(rows: readonly (string | null)[], at: number): number {
  let nearest = rows.length;
  rows.forEach((row, index) => {
    if (row !== null && Math.abs(index - at) < Math.abs(nearest - at)) nearest = index;
  });
  return nearest;
}
