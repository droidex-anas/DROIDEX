import { useEffect, useRef, type RefObject } from 'react';
import { pushEscapeLayer } from './escapeStack';

// Open layers, each stamped with the order it first opened. A layer opened
// from inside another (a picker in a popover form) portals to the body, so
// it is outside its parent's DOM; a press in any layer that opened no
// earlier still counts as inside the parent. The stamp is assigned once, so
// an effect re-run never re-dates a parent after the child it opened.
const openLayers: RefObject<HTMLElement | null>[] = [];
const layerOrder = new WeakMap<object, number>();
let nextOrder = 0;

function orderOf(layer: RefObject<HTMLElement | null>): number {
  let order = layerOrder.get(layer);
  if (order === undefined) {
    order = nextOrder++;
    layerOrder.set(layer, order);
  }
  return order;
}

function pressedInLayerFrom(layer: RefObject<HTMLElement | null>, target: Node): boolean {
  const from = orderOf(layer);
  return openLayers.some((open) => orderOf(open) >= from && open.current?.contains(target));
}

// Closes a floating layer on Escape (through the shared stack) or on a press
// outside it, and returns the ref for the layer's container. A press on
// `anchorRef` is not outside: the trigger toggles the layer itself.
export function useDismiss<T extends HTMLElement = HTMLDivElement>(
  open: boolean,
  onClose: () => void,
  anchorRef?: RefObject<HTMLElement | null>,
) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!open) return;
    orderOf(ref);
    openLayers.push(ref);
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!ref.current || anchorRef?.current?.contains(target)) return;
      if (pressedInLayerFrom(ref, target)) return;
      onClose();
    };
    const pop = pushEscapeLayer(onClose);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('mousedown', onDown);
      openLayers.splice(openLayers.indexOf(ref), 1);
      pop();
    };
  }, [open, onClose, anchorRef]);
  return ref;
}
