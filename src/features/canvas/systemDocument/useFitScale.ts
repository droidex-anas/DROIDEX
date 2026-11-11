import { useLayoutEffect, useState, type RefObject } from 'react';

/** The element's width over the item's, at most 1, or 0 before it is measured. */
export function useFitScale(ref: RefObject<HTMLElement | null>, width: number): number {
  const [scale, setScale] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = (shown: number) => {
      setScale(Math.min(1, shown / width));
    };
    measure(element.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => {
      measure(entry.contentRect.width);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [ref, width]);
  return scale;
}
