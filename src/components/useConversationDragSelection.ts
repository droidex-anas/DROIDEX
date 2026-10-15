import { useCallback, useEffect, useMemo, useState, type RefObject } from 'react';
import { defaultRangeExtractor, type Range } from '@tanstack/react-virtual';

import type { FeedItem } from './chatFeed';
import { CONVERSATION_LIST_GAP_PX } from './conversationListState';

// Pointer depth into this band at a scroller's edge, or any distance past it,
// scrolls the content; the speed grows with the depth.
const EDGE_ZONE_PX = 32;
const SCROLL_PX_PER_DEPTH_PX = 0.3;
const MAX_SCROLL_PX_PER_FRAME = 36;
// A press on a control or on media keeps the browser's own handling.
const NATIVE_TARGETS =
  'a, button, input, textarea, select, summary, label, iframe, img, svg, [contenteditable], [role="button"], [draggable="true"]';

interface Caret {
  node: Node;
  offset: number;
}

type RowKey = string | number;

// Rows are held by key so a history prepend, which shifts every index, keeps
// the selected rows mounted.
interface SelectedRows {
  anchorKey: RowKey;
  focusKey: RowKey;
}

interface Drag {
  pointerX: number;
  pointerY: number;
  frame: number;
  // A code block that scrolls sideways follows the pointer past its edges.
  sideways: HTMLElement | null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function rowIndexOf(node: Node, list: HTMLElement): number | null {
  const element = node instanceof Element ? node : node.parentElement;
  const row = element?.closest<HTMLElement>('[data-index]');
  if (row?.parentElement !== list) return null;
  return Number(row.dataset.index);
}

// Rows are positioned siblings, so a point in the gap between two rows hits the
// list itself, which the browser resolves to the first mounted row. Probing a
// few pixels up and down finds the row text the pointer is actually beside.
function caretInRow(list: HTMLElement, x: number, y: number): Caret | null {
  for (let step = 0; step <= CONVERSATION_LIST_GAP_PX; step += 4) {
    for (const probeY of step === 0 ? [y] : [y - step, y + step]) {
      const position = document.caretPositionFromPoint(x, probeY);
      if (!position) continue;
      if (rowIndexOf(position.offsetNode, list) !== null) {
        return { node: position.offsetNode, offset: position.offset };
      }
    }
  }
  return null;
}

function selectedRowsIn(
  list: HTMLElement,
  getItemKey: (index: number) => RowKey,
): SelectedRows | null {
  const selection = window.getSelection();
  if (!selection?.anchorNode || !selection.focusNode || selection.isCollapsed) return null;
  const anchor = rowIndexOf(selection.anchorNode, list);
  const focus = rowIndexOf(selection.focusNode, list);
  if (anchor === null || focus === null) return null;
  return { anchorKey: getItemKey(anchor), focusKey: getItemKey(focus) };
}

function isSameRows(a: SelectedRows | null, b: SelectedRows | null): boolean {
  return a?.anchorKey === b?.anchorKey && a?.focusKey === b?.focusKey;
}

// How deep the pointer is in an edge band: negative toward the start edge,
// positive toward the end edge, zero in between.
function edgeDepth(pointer: number, start: number, end: number): number {
  if (pointer < start + EDGE_ZONE_PX) return pointer - (start + EDGE_ZONE_PX);
  if (pointer > end - EDGE_ZONE_PX) return pointer - (end - EDGE_ZONE_PX);
  return 0;
}

function scrollStep(depth: number): number {
  return clamp(depth * SCROLL_PX_PER_DEPTH_PX, -MAX_SCROLL_PX_PER_FRAME, MAX_SCROLL_PX_PER_FRAME);
}

function isInsideSelection(selection: Selection, x: number, y: number): boolean {
  if (selection.isCollapsed || selection.rangeCount === 0) return false;
  return Array.from(selection.getRangeAt(0).getClientRects()).some(
    (rect) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom,
  );
}

function sidewaysScroller(target: Element): HTMLElement | null {
  const pre = target.closest('pre');
  return pre && pre.scrollWidth > pre.clientWidth ? pre : null;
}

/**
 * Drag-to-select in the transcript, owned by the list rather than the browser.
 * The native drag resolves a pointer above the scroller, or in the gap between
 * positioned rows, to the start of the mounted rows and so selects everything
 * before it, and its autoscroll leaps by screens. Here the selection end
 * follows the pointer clamped to the visible rows, the scroller moves at a
 * speed set by how far past its edge the pointer is, and the rows a selection
 * spans stay mounted so the copied text has no holes.
 *
 * Returns the virtualizer's range extractor, which keeps those rows mounted.
 */
export function useConversationDragSelection(
  listRef: RefObject<HTMLElement | null>,
  getScrollElement: () => HTMLElement | null,
  items: readonly FeedItem[],
  getItemKey: (index: number) => RowKey,
): (range: Range) => number[] {
  const [selectedRows, setSelectedRows] = useState<SelectedRows | null>(null);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    let drag: Drag | null = null;

    const extendSelection = (current: Drag) => {
      const scroller = getScrollElement();
      if (!scroller) return;
      const listBox = list.getBoundingClientRect();
      const scrollBox = scroller.getBoundingClientRect();
      const caret = caretInRow(
        list,
        clamp(current.pointerX, listBox.left + 1, listBox.right - 1),
        clamp(
          current.pointerY,
          Math.max(listBox.top, scrollBox.top) + 1,
          Math.min(listBox.bottom, scrollBox.bottom) - 1,
        ),
      );
      if (caret) window.getSelection()?.extend(caret.node, caret.offset);
    };

    const tick = () => {
      const scroller = getScrollElement();
      if (!drag || !scroller) return;
      const box = scroller.getBoundingClientRect();
      const down = scrollStep(edgeDepth(drag.pointerY, box.top, box.bottom));
      if (down !== 0) scroller.scrollTop += down;
      let across = 0;
      if (drag.sideways) {
        const sideBox = drag.sideways.getBoundingClientRect();
        across = scrollStep(edgeDepth(drag.pointerX, sideBox.left, sideBox.right));
        if (across !== 0) drag.sideways.scrollLeft += across;
      }
      if (down !== 0 || across !== 0) extendSelection(drag);
      drag.frame = requestAnimationFrame(tick);
    };

    const onMove = (event: MouseEvent) => {
      if (!drag) return;
      drag.pointerX = event.clientX;
      drag.pointerY = event.clientY;
      extendSelection(drag);
    };

    const stop = () => {
      if (!drag) return;
      cancelAnimationFrame(drag.frame);
      drag = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', stop);
      window.removeEventListener('blur', stop);
    };

    const onDown = (event: MouseEvent) => {
      const { target } = event;
      if (event.button !== 0 || event.detail > 1) return;
      if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;
      if (!(target instanceof Element) || target.closest(NATIVE_TARGETS)) return;
      if (getComputedStyle(target).userSelect === 'none') return;
      const selection = window.getSelection();
      // Pressing on selected text may start dragging it into the composer.
      if (!selection || isInsideSelection(selection, event.clientX, event.clientY)) return;
      const caret = caretInRow(list, event.clientX, event.clientY);
      if (!caret) return;
      event.preventDefault();
      // Preventing the press also keeps focus where it was; a press on text
      // releases it, as the browser would.
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      selection.setBaseAndExtent(caret.node, caret.offset, caret.node, caret.offset);
      drag = {
        pointerX: event.clientX,
        pointerY: event.clientY,
        frame: requestAnimationFrame(tick),
        sideways: sidewaysScroller(target),
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', stop);
      window.addEventListener('blur', stop);
    };

    const onSelectionChange = () => {
      const next = selectedRowsIn(list, getItemKey);
      setSelectedRows((current) => (isSameRows(current, next) ? current : next));
    };

    list.addEventListener('mousedown', onDown);
    document.addEventListener('selectionchange', onSelectionChange);
    return () => {
      stop();
      list.removeEventListener('mousedown', onDown);
      document.removeEventListener('selectionchange', onSelectionChange);
    };
  }, [getItemKey, getScrollElement, listRef]);

  const selectedSpan = useMemo(() => {
    if (!selectedRows) return null;
    const anchor = items.findIndex((item) => item.key === selectedRows.anchorKey);
    const focus = items.findIndex((item) => item.key === selectedRows.focusKey);
    if (anchor < 0 || focus < 0) return null;
    return { from: Math.min(anchor, focus), to: Math.max(anchor, focus) };
  }, [items, selectedRows]);

  // TanStack memoizes the mounted rows on this function's identity, so it
  // changes whenever the selected span does.
  return useCallback(
    (range: Range) => {
      const indexes = defaultRangeExtractor(range);
      if (!selectedSpan) return indexes;
      const mounted = new Set(indexes);
      for (let index = selectedSpan.from; index <= selectedSpan.to; index += 1) mounted.add(index);
      return [...mounted].sort((a, b) => a - b);
    },
    [selectedSpan],
  );
}
