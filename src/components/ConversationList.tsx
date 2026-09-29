import {
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

import type { FeedItem } from './chatFeed';
import type { ConversationViewportLayout } from '../hooks/conversationViewportAnchor';
import {
  updateConversationRowLookup,
  type ConversationRowLookup,
  CONVERSATION_LIST_ESTIMATE_PX,
  CONVERSATION_LIST_GAP_PX,
  CONVERSATION_LIST_INITIAL_RECT,
  CONVERSATION_LIST_OVERSCAN,
  CONVERSATION_LIST_PIN_THRESHOLD_PX,
  estimatedListEndOffset,
  findConversationRowIndex,
  isConversationAtLatest,
  nearestOverflowParent,
  shouldAdjustConversationRowOnSizeChange,
} from './conversationListState';
import { useConversationListLayout } from './useConversationListLayout';

export interface ConversationListHandle {
  scrollToRow: (rowId: string) => void;
  scrollToLatest: () => void;
  isAtLatest: () => boolean;
}

export interface ConversationListProps {
  items: readonly FeedItem[];
  updateKind?: 'full' | 'append' | 'prepend';
  rebuiltFromItemIndex?: number;
  children: (item: FeedItem, index: number) => ReactNode;
  scrollElementRef?: RefObject<HTMLElement | null>;
  viewportLayoutRef?: RefObject<ConversationViewportLayout | null>;
  listRef?: RefObject<ConversationListHandle | null>;
  initialScrollOffset?: number;
  onMountedRowsChange?: (count: number) => void;
}

export function ConversationList({
  items,
  updateKind = 'full',
  rebuiltFromItemIndex = 0,
  children,
  scrollElementRef,
  viewportLayoutRef,
  listRef,
  initialScrollOffset,
  onMountedRowsChange,
}: ConversationListProps) {
  const listElRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const lookupRef = useRef<ConversationRowLookup | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const onMountedRowsChangeRef = useRef(onMountedRowsChange);
  onMountedRowsChangeRef.current = onMountedRowsChange;

  const getScrollElement = useCallback((): HTMLElement | null => {
    if (scrollElementRef?.current) return scrollElementRef.current;
    const host = hostRef.current;
    return host ? nearestOverflowParent(host) : null;
  }, [scrollElementRef]);

  useLayoutEffect(() => {
    lookupRef.current = updateConversationRowLookup(
      lookupRef.current,
      items,
      updateKind === 'append' ? rebuiltFromItemIndex : 0,
    );
  }, [items, updateKind, rebuiltFromItemIndex]);

  const rowOrder = useRowOrderVersion(items, rebuiltFromItemIndex);
  // The virtualizer keeps each row's measured size by key, but it recomputes
  // row positions only when this function changes, so a new order gets a new one.
  const getItemKey = useCallback(
    (index: number) => itemsRef.current[index]?.key ?? index,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new order needs a new function
    [rowOrder],
  );

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement,
    estimateSize: () => CONVERSATION_LIST_ESTIMATE_PX,
    overscan: CONVERSATION_LIST_OVERSCAN,
    gap: CONVERSATION_LIST_GAP_PX,
    getItemKey,
    scrollMargin,
    initialRect: CONVERSATION_LIST_INITIAL_RECT,
    initialOffset: initialScrollOffset ?? estimatedListEndOffset(items.length),
    scrollEndThreshold: CONVERSATION_LIST_PIN_THRESHOLD_PX,
    useFlushSync: false,
    directDomUpdates: true,
    onChange: (instance) => {
      onMountedRowsChangeRef.current?.(instance.getVirtualIndexes().length);
    },
  });

  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = shouldAdjustConversationRowOnSizeChange;

  useConversationListLayout(listElRef, virtualizer, items, setScrollMargin);

  const setListNode = useCallback(
    (node: HTMLDivElement | null) => {
      listElRef.current = node;
      virtualizer.containerRef(node);
    },
    [virtualizer],
  );

  const virtualItems = virtualizer.getVirtualItems();

  useLayoutEffect(() => {
    onMountedRowsChangeRef.current?.(virtualItems.length);
  }, [virtualItems.length]);

  useLayoutEffect(
    () => () => {
      onMountedRowsChangeRef.current?.(0);
    },
    [],
  );

  const rowContentOffset = useCallback(
    (rowId: string): number | undefined => {
      const index = lookupRef.current && findConversationRowIndex(lookupRef.current, rowId);
      if (index == null) return undefined;
      // getVirtualItems rebuilds measurementsCache; start is otherwise missing for never-measured rows.
      virtualizer.getVirtualItems();
      return virtualizer.measurementsCache[index]?.start;
    },
    [virtualizer],
  );

  useLayoutEffect(() => {
    if (!viewportLayoutRef) return;
    viewportLayoutRef.current = { rowContentOffset };
    return () => {
      viewportLayoutRef.current = null;
    };
  }, [rowContentOffset, viewportLayoutRef]);

  useImperativeHandle(
    listRef,
    (): ConversationListHandle => ({
      scrollToRow(rowId: string) {
        const index = lookupRef.current && findConversationRowIndex(lookupRef.current, rowId);
        if (index == null) return;
        virtualizer.scrollToIndex(index, { align: 'start' });
      },
      scrollToLatest() {
        if (itemsRef.current.length === 0) return;
        virtualizer.scrollToIndex(itemsRef.current.length - 1, { align: 'end' });
      },
      isAtLatest() {
        const element = getScrollElement();
        if (!element) return true;
        return isConversationAtLatest(
          element.scrollHeight,
          element.scrollTop,
          element.clientHeight,
        );
      },
    }),
    [getScrollElement, virtualizer],
  );

  return (
    <div ref={hostRef}>
      <div ref={setListNode} style={{ width: '100%', position: 'relative' }}>
        {virtualItems.map((virtualRow) => {
          const item = items.at(virtualRow.index);
          if (!item) return null;
          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              // Rows are positioned siblings, so a later row paints over the
              // one before it. A message's copy control floats in the row gap
              // and would sit under the next row; the hovered row rises above,
              // and stays raised for the control's 300ms hide delay so it
              // fades instead of dropping behind the next row.
              className="z-0 [transition:z-index_0s_300ms] hover:z-[1] hover:[transition-delay:0s] focus-within:z-[1] focus-within:[transition-delay:0s]"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
              }}
            >
              {children(item, virtualRow.index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Counts the updates that put a different row at an index that already had
// one, as when a delivered steer moves down to where the model took it in.
// Appends and in-place updates leave it alone.
function useRowOrderVersion(items: readonly FeedItem[], rebuiltFromIndex: number): number {
  const seen = useRef({ items, version: 0 });
  const previous = seen.current.items;
  if (previous !== items) {
    let reordered = false;
    const end = Math.min(previous.length, items.length);
    for (let index = Math.min(rebuiltFromIndex, end); index < end && !reordered; index += 1)
      reordered = previous[index]?.key !== items[index]?.key;
    seen.current = { items, version: seen.current.version + (reordered ? 1 : 0) };
  }
  return seen.current.version;
}
