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
    let measured: ScreenSize | null = null;
    const measure = () => {
      const { offsetWidth: width, offsetHeight: height } = element;
      // The observer's first call repeats the measure made on mount, and even a
      // state update that changes nothing can cost the board a commit.
      if (measured?.width === width && measured.height === height) return;
      measured = { width, height };
      setSize(measured);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element, { box: 'border-box' });
    return () => {
      observer.disconnect();
    };
  }, [element]);
  return [setElement, size] as const;
}
