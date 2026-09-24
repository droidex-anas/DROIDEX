import { useEffect, useMemo, useRef } from 'react';
import { ArrowLeft, ExternalLink } from '@droidex/icons';
import { ActivityStatusGlyph } from '../../components/ActivityStatusGlyph';
import { buildFeed } from '../../components/chatFeed';
import { MessageFeed } from '../../components/MessageFeed';
import { loadSessionHistory } from '../../lib/commands';
import type { ToolActivitySettings } from '../../lib/toolActivity';
import type { TranscriptEvent } from '../../types/bridge';
import type { ThreadRow } from './threadBoard';

/* One thread, read in place: its own conversation exactly as the chat renders
   it. There is no composer here on purpose — the chat that started the thread
   steers it with its own tools, and opening the thread gives the user the real
   composer with its model, autonomy and every other session control. */

export function ThreadDetail({
  row,
  transcript,
  historyError,
  toolActivity,
  onBack,
  onOpenInChat,
}: {
  row: ThreadRow;
  transcript: TranscriptEvent[] | undefined;
  /** Why this thread's history could not be read, when it could not. */
  historyError: string;
  toolActivity: ToolActivitySettings;
  onBack: () => void;
  onOpenInChat: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const events = transcript ?? EMPTY;
  const items = useMemo(() => buildFeed(events, { childSessionCards: true }), [events]);

  // The thread may never have been opened in this window; its history loads the
  // same way the chat loads one. A load that failed is not retried on its own:
  // it would spin against the same failure.
  useEffect(() => {
    if (transcript === undefined && !historyError) loadSessionHistory(row.appSessionId);
  }, [transcript, historyError, row.appSessionId]);

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
        <ActivityStatusGlyph status={row.status} />
        <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-droid-text">
          {row.title}
        </span>
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
              {historyError || (transcript === undefined ? 'Loading this thread…' : row.detail)}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

const EMPTY: TranscriptEvent[] = [];
