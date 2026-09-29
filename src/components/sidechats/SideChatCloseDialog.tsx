import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';

/* Closing a side chat deletes it, so it asks first. Minimizing is the way to
   put one away and come back to it. */

export function SideChatCloseDialog({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const opener = document.activeElement;
    cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [onCancel]);

  // Two buttons: Tab moves between them and never leaves the dialog.
  const keepFocusInside = (event: ReactKeyboardEvent) => {
    if (event.key !== 'Tab') return;
    event.preventDefault();
    const next = document.activeElement === cancelRef.current ? confirmRef : cancelRef;
    next.current?.focus();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[1250] flex items-center justify-center bg-black/40 p-5"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="side-chat-close-title"
        aria-describedby="side-chat-close-description"
        onKeyDown={keepFocusInside}
        className="w-full max-w-[360px] rounded-2xl bg-droid-raised p-5 shadow-droid"
      >
        <h2 id="side-chat-close-title" className="text-[14px] font-semibold text-droid-text">
          Close this side chat?
        </h2>
        <p
          id="side-chat-close-description"
          className="mt-1.5 text-[12px] leading-5 text-droid-text-secondary"
        >
          It is deleted and can&apos;t be reopened. Answers you sent to the chat stay there. To put
          it away for later, minimize it instead.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="rounded-lg px-3 py-1.5 text-[12px] font-medium text-droid-text-secondary transition-colors hover:bg-droid-elevated hover:text-droid-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-droid-accent/60"
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className="rounded-lg bg-red-500/15 px-3 py-1.5 text-[12px] font-semibold text-red-400 transition-colors hover:bg-red-500/25 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-red-400/60"
          >
            Close side chat
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
