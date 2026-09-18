import { useState } from 'react';
import { LayoutGroup, motion, useReducedMotion } from 'framer-motion';
import { Plus } from '@droidex/icons';
import { formatRelativeTime } from '../../lib/time';
import { INLINE_CARD_DURATION_S, INLINE_CARD_EASE } from '../../components/inlineCardMotion';
import { threadGroups, threadHeadline, type ThreadRow } from './threadBoard';

/* The Threads panel's list. The headline states the only fact that matters —
   what, if anything, is waiting on the user — and every row carries the thread's
   own last step underneath its name, never a status the app cannot back up.

   Groups keep a fixed order and appear only when they hold something, so the
   panel never spends a row saying a group is empty. */

export function ThreadList({
  rows,
  subtitle,
  now,
  busy,
  error,
  paused,
  uncertain,
  onResume,
  onOpenThread,
  onStartThread,
}: {
  rows: readonly ThreadRow[];
  subtitle: string;
  now: number;
  busy: boolean;
  error: string;
  /** Automatic reports and messages are held; threads themselves keep running. */
  paused: boolean;
  /** Deliveries that may already have landed before the app stopped. */
  uncertain: number;
  onResume: () => void;
  onOpenThread: (appSessionId: string) => void;
  onStartThread: (prompt: string) => void;
}) {
  const reduceMotion = useReducedMotion() === true;
  const [draft, setDraft] = useState('');
  const groups = threadGroups(rows);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-4 pb-3 pt-5">
          <h2 className="text-[21px] font-semibold leading-tight tracking-tight text-droid-text">
            {threadHeadline(rows)}
          </h2>
          <p className="mt-1.5 text-[12px] leading-5 text-droid-text-muted">{subtitle}</p>
        </div>

        {paused && (
          <div className="mx-4 mb-1 rounded-xl border border-droid-border px-3.5 py-3">
            <p className="text-[12px] leading-5 text-droid-text-secondary">
              {uncertain > 0
                ? 'A message may already have reached its thread before DROIDEX stopped. Resuming does not send it again.'
                : 'Coordination is paused: thread reports and queued messages wait until you resume.'}
            </p>
            <button
              type="button"
              onClick={onResume}
              className="mt-2 rounded-lg bg-droid-active px-2.5 py-1 text-[12px] font-medium text-droid-text transition-colors hover:bg-droid-elevated"
            >
              {uncertain > 0 ? 'Resume without resending' : 'Resume'}
            </button>
          </div>
        )}

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
                  <ThreadListRow
                    key={row.appSessionId}
                    row={row}
                    now={now}
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
        <div className="rounded-xl border border-droid-border bg-droid-surface/50 focus-within:border-droid-border-hover">
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
              if (event.key !== 'Enter' || event.shiftKey || !draft.trim() || busy) return;
              event.preventDefault();
              onStartThread(draft.trim());
              setDraft('');
            }}
            className="w-full resize-none bg-transparent px-3 py-2.5 text-[13px] leading-5 text-droid-text outline-none placeholder:text-droid-text-muted"
          />
          <div className="flex items-center justify-between gap-2 px-3 pb-2">
            <span className="truncate text-[11px] text-droid-text-muted">
              Runs with this chat’s harness, model and autonomy
            </span>
            <button
              type="button"
              disabled={busy || !draft.trim()}
              onClick={() => {
                onStartThread(draft.trim());
                setDraft('');
              }}
              className="flex shrink-0 items-center gap-1 rounded-lg bg-droid-active px-2.5 py-1 text-[12px] font-medium text-droid-text transition-colors hover:bg-droid-elevated disabled:opacity-40"
            >
              <Plus className="h-3 w-3" />
              {busy ? 'Starting…' : 'Start'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ThreadListRow({
  row,
  now,
  reduceMotion,
  onOpen,
}: {
  row: ThreadRow;
  now: number;
  reduceMotion: boolean;
  onOpen: (appSessionId: string) => void;
}) {
  return (
    <motion.button
      type="button"
      layout={!reduceMotion}
      layoutId={reduceMotion ? undefined : `thread-row:${row.appSessionId}`}
      transition={{ duration: INLINE_CARD_DURATION_S, ease: INLINE_CARD_EASE }}
      data-testid="thread-row"
      data-thread-state={row.state}
      disabled={row.unavailable}
      title={row.title}
      onClick={() => {
        onOpen(row.appSessionId);
      }}
      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-droid-elevated/50 disabled:cursor-default disabled:hover:bg-transparent"
    >
      <ThreadDot state={row.state} live={row.live} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[14px] font-medium leading-5 text-droid-text">
          {row.title}
        </span>
        <span
          className={`truncate text-[12px] leading-4 ${
            row.live ? 'shimmer-text font-medium' : 'text-droid-text-muted'
          }`}
        >
          {row.detail}
        </span>
      </span>
      <span className="shrink-0 text-[12px] tabular-nums text-droid-text-muted">
        {formatRelativeTime(row.updatedAt, now)}
      </span>
    </motion.button>
  );
}

const DOT_TONE: Record<ThreadRow['state'], string> = {
  attention: 'bg-droid-orange',
  working: 'bg-droid-green',
  idle: 'bg-droid-text-muted/60',
};

function ThreadDot({ state, live }: { state: ThreadRow['state']; live: boolean }) {
  const tone = DOT_TONE[state];
  return (
    <span
      aria-hidden="true"
      className={`h-[7px] w-[7px] shrink-0 rounded-full ${tone} ${
        live ? 'motion-safe:animate-pulse' : ''
      }`}
    />
  );
}
