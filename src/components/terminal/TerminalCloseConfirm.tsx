import { useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { wrapTabFocus } from '../../lib/focusTrap';
import { Button } from '../ui/Button';

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
      <div className="w-72 rounded-xl bg-raised p-4 shadow-lg">
        <p className="text-body text-primary">A process is still running in this terminal.</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" autoFocus onClick={onKeepOpen}>
            Keep
          </Button>
          <Button variant="danger" size="sm" onClick={onStopAndClose}>
            Stop and close
          </Button>
        </div>
      </div>
    </div>
  );
}
