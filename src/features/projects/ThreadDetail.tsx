import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ExternalLink } from '@droidex/icons';
import { buildFeed } from '../../components/chatFeed';
import { MessageFeed } from '../../components/MessageFeed';
import { loadSessionHistory, sendToSession } from '../../lib/commands';
import type { ToolActivitySettings } from '../../lib/toolActivity';
import type { TranscriptEvent } from '../../types/bridge';
import type { ThreadRow } from './threadBoard';

/* One thread inside the panel: its own conversation, read the way the chat
   reads it, and a composer that steers it without leaving the project chat.
   Opening it in the main pane stays one click away, because a thread is an
   ordinary session with the same review, diff and settings surfaces. */

export function ThreadDetail({
  row,
  transcript,
  toolActivity,
  onBack,
  onStop,
  onOpenInChat,
}: {
  row: ThreadRow;
  transcript: readonly TranscriptEvent[] | undefined;
  toolActivity: ToolActivitySettings;
  onBack: () => void;
  // Stops the thread's turn and drops the project work still queued for it.
  onStop: () => void;
  onOpenInChat: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const events = useMemo(() => [...(transcript ?? EMPTY)], [transcript]);
  const items = useMemo(() => buildFeed(events, { childSessionCards: true }), [events]);

  // The thread may never have been opened in this window; its history loads the
  // same way the chat loads one.
  useEffect(() => {
    if (transcript === undefined) loadSessionHistory(row.appSessionId);
  }, [transcript, row.appSessionId]);

  function steer(): void {
    const text = draft.trim();
    if (!text) return;
    try {
      sendToSession(row.appSessionId, text);
      setDraft('');
      setError('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }

  return (
    <div data-testid="thread-detail" className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-droid-border/70 px-3 py-2.5">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to threads"
          className="shrink-0 rounded-md p-1 text-droid-text-muted transition-colors hover:bg-droid-elevated hover:text-droid-text"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
        <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-droid-text">
          {row.title}
        </span>
        {row.live && (
          <button
            type="button"
            onClick={onStop}
            className="shrink-0 rounded-md px-2 py-1 text-[12px] text-droid-text-muted transition-colors hover:bg-droid-elevated hover:text-droid-text"
          >
            Stop
          </button>
        )}
        <button
          type="button"
          onClick={onOpenInChat}
          className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[12px] text-droid-text-muted transition-colors hover:bg-droid-elevated hover:text-droid-text"
        >
          Open
          <ExternalLink className="h-3 w-3" />
        </button>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="min-w-0 px-4 py-3">
          {events.length > 0 ? (
            <MessageFeed
              events={events}
              items={items}
              pending={row.live}
              scrollElementRef={scrollRef}
              density={toolActivity.density}
              inlineDiffs={toolActivity.inlineDiffs}
            />
          ) : (
            <p className="text-[12px] leading-5 text-droid-text-muted">
              {transcript === undefined ? 'Loading this thread…' : row.detail}
            </p>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-droid-border/70 p-3">
        {error && (
          <p role="alert" className="mb-2 px-1 text-[12px] leading-5 text-droid-text-secondary">
            {error}
          </p>
        )}
        <div className="rounded-xl border border-droid-border bg-droid-surface/50 focus-within:border-droid-border-hover">
          <textarea
            value={draft}
            rows={2}
            maxLength={8_192}
            placeholder="Steer this thread…"
            onChange={(event) => {
              setDraft(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.shiftKey) return;
              event.preventDefault();
              steer();
            }}
            className="w-full resize-none bg-transparent px-3 py-2.5 text-[13px] leading-5 text-droid-text outline-none placeholder:text-droid-text-muted"
          />
          <div className="flex items-center justify-between gap-2 px-3 pb-2">
            <span className="truncate text-[11px] text-droid-text-muted">
              {row.live ? 'Delivered after its current turn' : 'Sent to this thread'}
            </span>
            <button
              type="button"
              disabled={!draft.trim()}
              onClick={steer}
              className="shrink-0 rounded-lg bg-droid-active px-2.5 py-1 text-[12px] font-medium text-droid-text transition-colors hover:bg-droid-elevated disabled:opacity-40"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const EMPTY: TranscriptEvent[] = [];
