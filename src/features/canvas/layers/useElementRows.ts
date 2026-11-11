import { useState } from 'react';
import type { PreviewNode } from '../previewDocument';
import type { ElementEntry } from './ElementRow';
import type { LayerElements } from './layerElements';
import type { RowSearch } from './useLayerRows';

/**
 * What the board's elements do to the panel's element rows: each pick in
 * Edit, from the board or a row, opens its frame and the rows that hold its
 * element's row and takes the keyboard to that row, which the list then
 * scrolls to; the element under the board's pointer lights its row. A row
 * picks its own drawn element, so the row selected is always the picked one's.
 */
export function useElementRows(
  elements: LayerElements,
  rowOf: (designId: string, node: PreviewNode) => string | null,
  reveal: (designId: string, node: PreviewNode) => RowSearch,
  moveTo: (key: string) => void,
) {
  const { picked, hovered } = elements;
  // Null at first, so a pick made before the panel opened is revealed as it opens.
  const [revealed, setRevealed] = useState<number | null>(null);
  if (picked && picked.pick !== revealed) {
    const search = reveal(picked.element.designId, picked.element);
    if (search.state !== 'waiting') setRevealed(picked.pick);
    if (search.state === 'found') moveTo(search.key);
  }
  return {
    pickedKey: picked && rowOf(picked.element.designId, picked.element),
    litKey: hovered && rowOf(hovered.designId, hovered.element),
    pick: (row: ElementEntry) => {
      moveTo(row.key);
      if (row.drawn?.state === 'drawn') elements.pick(row.frame.designId, row.drawn.node);
    },
  };
}
