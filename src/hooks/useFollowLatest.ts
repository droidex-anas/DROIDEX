import { useCallback, useLayoutEffect, useRef } from 'react';
import { nextPinnedState } from './conversationScrollWindow';

export function useFollowLatest() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const lastScrollTop = useRef(0);

  const followLatest = useCallback(() => {
    const scroll = scrollRef.current;
    if (!scroll || !pinned.current) return;
    scroll.scrollTop = scroll.scrollHeight;
    // The scroll event can arrive after the list grows again; only actual upward movement should unpin.
    lastScrollTop.current = scroll.scrollTop;
  }, []);

  const pinToLatest = useCallback(() => {
    pinned.current = true;
    followLatest();
  }, [followLatest]);

  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    const content = scroll?.firstElementChild;
    if (!scroll || !content) return;

    const onScroll = () => {
      const { scrollTop, clientHeight, scrollHeight } = scroll;
      pinned.current = nextPinnedState({
        wasPinned: pinned.current,
        previousScrollTop: lastScrollTop.current,
        scrollTop,
        distanceFromEnd: scrollHeight - scrollTop - clientHeight,
      });
      lastScrollTop.current = scrollTop;
    };
    scroll.addEventListener('scroll', onScroll, { passive: true });
    const observer = new ResizeObserver(followLatest);
    observer.observe(content);
    observer.observe(scroll);
    return () => {
      scroll.removeEventListener('scroll', onScroll);
      observer.disconnect();
    };
  }, [followLatest]);

  return { scrollRef, followLatest, pinToLatest };
}
