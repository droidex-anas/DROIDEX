import {
  createContext,
  useContext,
  useEffect,
  useEffectEvent,
  useRef,
  type RefObject,
} from 'react';
import { pushEscapeLayer } from './escapeStack';

type LayerRef = RefObject<HTMLElement | null>;

// The open layer a nested layer opens from. A picker inside a popover form
// portals to the body, outside its parent's DOM, so a press in it only counts
// as inside the parent through this registry of open child layers.
export const DismissLayerContext = createContext<LayerRef | null>(null);
const openChildLayers = new WeakMap<LayerRef, Set<LayerRef>>();

function pressedInside(layer: LayerRef, target: Node): boolean {
  if (layer.current?.contains(target)) return true;
  for (const child of openChildLayers.get(layer) ?? []) {
    if (pressedInside(child, target)) return true;
  }
  return false;
}

// Closes a floating layer on Escape (through the shared stack) or on a press
// outside it and its open child layers, and returns the ref for the layer's
// container. A press on `anchorRef` is not outside: the trigger toggles the
// layer itself.
export function useDismiss<T extends HTMLElement = HTMLDivElement>(
  open: boolean,
  onClose: () => void,
  anchorRef?: RefObject<HTMLElement | null>,
) {
  const ref = useRef<T>(null);
  const parent = useContext(DismissLayerContext);
  // Registration follows `open` only: re-registering when `onClose` changes
  // identity would move a parent above the child it just opened on the
  // Escape stack.
  const close = useEffectEvent(onClose);
  useEffect(() => {
    if (!open) return;
    let siblings: Set<LayerRef> | undefined;
    if (parent) {
      siblings = openChildLayers.get(parent) ?? new Set();
      openChildLayers.set(parent, siblings);
      siblings.add(ref);
    }
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!ref.current || anchorRef?.current?.contains(target)) return;
      if (pressedInside(ref, target)) return;
      close();
    };
    const pop = pushEscapeLayer(() => {
      close();
    });
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('mousedown', onDown);
      siblings?.delete(ref);
      pop();
    };
  }, [open, anchorRef, parent]);
  return ref;
}
