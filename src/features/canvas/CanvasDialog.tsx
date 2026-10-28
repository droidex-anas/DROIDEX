// The Canvas dialogs' shared frame: a quiet raised panel over a scrim that
// keeps Tab inside, closes on Escape or a click outside, and hands focus back
// to whatever opened it.

import { useEffect, useRef, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { pushEscapeLayer } from '../../components/ui/escapeStack';
import { wrapTabFocus } from '../../lib/focusTrap';

// The controls inside these dialogs: borderless tinted fills on the raised
// panel, with a soft ring for the keyboard.
export const FIELD_CLASS =
  'w-full rounded-lg bg-accent/[0.07] px-2.5 text-label font-normal text-primary placeholder:text-muted transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring';
export const QUIET_BUTTON_CLASS =
  'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-label text-secondary transition-colors hover:bg-accent/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring';
export const PRIMARY_BUTTON_CLASS =
  'rounded-lg bg-accent/15 px-3 py-1.5 text-label font-semibold text-primary transition-colors hover:bg-accent/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:cursor-default disabled:opacity-60';

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
      className="fixed inset-0 z-dialog flex items-center justify-center bg-bg/60 p-5"
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
        className={`rounded-2xl bg-raised shadow-lg focus:outline-none ${className}`}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
