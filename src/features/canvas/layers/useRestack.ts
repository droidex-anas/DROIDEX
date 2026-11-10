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
  /** The boundary between rows the pointer is nearest, 0 to rowIds.length; null until it passes the threshold. */
  gap: number | null;
}

/**
 * Restacks the frames whose rows, front to back, are `rowIds`, each `rowPx`
 * tall: from the keyboard by row index, or by dragging a row's handle. The
 * list holds the pointer through a drag, so the dragged row may scroll out of
 * the mounted range; the drag follows its frame, not its index, in case the
 * rows change under it.
 */
export function useRestack(
  list: RefObject<HTMLElement | null>,
  rowIds: readonly string[],
  rowPx: number,
  /** Every frame's designId, back to front. */
  onReorder: ((designIds: string[]) => void) | undefined,
) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const from = drag ? rowIds.indexOf(drag.designId) : -1;
  const gap = drag?.gap ?? null;
  // Dropping on either side of the row itself moves nothing, so it marks nothing.
  const dropGap = gap !== null && from >= 0 && gap !== from && gap !== from + 1 ? gap : null;

  const restack = (designId: string, to: number) => {
    onReorder?.(moveRow(rowIds, rowIds.indexOf(designId), to).reverse());
  };
  // The pointer's height in the list's own pixels, which the app's UI zoom does not scale.
  const listY = (event: PointerEvent<HTMLElement>) =>
    list.current ? boardPoint(list.current, { x: event.clientX, y: event.clientY }).y : 0;
  return {
    restack,
    dragging: gap !== null,
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
        const next = Math.min(rowIds.length, Math.max(0, Math.round(y / rowPx)));
        if (next !== drag.gap) setDrag({ ...drag, gap: next });
      },
      onPointerUp: (event: PointerEvent<HTMLElement>) => {
        if (drag?.pointerId !== event.pointerId) return;
        setDrag(null);
        if (dropGap !== null) restack(drag.designId, dropGap > from ? dropGap - 1 : dropGap);
      },
      onLostPointerCapture: (event: PointerEvent<HTMLElement>) => {
        if (drag?.pointerId === event.pointerId) setDrag(null);
      },
    },
  };
}
