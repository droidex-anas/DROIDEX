import { useLayoutEffect, useRef } from 'react';
import type { OverlayStore } from './overlayStore';
import type { Band } from './useBoardGestures';

/**
 * The rubber band, drawn in screen space above the board's world layer. It is
 * placed outside React, by transform, as the hand moves it.
 */
export function RubberBand({ band }: { band: OverlayStore<Band | null> }) {
  const node = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const draw = () => {
      const element = node.current;
      const drawn = band.read();
      if (!element) return;
      element.hidden = drawn === null;
      if (!drawn) return;
      const { origin, current } = drawn;
      // Whole pixels, as its edges were laid out, so each stays one pixel wide.
      const left = Math.round(Math.min(origin.x, current.x));
      const top = Math.round(Math.min(origin.y, current.y));
      const right = Math.round(Math.max(origin.x, current.x));
      const bottom = Math.round(Math.max(origin.y, current.y));
      element.style.transform = `translate(${String(left)}px, ${String(top)}px)`;
      element.style.width = `${String(right - left)}px`;
      element.style.height = `${String(bottom - top)}px`;
    };
    draw();
    return band.subscribe(draw);
  }, [band]);
  return <div ref={node} aria-hidden hidden className="canvas-band" />;
}
