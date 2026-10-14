import { useLayoutEffect, useRef, type RefObject } from 'react';
import { pushEscapeLayer } from './escapeStack';

// Closes a floating layer on Escape (through the shared stack) or on a press
// outside it, and returns the ref for the layer's container. A press on
// `anchorRef` is not outside: the trigger toggles the layer itself. Nor is the
// press in `insidePressRef`, the last one React routed through the layer,
// which covers layers nested in it but portaled elsewhere in the DOM.
export function useDismiss<T extends HTMLElement = HTMLDivElement>(
  open: boolean,
  onClose: () => void,
  anchorRef?: RefObject<HTMLElement | null>,
  insidePressRef?: RefObject<Event | null>,
) {
  const ref = useRef<T>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // One Escape layer per opening, pushed in the layout phase: that runs before
  // the content's own effects, so a layer the content pushes as it opens (a
  // sub-view to back out of) stays above this one, and a new `onClose` on a
  // re-render does not move this layer back on top.
  useLayoutEffect(() => {
    if (!open) return;
    const close = () => {
      onCloseRef.current();
    };
    const onDown = (e: MouseEvent) => {
      const layer = ref.current;
      const target = e.target as Node;
      if (!layer || layer.contains(target) || anchorRef?.current?.contains(target)) return;
      if (insidePressRef?.current === e) return;
      close();
    };
    const pop = pushEscapeLayer(close);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('mousedown', onDown);
      pop();
    };
  }, [open, anchorRef, insidePressRef]);
  return ref;
}
