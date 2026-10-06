import { useState, type ReactNode } from 'react';
import { Square } from '@droidex/icons';
import { CompactComposer } from '../composer/CompactComposer';

/* The side chat's own small composer: a question, send, and stop while the
   side chat answers. A side question is short,
   so there are no attachments, skills, or modes here; the main composer has them. */

export function SideChatComposer({
  initialText = '',
  placeholder,
  live,
  blockedReason,
  leading,
  onSend,
  onStop,
}: {
  initialText?: string;
  placeholder: string;
  live: boolean;
  // Why nothing can be sent right now, shown in place of the send hint.
  blockedReason?: string;
  // The harness chip for a new side chat; follow-ups have none and fold to one line.
  leading?: ReactNode;
  // Returns whether the text was taken, so a refused send keeps the draft.
  onSend: (text: string) => boolean;
  onStop?: () => void;
}) {
  const [text, setText] = useState(initialText);
  const canSend = !live && !blockedReason && text.trim().length > 0;

  return (
    <div className="shrink-0 px-3 pb-3 pt-1">
      <CompactComposer
        value={text}
        onChange={setText}
        onSend={() => {
          if (canSend && onSend(text)) setText('');
        }}
        canSend={canSend}
        autoFocus
        placeholder={placeholder}
        label="Side chat message"
        sendLabel="Send side chat message"
        leading={leading}
        status={
          blockedReason ? (
            <span className="min-w-0 truncate text-[11px] text-droid-text-muted">
              {blockedReason}
            </span>
          ) : null
        }
        action={
          live && onStop ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop side chat"
              title="Stop"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-droid-text text-droid-bg transition-opacity hover:opacity-90"
            >
              <Square className="h-3 w-3" fill="currentColor" strokeWidth={0} />
            </button>
          ) : undefined
        }
      />
    </div>
  );
}
