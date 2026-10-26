// The Canvas dialogs' shared frame: a quiet raised panel over a scrim that
// keeps Tab inside, closes on Escape or a click outside, hides the browser's
// native view beneath it, and hands focus back to whatever opened it.

import { useEffect, useRef, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { pushEscapeLayer } from '../../components/environment/usePopover';
import { useObscuresNativeSurfaces } from '../../hooks/useObscuresNativeSurfaces';
import { wrapTabFocus } from '../../lib/focusTrap';

// The controls inside these dialogs: borderless tinted fills on the raised
// panel, with a soft ring for the keyboard.
export const FIELD_CLASS =
  'w-full rounded-lg bg-droid-accent/[0.07] px-2.5 text-[12px] text-droid-text placeholder:text-droid-text-muted transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-droid-accent/15';
export const QUIET_BUTTON_CLASS =
  'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-droid-text-secondary transition-colors hover:bg-droid-accent/10 hover:text-droid-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-droid-accent/15';
export const PRIMARY_BUTTON_CLASS =
  'rounded-lg bg-droid-accent/15 px-3 py-1.5 text-[12px] font-semibold text-droid-text transition-colors hover:bg-droid-accent/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-droid-accent/15 disabled:cursor-default disabled:opacity-60';

export function CanvasDialog({
  labelledBy,
  onClose,
  initialFocus,
  ref,
  className,
  style,
  children,
}: {
  labelledBy: string;
  /** Null while work the user cannot walk away from is running. */
  onClose: (() => void) | null;
  /** The control that takes focus on open; the dialog itself otherwise. */
  initialFocus?: RefObject<HTMLElement | null>;
  ref?: RefObject<HTMLDivElement | null>;
  className: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const ownRef = useRef<HTMLDivElement>(null);
  const dialogRef = ref ?? ownRef;

  useObscuresNativeSurfaces();

  // A menu that opens this hands focus back to its trigger as it closes, in
  // the same commit, so the opener is read here rather than during render.
  useEffect(() => {
    const opener = document.activeElement;
    (initialFocus?.current ?? dialogRef.current)?.focus();
    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [dialogRef, initialFocus]);

  // While work runs, Escape still stops here rather than reaching the pane beneath.
  useEffect(
    () =>
      pushEscapeLayer(() => {
        onClose?.();
      }),
    [onClose],
  );

  return createPortal(
    <div
      className="fixed inset-0 z-[1250] flex items-center justify-center bg-black/40 p-5"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        onKeyDown={(event) => {
          wrapTabFocus(event, dialogRef.current);
        }}
        style={style}
        className={`rounded-2xl bg-droid-raised shadow-droid focus:outline-none ${className}`}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
