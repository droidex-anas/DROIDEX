import { useLayoutEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { Virtualizer } from '@tanstack/react-virtual';
import type { FeedItem } from './chatFeed';
import {
  CONVERSATION_LIST_WIDTH_SETTLE_MS,
  scrollMarginBetween,
  syncMeasureConversationList,
} from './conversationListState';

export function useConversationListLayout(
  listRef: RefObject<HTMLElement | null>,
  virtualizer: Virtualizer<HTMLElement, Element>,
  items: readonly FeedItem[],
  setScrollMargin: Dispatch<SetStateAction<number>>,
): void {
  const getScrollElement = virtualizer.options.getScrollElement;
  const measured = useRef(new WeakMap<Element, FeedItem>());
  const bindingRef = useRef<{
    chrome: Element[];
    observer: ResizeObserver;
    measureMargin: () => void;
  } | null>(null);

  useLayoutEffect(() => {
    const list = listRef.current;
    const scroll = getScrollElement();
    if (!list || !scroll) return;
    const measureMargin = () => {
      const next = scrollMarginBetween(list, scroll);
      setScrollMargin((current) => (Math.abs(next - current) > 0.5 ? next : current));
    };
    measureMargin();
    if (typeof ResizeObserver === 'undefined') return;
    let lastWidth = list.clientWidth;
    let settle: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target !== list) {
          measureMargin();
          continue;
        }
        const width = entry.contentRect.width;
        if (Math.abs(width - lastWidth) < 0.5) continue;
        lastWidth = width;
        clearTimeout(settle);
        // Keep offscreen sizes: clearing the cache would move the reader when
        // a sidebar animation reflows only the mounted window.
        settle = setTimeout(() => {
          syncMeasureConversationList(list, virtualizer.resizeItem);
        }, CONVERSATION_LIST_WIDTH_SETTLE_MS);
      }
    });
    // Entrance transforms and layout classes move the origin without resizing
    // chrome. Ignore the list itself, whose height changes on every delta.
    const styles = new MutationObserver(measureMargin);
    for (let node = list.parentElement; node && node !== scroll; node = node.parentElement) {
      styles.observe(node, { attributes: true, attributeFilter: ['style', 'class'] });
    }
    observer.observe(list);
    bindingRef.current = { chrome: [], observer, measureMargin };
    return () => {
      observer.disconnect();
      styles.disconnect();
      clearTimeout(settle);
      bindingRef.current = null;
    };
  }, [getScrollElement, listRef, virtualizer, setScrollMargin]);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    syncMeasureConversationList(list, virtualizer.resizeItem, {
      items,
      measured: measured.current,
    });
    const binding = bindingRef.current;
    if (!binding) return;
    // Observe preceding chrome, not ancestor heights that grow on every delta.
    const chrome: Element[] = [];
    const scroll = getScrollElement();
    for (let node: Element | null = list; node && node !== scroll; node = node.parentElement) {
      for (
        let sibling = node.previousElementSibling;
        sibling;
        sibling = sibling.previousElementSibling
      ) {
        chrome.push(sibling);
      }
    }
    if (
      chrome.length === binding.chrome.length &&
      chrome.every((node, index) => node === binding.chrome[index])
    )
      return;
    for (const node of binding.chrome) binding.observer.unobserve(node);
    for (const node of chrome) binding.observer.observe(node);
    binding.chrome = chrome;
    binding.measureMargin();
  });
}
