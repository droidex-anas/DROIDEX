import { useState, type PointerEvent, type RefObject } from 'react';
import { moveRow } from './layerKeys';

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
  // `gap` is the boundary between rows the pointer is nearest, 0 to rowIds.length.
  const [drag, setDrag] = useState<{ designId: string; gap: number } | null>(null);
  const from = drag ? rowIds.indexOf(drag.designId) : -1;
  // Dropping on either side of the row itself moves nothing, so it marks nothing.
  const dropGap = drag && from >= 0 && drag.gap !== from && drag.gap !== from + 1 ? drag.gap : null;

  const restack = (designId: string, to: number) => {
    onReorder?.(moveRow(rowIds, rowIds.indexOf(designId), to).reverse());
  };
  const gapAt = (clientY: number) => {
    const top = list.current?.getBoundingClientRect().top ?? 0;
    return Math.min(rowIds.length, Math.max(0, Math.round((clientY - top) / rowPx)));
  };
  return {
    restack,
    dragging: drag !== null,
    dropGap,
    grab: (event: PointerEvent<HTMLElement>, designId: string) => {
      if (event.button !== 0 || !list.current) return;
      event.preventDefault();
      event.stopPropagation();
      list.current.setPointerCapture(event.pointerId);
      setDrag({ designId, gap: gapAt(event.clientY) });
    },
    listHandlers: {
      onPointerMove: (event: PointerEvent<HTMLElement>) => {
        if (!drag) return;
        const gap = gapAt(event.clientY);
        if (gap !== drag.gap) setDrag({ designId: drag.designId, gap });
      },
      onPointerUp: () => {
        setDrag(null);
        if (drag && dropGap !== null)
          restack(drag.designId, dropGap > from ? dropGap - 1 : dropGap);
      },
      onLostPointerCapture: () => {
        setDrag(null);
      },
    },
  };
}
