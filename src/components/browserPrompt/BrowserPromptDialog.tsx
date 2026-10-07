import { motion } from 'framer-motion';
import { ShieldAlert } from 'lucide-react';
import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { BrowserPermissionPrompt } from '../../lib/browserPrompt';
import { wrapTabFocus } from '../../lib/focusTrap';
import { pushEscapeLayer } from '../environment/usePopover';
import { BrowserPromptActions, BrowserPromptDeadline } from './BrowserPromptActions';

// App shortcuts are window keydown listeners; a modal keeps them from acting
// on the app behind it. Only the keys the dialog itself uses get through:
// Tab moves between its buttons, Enter and Space press them, Escape cancels.
const DIALOG_KEYS = new Set(['Tab', 'Enter', ' ', 'Escape']);

function stopAppShortcut(event: KeyboardEvent) {
  const dialogKey = DIALOG_KEYS.has(event.key) && !event.metaKey && !event.ctrlKey && !event.altKey;
  if (!dialogKey) event.stopImmediatePropagation();
}

// Main's detail for a protection change lists one "Setting: from → to" per
// line, then a blank line and the advice.
function ChangeDetail({ detail }: { detail: string }) {
  return detail.split('\n\n').map((block) => {
    const lines = block.split('\n');
    if (!lines.every((line) => line.includes(' → '))) {
      return (
        <p key={block} className="mt-1.5 text-[11.5px] leading-[17px] text-droid-text-muted">
          {block}
        </p>
      );
    }
    return (
      <ul key={block} className="mt-3 space-y-1 rounded-xl bg-droid-elevated px-3 py-2">
        {lines.map((line) => {
          const [setting, change] = line.split(': ');
          return (
            <li key={line} className="flex justify-between gap-3 text-[12px] leading-5">
              <span className="text-droid-text">{setting}</span>
              <span className="shrink-0 text-droid-text-secondary">{change}</span>
            </li>
          );
        })}
      </ul>
    );
  });
}

/** A protection change the user just asked for, confirmed where they are. */
export function BrowserPromptDialog({
  prompt,
  onAnswer,
}: {
  prompt: BrowserPermissionPrompt;
  onAnswer: (requestId: string, response: number) => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const messageId = useId();
  const detailId = useId();
  const { requestId, cancelId } = prompt;

  useEffect(() => {
    const opener = document.activeElement;
    const dialog = dialogRef.current;
    const app = document.getElementById('app-root');
    app?.setAttribute('inert', '');
    window.addEventListener('keydown', stopAppShortcut, true);
    dialog?.querySelector<HTMLElement>('[data-default-action]')?.focus();
    // The Escape stack keeps the settings screen behind this dialog open.
    const popEscape = pushEscapeLayer(() => {
      onAnswer(requestId, cancelId);
    });
    return () => {
      popEscape();
      window.removeEventListener('keydown', stopAppShortcut, true);
      app?.removeAttribute('inert');
      // Only while focus is still here, or fell to the page as the dialog left;
      // anything else has taken focus since and keeps it.
      const focused = document.activeElement;
      const focusIsOurs = !focused || focused === document.body || dialog?.contains(focused);
      if (focusIsOurs && opener instanceof HTMLElement) opener.focus({ preventScroll: true });
    };
  }, [onAnswer, requestId, cancelId]);

  return createPortal(
    <motion.div
      className="fixed inset-0 z-[1250] flex items-center justify-center bg-black/40 p-5"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onAnswer(requestId, cancelId);
      }}
    >
      <motion.div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={`${messageId} ${detailId}`}
        tabIndex={-1}
        onKeyDown={(event) => {
          wrapTabFocus(event, dialogRef.current);
        }}
        initial={{ y: 10, scale: 0.985, opacity: 0 }}
        animate={{ y: 0, scale: 1, opacity: 1 }}
        exit={{ y: 6, scale: 0.99, opacity: 0 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        className="relative w-full max-w-[400px] overflow-hidden rounded-2xl bg-droid-raised p-5 shadow-droid focus:outline-none"
      >
        <div className="flex items-start gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-droid-orange/10 text-droid-orange">
            <ShieldAlert className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-[14px] font-semibold text-droid-text">
              {prompt.title}
            </h2>
            <p id={messageId} className="mt-1 text-[12px] leading-5 text-droid-text-secondary">
              {prompt.message}
            </p>
            <div id={detailId}>
              <ChangeDetail detail={prompt.detail} />
            </div>
          </div>
        </div>
        <div className="mt-5">
          <BrowserPromptActions prompt={prompt} onAnswer={onAnswer} />
        </div>
        <BrowserPromptDeadline expiresAt={prompt.expiresAt} />
      </motion.div>
    </motion.div>,
    document.body,
  );
}
