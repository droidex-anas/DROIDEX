import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { defaultRangeExtractor, type Range } from '@tanstack/react-virtual';

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
  rowIndex: number;
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
      const rowIndex = rowIndexOf(position.offsetNode, list);
      if (rowIndex !== null) {
        return { node: position.offsetNode, offset: position.offset, rowIndex };
      }
    }
  }
  return null;
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
): (range: Range) => number[] {
  const spanRef = useRef<{ from: number; to: number } | null>(null);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    let drag: Drag | null = null;

    const extendSelection = (current: Drag) => {
      const scroller = getScrollElement();
      const span = spanRef.current;
      if (!scroller || !span) return;
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
      if (!caret) return;
      window.getSelection()?.extend(caret.node, caret.offset);
      span.from = Math.min(span.from, caret.rowIndex);
      span.to = Math.max(span.to, caret.rowIndex);
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
      if (window.getSelection()?.isCollapsed !== false) spanRef.current = null;
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
      spanRef.current = { from: caret.rowIndex, to: caret.rowIndex };
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
      if (!drag && window.getSelection()?.isCollapsed !== false) spanRef.current = null;
    };

    list.addEventListener('mousedown', onDown);
    document.addEventListener('selectionchange', onSelectionChange);
    return () => {
      stop();
      list.removeEventListener('mousedown', onDown);
      document.removeEventListener('selectionchange', onSelectionChange);
    };
  }, [getScrollElement, listRef]);

  return useCallback((range: Range) => {
    const indexes = defaultRangeExtractor(range);
    const span = spanRef.current;
    const last = indexes.at(-1);
    // A span recorded before the rows changed may point past the new end.
    if (!span || last === undefined || span.to >= range.count) return indexes;
    const from = Math.min(span.from, indexes[0]);
    const to = Math.max(span.to, last);
    return Array.from({ length: to - from + 1 }, (_, offset) => from + offset);
  }, []);
}
