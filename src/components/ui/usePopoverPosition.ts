import { useLayoutEffect, useState, type RefObject } from 'react';
import {
  autoUpdate,
  flip,
  hide,
  offset,
  shift,
  size,
  useFloating,
  type Middleware,
  type Placement,
  type Side,
} from '@floating-ui/react';

// Floating layers stay at least this far inside the window.
const WINDOW_EDGE_PX = 8;

// Preferred side, flip when it does not fit, slide along the anchor to stay
// inside the window, and publish the room left so the layer scrolls inside
// instead of being clipped (read by the `floating-layer` class).
export function popoverMiddleware(offsetPx: number, flips = true): Middleware[] {
  return [
    offset(offsetPx),
    ...(flips ? [flip({ padding: WINDOW_EDGE_PX })] : []),
    shift({ padding: WINDOW_EDGE_PX }),
    size({
      padding: WINDOW_EDGE_PX,
      apply({ availableHeight, elements }) {
        elements.floating.style.setProperty(
          '--available-height',
          `${String(Math.max(0, availableHeight))}px`,
        );
      },
    }),
    hide(),
  ];
}

// A viewport point (a right-click) to place the layer at instead of the
// anchor's box.
export interface AnchorPoint {
  x: number;
  y: number;
}

// The one positioning hook for menus, popovers and tooltips. The layer is
// rendered fixed in a body-level portal; `side` is where it actually landed
// after flipping, for `data-side` and the entrance animation. That side holds
// until the layer closes, so content that grows or shrinks while it is open
// (a filtered list, another harness's catalog) never flips it over the anchor.
export function usePopoverPosition({
  open,
  anchorRef,
  anchorPoint,
  placement,
  offsetPx,
}: {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  anchorPoint?: AnchorPoint;
  placement: Placement;
  offsetPx: number;
}) {
  const [held, setHeld] = useState<Placement | null>(null);
  const {
    refs,
    floatingStyles,
    placement: landed,
    isPositioned,
    middlewareData,
  } = useFloating({
    open,
    placement: held ?? placement,
    strategy: 'fixed',
    middleware: popoverMiddleware(offsetPx, held === null),
    whileElementsMounted: autoUpdate,
  });
  if (!open && held !== null) setHeld(null);
  if (open && isPositioned && held === null) setHeld(landed);

  useLayoutEffect(() => {
    const anchor = open ? anchorRef.current : null;
    if (!anchor || !anchorPoint) {
      refs.setReference(anchor);
      return;
    }
    // The point is kept as an offset from the anchor's box, in viewport pixels
    // like the click, so the layer follows the anchor when its list scrolls
    // and `hide` sees it leave, all unaffected by the UI zoom on #root.
    const opened = anchor.getBoundingClientRect();
    const offsetX = anchorPoint.x - opened.left;
    const offsetY = anchorPoint.y - opened.top;
    refs.setReference({
      getBoundingClientRect: () => {
        const box = anchor.getBoundingClientRect();
        return new DOMRect(box.left + offsetX, box.top + offsetY, 0, 0);
      },
      contextElement: anchor,
    });
  }, [open, anchorRef, anchorPoint, refs]);

  return {
    setFloating: refs.setFloating,
    floatingStyles,
    side: landed.split('-')[0] as Side,
    isPositioned,
    anchorHidden: middlewareData.hide?.referenceHidden === true,
  };
}
