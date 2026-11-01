import { motion } from 'framer-motion';
import { Spinner } from '@droidex/icons';
import { ActivityStatusGlyph } from '../../components/ActivityStatusGlyph';
import { ModelIcon } from '../../components/ModelIcon';
import { Button } from '../../components/ui/Button';
import { PROVIDER_LABELS, PROVIDER_MARKS } from '../providers/providerIdentity';
import { INLINE_CARD_DURATION_S, INLINE_CARD_EASE } from '../../components/inlineCardMotion';
import { formatRelativeTime } from '../../lib/time';
import type { ThreadRow as ThreadRowModel } from './threadBoard';

/* A thread row reads like a chat row in the inbox, because a thread is a chat:
   the same activity mark, the same title-over-detail, the same trailing model
   mark and time. What differs is that a thread another thread started is
   indented one step per level, and that the whole row lives inside Projects.

   Rows sit in a 12px gutter with 8px of their own, so the mark starts at 20px,
   on the edge the panel's headings and summary share. */

export function ThreadRow({
  row,
  now,
  active,
  reduceMotion,
  onOpen,
}: {
  row: ThreadRowModel;
  now: number;
  active: boolean;
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
      data-thread-status={row.status}
      title={row.title}
      aria-current={active ? 'true' : undefined}
      onClick={() => {
        onOpen(row.appSessionId);
      }}
      style={{ paddingLeft: `${String(8 + Math.min(row.depth, 3) * 14)}px` }}
      className={`group flex w-full items-center gap-2.5 rounded-md py-1.5 pr-2 text-left transition-colors ${
        active ? 'bg-active' : 'hover:bg-elevated/50'
      }`}
    >
      <ThreadMark row={row} />
      <ThreadText row={row} active={active} />
      <span className="ml-2 flex shrink-0 items-center gap-2.5">
        <ThreadIdentity row={row} />
        <span className="w-7 text-right text-caption tabular-nums text-muted">
          {row.updatedAt > 0 ? formatRelativeTime(row.updatedAt, now) : ''}
        </span>
      </span>
    </motion.button>
  );
}

/* A thread waiting on the user, with the one step that answers it on the row.
   The step opens the thread, where the approval or question waits. */
export function AttentionThreadRow({
  row,
  primary,
  reduceMotion,
  onOpen,
}: {
  row: ThreadRowModel;
  primary: boolean;
  reduceMotion: boolean;
  onOpen: (appSessionId: string) => void;
}) {
  const open = () => {
    onOpen(row.appSessionId);
  };
  const verb = ASKS_FOR_DECISION.includes(row.status) ? 'Review' : 'Open';
  return (
    <motion.div
      layout={!reduceMotion}
      layoutId={reduceMotion ? undefined : `thread-row:${row.appSessionId}`}
      transition={{ duration: INLINE_CARD_DURATION_S, ease: INLINE_CARD_EASE }}
      data-testid="thread-row"
      data-thread-status={row.status}
      className="group flex items-center gap-2.5 rounded-md py-2 pl-1 pr-1 transition-colors hover:bg-elevated/50"
    >
      <button
        type="button"
        title={row.title}
        onClick={open}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-sm text-left"
      >
        <ThreadMark row={row} />
        <ThreadText row={row} active />
      </button>
      <ThreadIdentity row={row} />
      <Button
        variant={primary ? 'primary' : 'secondary'}
        size="sm"
        aria-label={`${verb} ${row.title}`}
        onClick={open}
      >
        {verb}
      </Button>
    </motion.div>
  );
}

const ASKS_FOR_DECISION: readonly ThreadRowModel['status'][] = ['approval', 'input', 'plan'];

function ThreadMark({ row }: { row: ThreadRowModel }) {
  return (
    <span className="flex w-3.5 shrink-0 items-center justify-center">
      {row.live ? (
        <Spinner
          aria-label="working"
          className="h-3 w-3 motion-safe:animate-spin-slow text-primary"
        />
      ) : (
        <ActivityStatusGlyph status={row.status} />
      )}
    </span>
  );
}

function ThreadText({ row, active }: { row: ThreadRowModel; active: boolean }) {
  return (
    <span className="min-w-0 flex-1">
      <span
        className={`block truncate text-body ${
          active ? 'text-primary' : 'text-secondary group-hover:text-primary'
        }`}
      >
        {row.title}
      </span>
      <span
        className={`mt-0.5 block truncate text-caption ${
          row.live ? 'shimmer-text font-medium' : 'text-muted'
        }`}
      >
        {row.detail}
      </span>
    </span>
  );
}

/* The harness mark the chat list uses, so a thread is identified the same way
   its chat is; Droid, the default, wears none there either. */
function ThreadIdentity({ row }: { row: ThreadRowModel }) {
  const harness = row.provider && row.provider !== 'droid' ? row.provider : undefined;
  return (
    <>
      {row.droidProfile === 'alt' && (
        <span className="shrink-0 text-caption text-muted" title="Alt Factory account">
          <span className="sr-only">Factory account: </span>Alt
        </span>
      )}
      <span className="flex w-4 shrink-0 justify-center">
        {harness && (
          <span role="img" aria-label={`${PROVIDER_LABELS[harness]} thread`}>
            <ModelIcon provider={PROVIDER_MARKS[harness]} size={14} />
          </span>
        )}
      </span>
    </>
  );
}
