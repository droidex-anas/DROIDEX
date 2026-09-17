import { useEffect, type RefObject } from 'react';

// How long the thumb stays after the last scroll event before it fades out.
const SCROLLBAR_LINGER_MS = 800;

/* Marks a scroller with `data-scrolling` while it moves, for the
   `scrollbar-while-scrolling` style. The attribute is written straight to the
   element: a scroll must never re-render the conversation it is scrolling. */
export function useScrollingAttribute(ref: RefObject<HTMLElement | null>, enabled: boolean): void {
  useEffect(() => {
    const element = ref.current;
    if (!element || !enabled) return;
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
  }, [ref, enabled]);
}
