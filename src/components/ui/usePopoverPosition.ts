import { useLayoutEffect, type RefObject } from 'react';
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
export function popoverMiddleware(offsetPx: number): Middleware[] {
  return [
    offset(offsetPx),
    flip({ padding: WINDOW_EDGE_PX }),
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

// The one positioning hook for menus, popovers and tooltips. The layer is
// rendered fixed in a body-level portal; `side` is where it actually landed
// after flipping, for `data-side` and the entrance animation.
export function usePopoverPosition({
  open,
  anchorRef,
  placement,
  offsetPx,
}: {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  placement: Placement;
  offsetPx: number;
}) {
  const {
    refs,
    floatingStyles,
    placement: landed,
    isPositioned,
    middlewareData,
  } = useFloating({
    open,
    placement,
    strategy: 'fixed',
    middleware: popoverMiddleware(offsetPx),
    whileElementsMounted: autoUpdate,
  });

  useLayoutEffect(() => {
    refs.setReference(open ? anchorRef.current : null);
  }, [open, anchorRef, refs]);

  return {
    setFloating: refs.setFloating,
    floatingStyles,
    side: landed.split('-')[0] as Side,
    isPositioned,
    anchorHidden: middlewareData.hide?.referenceHidden === true,
  };
}
