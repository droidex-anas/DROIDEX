import { motion } from 'framer-motion';
import { useState } from 'react';
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

/**
 * The prompt's buttons, first on the right as in a native dialog. The first
 * non-cancel button is the primary one; the default button takes focus, so
 * Enter answers with it.
 */
export function BrowserPromptActions({
  prompt,
  onAnswer,
}: {
  prompt: BrowserPermissionPrompt;
  onAnswer: (requestId: string, response: number) => void;
}) {
  const primary = prompt.buttons.findIndex((_, response) => response !== prompt.cancelId);
  return (
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
