import { useState } from 'react';
import type { ElementRef } from '../protocol';
import type { ElementEntry } from './ElementRow';
import type { LayerElements } from './layerElements';

/**
 * What the board's elements do to the panel's element rows: an element picked
 * on the board opens its frame and the rows that hold it and takes the
 * keyboard to its row, which the list then scrolls to; the element under the
 * board's pointer lights its row. A row's pick goes to its element's first
 * drawn instance, and that row stays the selected one while the pick holds.
 */
export function useElementRows(
  elements: LayerElements,
  rowOf: (designId: string, elementId: string) => string | null,
  reveal: (designId: string, elementId: string) => string | null,
  moveTo: (key: string) => void,
) {
  const { picked, hovered } = elements;
  /** The row the latest pick was made from, as an element can appear on several. */
  const [pickedFrom, setPickedFrom] = useState<{ key: string; elementId: string } | null>(null);
  // Null at first, so a pick made before the panel opened is revealed as it opens.
  const [seenPicked, setSeenPicked] = useState<ElementRef | null>(null);
  if (seenPicked !== picked) {
    setSeenPicked(picked);
    if (picked && picked.elementId !== pickedFrom?.elementId) {
      const key = reveal(picked.designId, picked.elementId);
      if (key !== null) moveTo(key);
    }
  }
  const pickedKey =
    picked &&
    (picked.elementId === pickedFrom?.elementId
      ? pickedFrom.key
      : rowOf(picked.designId, picked.elementId));
  return {
    pickedKey,
    litKey: hovered && rowOf(hovered.designId, hovered.element.elementId),
    pick: (row: ElementEntry) => {
      moveTo(row.key);
      if (!row.target) return;
      setPickedFrom({ key: row.key, elementId: row.target.elementId });
      elements.pick(row.frame.designId, row.target);
    },
  };
}
