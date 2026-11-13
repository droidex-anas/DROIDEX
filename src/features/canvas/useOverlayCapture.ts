// When the frames' input overlay flips between taking the pointer and letting
// it through to the designs (Interact).

import { useEffect, useState } from 'react';

/**
 * Spec §4: the overlay's hit-test flip waits for an arriving wheel gesture to
 * go quiet and then for the frame that paints it, so it is committed before
 * any later input is read against it.
 */
export function useOverlayCapture(capturePointer: boolean, scrolling: boolean): boolean {
  const [overlayCapture, setOverlayCapture] = useState(capturePointer);
  useEffect(() => {
    if (overlayCapture === capturePointer || scrolling) return undefined;
    const frame = requestAnimationFrame(() => {
      setOverlayCapture(capturePointer);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [capturePointer, overlayCapture, scrolling]);
  return overlayCapture;
}
