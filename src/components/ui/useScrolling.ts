import { useEffect, type RefObject } from 'react';

// How long the thumb stays after the last scroll event before it fades out.
const SCROLLBAR_LINGER_MS = 800;

// Marks `element` with `data-scrolling` while it moves, which reveals its
// scrollbar thumb (index.css). The attribute is written straight to the
// element: a scroll must never re-render what it is scrolling.
export function trackScrolling(element: HTMLElement): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onScroll = () => {
    element.setAttribute('data-scrolling', '');
    clearTimeout(timer);
    timer = setTimeout(() => {
      element.removeAttribute('data-scrolling');
    }, SCROLLBAR_LINGER_MS);
  };
  element.addEventListener('scroll', onScroll, { passive: true });
  return () => {
    element.removeEventListener('scroll', onScroll);
    clearTimeout(timer);
    element.removeAttribute('data-scrolling');
  };
}

export function useScrolling(ref: RefObject<HTMLElement | null>, enabled = true): void {
  useEffect(() => {
    const element = ref.current;
    if (!element || !enabled) return;
    return trackScrolling(element);
  }, [ref, enabled]);
}
