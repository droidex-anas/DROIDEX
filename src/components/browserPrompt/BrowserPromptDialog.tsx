import { motion } from 'framer-motion';
import { ShieldAlert } from 'lucide-react';
import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { BrowserPermissionPrompt } from '../../lib/browserPrompt';
import { wrapTabFocus } from '../../lib/focusTrap';
import { pushEscapeLayer } from '../environment/usePopover';
import { BrowserPromptActions, BrowserPromptDeadline } from './BrowserPromptActions';

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
  const { requestId, cancelId } = prompt;

  useEffect(() => {
    const opener = document.activeElement;
    dialogRef.current?.querySelector<HTMLElement>('[data-default-action]')?.focus();
    // The Escape stack keeps the settings screen behind this dialog open.
    const popEscape = pushEscapeLayer(() => {
      onAnswer(requestId, cancelId);
    });
    return () => {
      popEscape();
      if (opener instanceof HTMLElement) opener.focus({ preventScroll: true });
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
        aria-describedby={messageId}
        tabIndex={-1}
        onKeyDown={(event) => {
          wrapTabFocus(event, dialogRef.current);
        }}
        initial={{ y: 10, scale: 0.985, opacity: 0 }}
        animate={{ y: 0, scale: 1, opacity: 1 }}
        exit={{ y: 6, scale: 0.99, opacity: 0 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        className="relative w-full max-w-[380px] overflow-hidden rounded-2xl bg-droid-raised p-5 shadow-droid focus:outline-none"
      >
        <div className="flex items-start gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-droid-orange/10 text-droid-orange">
            <ShieldAlert className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2 id={titleId} className="text-[14px] font-semibold text-droid-text">
              {prompt.title}
            </h2>
            <p id={messageId} className="mt-1 text-[12px] leading-5 text-droid-text-secondary">
              {prompt.message}
            </p>
            {prompt.detail && (
              <p className="mt-1.5 text-[11.5px] leading-[17px] text-droid-text-muted">
                {prompt.detail}
              </p>
            )}
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
