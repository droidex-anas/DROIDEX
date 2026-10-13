import { useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { wrapTabFocus } from '../../lib/focusTrap';

/* ── Closing a shell that still has something running asks here, over the
   terminal the user is looking at, rather than in a popover hanging off the
   tab strip. Escape keeps the terminal, matching the quiet button. ── */
export function TerminalCloseConfirm({
  onKeepOpen,
  onStopAndClose,
}: {
  onKeepOpen: () => void;
  onStopAndClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // This dialog overlays a live terminal, so without the Tab wrap focus walks
  // straight back into the shell behind the scrim.
  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onKeepOpen();
      return;
    }
    wrapTabFocus(event, dialogRef.current);
  };

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Confirm closing terminal"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="absolute inset-0 z-10 flex animate-fade-in items-center justify-center bg-bg/70 p-4"
    >
      <div className="w-[280px] rounded-xl border border-divider bg-surface p-4 shadow-lg">
        <p className="text-[12px] leading-relaxed text-primary">
          A process is still running in this terminal.
        </p>
        <div className="mt-3 flex justify-end gap-1.5 text-[12px]">
          <button
            type="button"
            autoFocus
            onClick={onKeepOpen}
            className="rounded-sm px-2 py-1 leading-none text-muted transition-colors hover:bg-active hover:text-primary focus:bg-active focus:text-primary focus:outline-none"
          >
            Keep
          </button>
          <button
            type="button"
            onClick={onStopAndClose}
            className="rounded-sm bg-elevated px-2 py-1 leading-none text-primary transition-colors hover:bg-active focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
          >
            Stop and close
          </button>
        </div>
      </div>
    </div>
  );
}
