import { Spinner } from '@droidex/icons';
import { motion } from 'framer-motion';
import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { wrapTabFocus } from '../../lib/focusTrap';
import { pushEscapeLayer } from '../environment/usePopover';

/** Asks before a browser settings action that cannot be undone. */
export function BrowserConfirmDialog({
  title,
  description,
  actionLabel,
  busy,
  onCancel,
  onConfirm,
}: {
  title: string;
  description: string;
  actionLabel: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef(onCancel);
  const busyRef = useRef(busy);
  const titleId = useId();
  const descriptionId = useId();
  cancelRef.current = onCancel;
  busyRef.current = busy;

  useEffect(() => {
    const opener = document.activeElement;
    dialogRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    // The Escape stack keeps the settings screen behind this dialog open.
    const popEscape = pushEscapeLayer(() => {
      if (!busyRef.current) cancelRef.current();
    });
    return () => {
      popEscape();
      if (opener instanceof HTMLElement) opener.focus({ preventScroll: true });
    };
  }, []);

  return createPortal(
    <motion.div
      className="fixed inset-0 z-[1250] flex items-center justify-center bg-black/40 p-5"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <motion.div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={busy}
        tabIndex={-1}
        onKeyDown={(event) => {
          wrapTabFocus(event, dialogRef.current);
        }}
        initial={{ y: 10, scale: 0.985, opacity: 0 }}
        animate={{ y: 0, scale: 1, opacity: 1 }}
        exit={{ y: 6, scale: 0.99, opacity: 0 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-[380px] rounded-2xl bg-droid-raised p-5 shadow-droid focus:outline-none"
      >
        <h2 id={titleId} className="text-[14px] font-semibold text-droid-text">
          {title}
        </h2>
        <p id={descriptionId} className="mt-1 text-[12px] leading-5 text-droid-text-secondary">
          {description}
        </p>
        <p className="mt-1.5 text-[11.5px] leading-[17px] text-droid-text-muted">
          This changes the shared DROIDEX browser profile and applies to every chat.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            data-autofocus
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-lg px-3 py-1.5 text-[12px] font-medium text-droid-text-secondary transition-colors hover:bg-droid-elevated hover:text-droid-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-droid-accent/60 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="flex items-center gap-2 rounded-lg bg-droid-red/15 px-3 py-1.5 text-[12px] font-semibold text-droid-red transition-colors hover:bg-droid-red/25 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-droid-red/60 disabled:opacity-50"
          >
            {busy && <Spinner className="h-3.5 w-3.5 motion-safe:animate-spin-slow" />}
            {actionLabel}
          </button>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}
