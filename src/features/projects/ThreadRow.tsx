import { motion } from 'framer-motion';
import { Spinner } from '@droidex/icons';
import { ActivityStatusGlyph } from '../../components/ActivityStatusGlyph';
import { ModelIcon } from '../../components/ModelIcon';
import { PROVIDER_LABELS, PROVIDER_MARKS } from '../providers/providerIdentity';
import { INLINE_CARD_DURATION_S, INLINE_CARD_EASE } from '../../components/inlineCardMotion';
import { formatRelativeTime } from '../../lib/time';
import type { ThreadRow as ThreadRowModel } from './threadBoard';

/* A thread row reads like a chat row in the inbox, because a thread is a chat:
   the same activity mark, the same title-over-detail, the same trailing model
   mark and time. What differs is that a thread another thread started is
   indented one step per level, and that the whole row lives inside Projects. */

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
  const harness = row.provider && row.provider !== 'droid' ? row.provider : undefined;
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
      style={{ paddingLeft: `${String(10 + Math.min(row.depth, 3) * 14)}px` }}
      className={`group flex w-full items-center gap-2.5 rounded-md py-1.5 pr-2 text-left transition-colors ${
        active ? 'bg-active' : 'hover:bg-elevated/50'
      }`}
    >
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
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body text-secondary group-hover:text-primary">
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
      {/* The harness mark the chat list uses, so a thread is identified the
          same way its chat is; Droid, the default, wears none there either. */}
      <span className="ml-2 flex shrink-0 items-center gap-2.5">
        <span className="flex w-4 justify-center">
          {harness && (
            <span role="img" aria-label={`${PROVIDER_LABELS[harness]} thread`}>
              <ModelIcon provider={PROVIDER_MARKS[harness]} size={14} />
            </span>
          )}
        </span>
        <span className="text-right text-caption tabular-nums text-muted">
          {row.updatedAt > 0 ? formatRelativeTime(row.updatedAt, now) : ''}
        </span>
      </span>
    </motion.button>
  );
}
