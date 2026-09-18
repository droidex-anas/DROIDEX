import { useState } from 'react';
import { LayoutGroup, motion, useReducedMotion } from 'framer-motion';
import { ArrowUp } from '@droidex/icons';
import { ThreadRow } from './ThreadRow';
import { threadGroups, threadHeadline, type ThreadRow as ThreadRowModel } from './threadBoard';

/* The Threads list. The headline states the only fact that matters — what, if
   anything, is waiting on the user — and every row carries the thread's own last
   step, never a status the app cannot back up.

   Groups keep a fixed order and appear only when they hold something, so the
   list never spends a row saying a group is empty. */

export function ThreadList({
  rows,
  subtitle,
  now,
  busy,
  error,
  activeAppSessionId,
  onOpenThread,
  onStartThread,
}: {
  rows: readonly ThreadRowModel[];
  subtitle: string;
  now: number;
  busy: boolean;
  error: string;
  activeAppSessionId?: string | null;
  onOpenThread: (appSessionId: string) => void;
  onStartThread: (prompt: string) => void;
}) {
  const reduceMotion = useReducedMotion() === true;
  const [draft, setDraft] = useState('');
  const groups = threadGroups(rows);
  const send = () => {
    const prompt = draft.trim();
    if (!prompt || busy) return;
    onStartThread(prompt);
    setDraft('');
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-4 pb-3 pt-5">
          <h2 className="text-[21px] font-semibold leading-tight tracking-tight text-droid-text">
            {threadHeadline(rows)}
          </h2>
          <p className="mt-1.5 text-[12px] leading-5 text-droid-text-muted">{subtitle}</p>
        </div>

        <div className="px-2 pb-3">
          <LayoutGroup>
            {groups.map((group) => (
              <div key={group.key}>
                <motion.div
                  layout={!reduceMotion}
                  className="px-3 pb-1.5 pt-4 text-[13px] font-medium text-droid-text-muted"
                >
                  {group.label} · {group.rows.length}
                </motion.div>
                {group.rows.map((row) => (
                  <ThreadRow
                    key={row.appSessionId}
                    row={row}
                    now={now}
                    active={row.appSessionId === activeAppSessionId}
                    reduceMotion={reduceMotion}
                    onOpen={onOpenThread}
                  />
                ))}
              </div>
            ))}
          </LayoutGroup>
          {rows.length === 0 && (
            <p className="px-3 py-2 text-[13px] leading-5 text-droid-text-muted">
              Threads are separate conversations this chat runs in parallel. Ask for one here, or
              tell the chat to start one.
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
        <div className="rounded-xl border border-droid-border bg-droid-surface/50 transition-colors focus-within:border-droid-border-hover">
          <textarea
            value={draft}
            rows={2}
            maxLength={8_192}
            disabled={busy}
            placeholder="Start a thread…"
            onChange={(event) => {
              setDraft(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.shiftKey) return;
              event.preventDefault();
              send();
            }}
            className="w-full resize-none bg-transparent px-3 py-2.5 text-[13px] leading-5 text-droid-text outline-none placeholder:text-droid-text-muted"
          />
          <div className="flex items-center justify-between gap-2 px-3 pb-2">
            <span className="truncate text-[11px] text-droid-text-muted">
              Runs with this chat’s harness, model and autonomy
            </span>
            <button
              type="button"
              aria-label="Start thread"
              disabled={busy || !draft.trim()}
              onClick={send}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-droid-text text-droid-bg transition-opacity hover:opacity-80 disabled:opacity-30"
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
