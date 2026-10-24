import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react';
import {
  captureViewportAnchor,
  restoreViewportAnchor,
  type ConversationViewportLayout,
  type ViewportAnchor,
} from '../../hooks/conversationViewportAnchor';
import type { FeedItem } from '../chatFeed';
import { isConversationAtLatest } from '../conversationListState';

export function useAgentPaneScroll(
  scrollRef: RefObject<HTMLDivElement | null>,
  childSessionId: string,
  items: readonly FeedItem[],
) {
  const viewportLayoutRef = useRef<ConversationViewportLayout | null>(null);
  const pinned = useRef(true);
  const anchor = useRef<ViewportAnchor | null>(null);
  const expectedScrollTop = useRef<number | null>(null);
  const historyAnchorPending = useRef(false);

  const anchorHistory = () => {
    const element = scrollRef.current;
    if (!element) return;
    pinned.current = false;
    anchor.current = captureViewportAnchor(element, true);
    historyAnchorPending.current = anchor.current === null;
    expectedScrollTop.current = null;
  };

  const preserveViewport = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    if (pinned.current) {
      element.scrollTop = element.scrollHeight;
    } else if (anchor.current) {
      anchor.current = restoreViewportAnchor(
        element,
        anchor.current,
        false,
        viewportLayoutRef.current,
      ).anchor;
    }
    expectedScrollTop.current = element.scrollTop;
  }, [scrollRef]);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    const content = element?.firstElementChild;
    if (!element || !content) return;
    pinned.current = true;
    anchor.current = null;
    historyAnchorPending.current = false;
    preserveViewport();

    const onScroll = () => {
      // Restoration keeps its row anchor; genuine user movement chooses a new one.
      const expected = expectedScrollTop.current;
      expectedScrollTop.current = null;
      if (expected !== null && Math.abs(element.scrollTop - expected) < 0.75) return;
      pinned.current = isConversationAtLatest(
        element.scrollHeight,
        element.scrollTop,
        element.clientHeight,
      );
      anchor.current = pinned.current ? null : captureViewportAnchor(element);
    };
    element.addEventListener('scroll', onScroll);
    const observer = new ResizeObserver(preserveViewport);
    observer.observe(content);
    observer.observe(element);
    return () => {
      observer.disconnect();
      element.removeEventListener('scroll', onScroll);
    };
  }, [childSessionId, preserveViewport, scrollRef]);

  // Revealing the earlier button can mount its rows only after the click.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!historyAnchorPending.current || !element) return;
    anchor.current = captureViewportAnchor(element, true);
    historyAnchorPending.current = anchor.current === null;
  });
  useLayoutEffect(preserveViewport, [items, preserveViewport]);
  return { viewportLayoutRef, anchorHistory };
}
