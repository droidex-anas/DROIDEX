import { useLayoutEffect, useState } from 'react';

interface ScreenSize {
  width: number;
  height: number;
}

const UNMEASURED: ScreenSize = { width: 0, height: 0 };

/**
 * A chip's size on screen, which its text sets, so it is read once the chip
 * is drawn and again only when that changes. Attach the setter as its ref.
 */
export function useScreenSize() {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [size, setSize] = useState(UNMEASURED);
  useLayoutEffect(() => {
    if (!element) return undefined;
    const measure = () => {
      const { offsetWidth: width, offsetHeight: height } = element;
      setSize((last) =>
        last.width === width && last.height === height ? last : { width, height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [element]);
  return [setElement, size] as const;
}
