import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import type { BrowserPermissionPrompt } from '../../lib/browserPrompt';

const BUTTON =
  'rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-1';

function buttonStyle(prompt: BrowserPermissionPrompt, response: number, primary: number): string {
  if (response === prompt.cancelId) {
    return 'text-droid-text-secondary hover:bg-droid-elevated hover:text-droid-text focus-visible:ring-droid-accent/60';
  }
  if (response !== primary) {
    return 'bg-droid-elevated text-droid-text hover:bg-droid-active focus-visible:ring-droid-accent/60';
  }
  if (prompt.kind === 'warning') {
    return 'bg-droid-red/15 font-semibold text-droid-red hover:bg-droid-red/25 focus-visible:ring-droid-red/60';
  }
  return 'bg-droid-accent text-droid-bg hover:opacity-90 focus-visible:ring-droid-accent/60 focus-visible:ring-offset-1 focus-visible:ring-offset-droid-raised';
}

function secondsLeft(expiresAt: number): number {
  return Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
}

function formatSeconds(seconds: number): string {
  return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * The prompt's buttons, first on the right as in a native dialog, with the
 * time left before main answers with the cancel action. The first non-cancel
 * button is the primary one.
 */
export function BrowserPromptActions({
  prompt,
  onAnswer,
}: {
  prompt: BrowserPermissionPrompt;
  onAnswer: (requestId: string, response: number) => void;
}) {
  const [remaining, setRemaining] = useState(() => secondsLeft(prompt.expiresAt));
  useEffect(() => {
    const timer = setInterval(() => {
      setRemaining(secondsLeft(prompt.expiresAt));
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [prompt.expiresAt]);

  const primary = prompt.buttons.findIndex((_, response) => response !== prompt.cancelId);
  return (
    <div className="flex items-center gap-3">
      <span className="min-w-0 flex-1 text-[11px] tabular-nums text-droid-text-muted">
        Expires in {formatSeconds(remaining)}
      </span>
      <div className="flex flex-row-reverse flex-wrap items-center gap-1.5">
        {prompt.buttons.map((label, response) => (
          <button
            key={`${String(response)}-${label}`}
            type="button"
            data-default-action={response === prompt.defaultId ? true : undefined}
            onClick={() => {
              onAnswer(prompt.requestId, response);
            }}
            className={`${BUTTON} ${buttonStyle(prompt, response, primary)}`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A hairline along the bottom edge that drains until main declines the prompt. */
export function BrowserPromptDeadline({ expiresAt }: { expiresAt: number }) {
  const [remainingMs] = useState(() => Math.max(0, expiresAt - Date.now()));
  return (
    <motion.span
      aria-hidden="true"
      className="absolute inset-x-0 bottom-0 h-[2px] origin-left bg-droid-text-muted/35"
      initial={{ scaleX: 1 }}
      animate={{ scaleX: 0 }}
      transition={{ duration: remainingMs / 1000, ease: 'linear' }}
    />
  );
}
