import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Side } from '@floating-ui/react';
import { cn } from './cn';
import { usePopoverPosition } from './usePopoverPosition';

// Hover intent (feel.md): the first tooltip waits, then moving between
// controls shows the next one at once until the pointer has rested away.
const SHOW_DELAY_MS = 500;
const HIDE_DELAY_MS = 100;
const WARM_WINDOW_MS = 300;

// At most one tooltip shows at a time; a new one replaces it instantly.
let hideShown: (() => void) | null = null;
let lastHiddenAt = 0;

function isWarm(): boolean {
  return hideShown !== null || Date.now() - lastHiddenAt < WARM_WINDOW_MS;
}

interface TooltipProps {
  label: string;
  children: ReactNode;
  placement?: Side;
  /** Layout of the wrapper around `children` (shrink, min-width, flex). */
  className?: string;
}

// Wraps one control and describes it on hover or keyboard focus.
export function Tooltip({
  label,
  children,
  placement = 'top',
  className = 'shrink-0',
}: TooltipProps) {
  const id = useId();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const { setFloating, floatingStyles, side, isPositioned } = usePopoverPosition({
    open,
    anchorRef,
    placement,
    offsetPx: 8,
  });

  const clearTimer = () => {
    window.clearTimeout(timerRef.current);
  };
  const close = () => {
    clearTimer();
    setOpen(false);
  };
  const show = () => {
    clearTimer();
    setOpen(true);
  };
  const scheduleShow = () => {
    clearTimer();
    if (isWarm()) show();
    else timerRef.current = window.setTimeout(show, SHOW_DELAY_MS);
  };
  const scheduleHide = () => {
    clearTimer();
    timerRef.current = window.setTimeout(close, HIDE_DELAY_MS);
  };

  // Register as the one shown tooltip, replacing whichever showed before.
  useEffect(() => {
    if (!open) return;
    hideShown?.();
    const hideThis = () => {
      window.clearTimeout(timerRef.current);
      setOpen(false);
    };
    hideShown = hideThis;
    return () => {
      if (hideShown === hideThis) hideShown = null;
      lastHiddenAt = Date.now();
    };
  }, [open]);

  useEffect(() => clearTimer, []);

  // The wrapped control takes focus, so it carries the description, not the wrapper.
  useLayoutEffect(() => {
    if (!open) return;
    const described = anchorRef.current?.firstElementChild;
    described?.setAttribute('aria-describedby', id);
    return () => {
      described?.removeAttribute('aria-describedby');
    };
  }, [open, id]);

  return (
    <>
      <span
        ref={anchorRef}
        className={cn('inline-flex', className)}
        onMouseEnter={scheduleShow}
        onMouseLeave={scheduleHide}
        onPointerDownCapture={close}
        onFocusCapture={(event) => {
          // A click focuses too; only keyboard focus shows it, and at once.
          if (event.target.matches(':focus-visible')) show();
        }}
        onBlurCapture={close}
      >
        {children}
      </span>
      {open &&
        createPortal(
          <div ref={setFloating} style={floatingStyles} className="pointer-events-none z-tooltip">
            <div
              id={id}
              role="tooltip"
              data-side={side}
              className={cn(
                'floating-layer max-w-60 rounded-sm bg-raised px-2 py-1 text-center text-label text-primary shadow-sm',
                isPositioned ? 'floating-layer-enter' : 'opacity-0',
              )}
            >
              {label}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
