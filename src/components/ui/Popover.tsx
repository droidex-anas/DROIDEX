import {
  useEffect,
  useRef,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { useMergeRefs, type Placement } from '@floating-ui/react';
import { FOCUSABLE_SELECTOR, wrapTabFocus } from '../../lib/focusTrap';
import { cn } from './cn';
import { useDismiss } from './useDismiss';
import { usePopoverPosition } from './usePopoverPosition';

export interface PopoverProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  ref?: Ref<HTMLDivElement>;
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  /** Accessible name of the layer. */
  label: string;
  placement?: Placement;
  /** Content width in CSS pixels; omit to size to the content. */
  width?: number;
  children: ReactNode;
}

// The floating layer for menus, pickers and option lists: positioned against
// its anchor, portaled to <body> so no ancestor clips it, closed by Escape, a
// press outside or the anchor scrolling away, with focus kept inside while
// open and handed back to the anchor on close. The caller's trigger opens it.
export function Popover({
  ref,
  open,
  onClose,
  anchorRef,
  label,
  placement = 'bottom-start',
  width,
  className,
  style,
  onKeyDown,
  onMouseDown,
  children,
  ...rest
}: PopoverProps) {
  // React routes a press inside a nested layer (a menu opened from this panel,
  // portaled beside it) through this panel too, so it does not dismiss it.
  const insidePressRef = useRef<Event | null>(null);
  const panelRef = useDismiss(open, onClose, anchorRef, insidePressRef);
  const mergedRef = useMergeRefs([panelRef, ref]);
  const { setFloating, floatingStyles, side, isPositioned, anchorHidden } = usePopoverPosition({
    open,
    anchorRef,
    placement,
    offsetPx: 4,
  });

  // floating-ui keeps the last opening's middleware data while closed, so
  // only trust `anchorHidden` once this opening has been positioned.
  useEffect(() => {
    if (open && isPositioned && anchorHidden) onClose();
  }, [open, isPositioned, anchorHidden, onClose]);

  // If focus is inside the panel when it closes (Escape from a search input,
  // an activated row unmounting), it would fall to <body>; hand it back to the
  // anchor instead. React clears panelRef and unmounts the portal before this
  // cleanup runs, so containment is tracked live via focusin. A close by an
  // outside press moves focus to the pressed target first, clears the flag,
  // and does not steal focus back.
  const focusInsideRef = useRef(false);
  useEffect(() => {
    const panel = panelRef.current;
    if (!open || !panel) return;
    const track = () => {
      focusInsideRef.current = panel.contains(document.activeElement);
    };
    track();
    // Nothing inside took focus (an autoFocus input, a menu): move it in so
    // the first Tab is trapped rather than walking out of the portal. Items
    // out of the tab order are skipped; Menu focuses its own.
    if (!focusInsideRef.current) {
      const first = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).find(
        (element) => element.tabIndex >= 0,
      );
      (first ?? panel).focus({ preventScroll: true });
      track();
    }
    document.addEventListener('focusin', track);
    const anchor = anchorRef.current;
    return () => {
      document.removeEventListener('focusin', track);
      if (focusInsideRef.current) anchor?.focus();
      focusInsideRef.current = false;
    };
  }, [open, anchorRef, panelRef]);

  // The portal escapes the trigger's DOM order, so Tab would otherwise walk
  // out of the open panel into whatever follows <body>; wrap focus instead.
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (!event.defaultPrevented) wrapTabFocus(event, panelRef.current);
  };

  // A static render (renderToStaticMarkup) has no <body> to portal into.
  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div ref={setFloating} style={floatingStyles} className="z-popover">
      <div
        ref={mergedRef}
        role="dialog"
        aria-label={label}
        tabIndex={-1}
        data-side={side}
        {...rest}
        onKeyDown={handleKeyDown}
        onMouseDown={(event) => {
          onMouseDown?.(event);
          insidePressRef.current = event.nativeEvent;
        }}
        style={{ ...style, width }}
        className={cn(
          'floating-layer flex flex-col overflow-hidden rounded-lg bg-raised shadow-lg outline-none',
          isPositioned ? 'floating-layer-enter' : 'opacity-0',
          className,
        )}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
