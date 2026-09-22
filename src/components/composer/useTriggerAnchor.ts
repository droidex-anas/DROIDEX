import { useLayoutEffect, useState, type RefObject } from 'react';

const WINDOW_MARGIN_PX = 12;
// The panel's `mb-3` gap above the chip.
const GAP_PX = 12;
const TAIL_HALF_PX = 6;

interface Placement {
  width: number;
  maxHeight: number;
  tailRight: number;
}

/**
 * Placement for a popover that opens above the model chip. The chip sits in a
 * right-justified cluster, so its left edge moves whenever its label changes
 * width (another model, another effort) while its right edge stays put. The
 * panel hangs from that right edge and grows left; it takes its preferred
 * width when the window allows and otherwise shrinks to the room left of the
 * chip, and caps its height to the room above it. Room is measured inside
 * the chat pane, which clips its overflow (the sidebar sits beside it), and
 * falls back to the window. The tail follows the chip's centre.
 */
export function useTriggerAnchor(
  panelRef: RefObject<HTMLElement | null>,
  preferredWidth: number,
): Placement {
  const [placement, setPlacement] = useState<Placement>({
    width: preferredWidth,
    maxHeight: Number.POSITIVE_INFINITY,
    tailRight: 22,
  });

  useLayoutEffect(() => {
    const anchor = panelRef.current?.offsetParent;
    if (!(anchor instanceof HTMLElement)) return;
    const pane = anchor.closest('main');
    const measure = () => {
      const rect = anchor.getBoundingClientRect();
      const bounds = pane?.getBoundingClientRect() ?? { left: 0, top: 0 };
      const next = {
        width: Math.max(0, Math.min(preferredWidth, rect.right - bounds.left - WINDOW_MARGIN_PX)),
        maxHeight: Math.max(0, rect.top - bounds.top - GAP_PX - WINDOW_MARGIN_PX),
        tailRight: Math.max(12, rect.width / 2 - TAIL_HALF_PX),
      };
      setPlacement((prev) =>
        prev.width === next.width &&
        prev.maxHeight === next.maxHeight &&
        prev.tailRight === next.tailRight
          ? prev
          : next,
      );
    };
    measure();
    // The chip moves with the composer and the pane (it wraps, the sidebar
    // toggles), not only with the window.
    const observer = new ResizeObserver(measure);
    observer.observe(anchor);
    observer.observe(pane ?? document.documentElement);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [panelRef, preferredWidth]);

  return placement;
}
