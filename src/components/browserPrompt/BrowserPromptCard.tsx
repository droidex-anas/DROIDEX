import { motion } from 'framer-motion';
import { Code2, Globe, KeyRound, type LucideIcon } from 'lucide-react';
import { useId, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { BrowserPermissionPrompt } from '../../lib/browserPrompt';
import { BrowserPromptActions, BrowserPromptDeadline } from './BrowserPromptActions';

const KIND_ICON: Record<BrowserPermissionPrompt['kind'], LucideIcon> = {
  credential: KeyRound,
  permission: Code2,
  question: Globe,
  warning: Globe,
};

// An https site reads as its host; anything else keeps its scheme so it stands out.
function siteLabel(origin: string): string {
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' ? url.host : origin;
  } catch {
    return origin;
  }
}

// Over the top-right corner of the page the browser pane shows, anchored to the
// same slot as the page itself.
function paneStyle(anchor: string): CSSProperties {
  return {
    positionAnchor: anchor,
    positionVisibility: 'always',
    top: 'calc(anchor(top) + 12px)',
    right: 'calc(anchor(right) + 12px)',
    maxWidth: 'calc(anchor-size(width) - 24px)',
  };
}

/**
 * An agent's browser request: a compact card over the browser pane, or in the
 * window's top-right corner when no pane is showing. It never takes focus: it
 * answers a click, or Enter and Escape once the user has moved focus into it.
 */
export function BrowserPromptCard({
  prompt,
  paneAnchor,
  onAnswer,
}: {
  prompt: BrowserPermissionPrompt;
  paneAnchor: string | null;
  onAnswer: (requestId: string, response: number) => void;
}) {
  const titleId = useId();
  const messageId = useId();
  const detailId = useId();
  const Icon = KIND_ICON[prompt.kind];

  return createPortal(
    <motion.div
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={`${messageId} ${detailId}`}
      style={paneAnchor ? paneStyle(paneAnchor) : undefined}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        onAnswer(prompt.requestId, prompt.cancelId);
      }}
      initial={{ opacity: 0, y: -6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.12 } }}
      transition={{ type: 'spring', stiffness: 500, damping: 32 }}
      className={`fixed z-[1200] w-[340px] overflow-hidden rounded-2xl border border-droid-border bg-droid-raised shadow-droid ${
        paneAnchor ? '' : 'right-4 top-12'
      }`}
    >
      <div className="flex items-start gap-3 px-4 pb-3 pt-3.5">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-droid-elevated text-droid-text-secondary">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div
            id={titleId}
            title={prompt.origin ?? undefined}
            className="truncate text-[13px] font-medium tracking-tight text-droid-text"
          >
            {prompt.origin ? siteLabel(prompt.origin) : prompt.title}
          </div>
          {prompt.origin && <div className="text-[11px] text-droid-text-muted">{prompt.title}</div>}
          <p id={messageId} className="mt-2 text-[12.5px] leading-[18px] text-droid-text">
            {prompt.message}
          </p>
          {prompt.detail && (
            <p id={detailId} className="mt-1 text-[11.5px] leading-[17px] text-droid-text-muted">
              {prompt.detail}
            </p>
          )}
        </div>
      </div>
      <div className="px-4 pb-3.5">
        <BrowserPromptActions prompt={prompt} onAnswer={onAnswer} />
      </div>
      <BrowserPromptDeadline expiresAt={prompt.expiresAt} />
    </motion.div>,
    document.body,
  );
}
