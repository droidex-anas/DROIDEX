import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../ui/cn';
import { usePopoverPosition } from '../ui/usePopoverPosition';

const SHOW_DELAY_MS = 200;

/**
 * The explanation behind the slider's help button. The button lives in the
 * element's shadow root inside a clipped card, so the explanation floats above
 * that card in a portal, the width of the card it explains.
 */
export default function EffortHelpCard({
  button,
  anchorRef,
}: {
  /** The help button whose hover or focus opens the card. */
  button: HTMLElement | null;
  /** The surface the card sits above and matches in width. */
  anchorRef: RefObject<HTMLElement | null>;
}) {
  // The anchor's width while open, measured when the card shows.
  const [width, setWidth] = useState<number | null>(null);
  const open = width !== null;
  const timer = useRef<number | undefined>(undefined);
  const { setFloating, floatingStyles, side, isPositioned } = usePopoverPosition({
    open,
    anchorRef,
    placement: 'top',
    offsetPx: 8,
  });

  useEffect(() => {
    if (!button) return;
    const show = (delay: number) => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        setWidth(anchorRef.current?.offsetWidth ?? null);
      }, delay);
    };
    const hide = () => {
      window.clearTimeout(timer.current);
      setWidth(null);
    };
    const onEnter = () => {
      show(SHOW_DELAY_MS);
    };
    const onFocus = () => {
      if (button.matches(':focus-visible')) show(0);
    };
    button.addEventListener('pointerenter', onEnter);
    button.addEventListener('pointerleave', hide);
    button.addEventListener('focus', onFocus);
    button.addEventListener('blur', hide);
    return () => {
      window.clearTimeout(timer.current);
      button.removeEventListener('pointerenter', onEnter);
      button.removeEventListener('pointerleave', hide);
      button.removeEventListener('focus', onFocus);
      button.removeEventListener('blur', hide);
    };
  }, [button, anchorRef]);

  if (!open) return null;
  return createPortal(
    <div ref={setFloating} style={floatingStyles} className="pointer-events-none z-tooltip">
      <div
        role="tooltip"
        data-side={side}
        style={{ width }}
        className={cn(
          'floating-layer rounded-lg bg-raised px-3.5 py-3 shadow-lg',
          isPositioned ? 'floating-layer-enter' : 'opacity-0',
        )}
      >
        <div className="text-body-strong text-primary">Effort</div>
        <p className="mt-1 text-label font-normal text-muted">
          Higher effort means more thorough responses, but takes longer and uses your limits faster.
        </p>
      </div>
    </div>,
    document.body,
  );
}
