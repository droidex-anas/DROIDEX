import { useEffect, useRef, type RefObject } from 'react';
import { pushEscapeLayer } from './escapeStack';

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
    const onDown = (e: MouseEvent) => {
      const layer = ref.current;
      const target = e.target as Node;
      if (!layer || layer.contains(target) || anchorRef?.current?.contains(target)) return;
      onClose();
    };
    const pop = pushEscapeLayer(onClose);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('mousedown', onDown);
      pop();
    };
  }, [open, onClose, anchorRef]);
  return ref;
}
