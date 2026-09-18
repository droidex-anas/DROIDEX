import { motion } from 'framer-motion';
import { ActivityStatusGlyph } from '../../components/ActivityStatusGlyph';
import { ModelIcon } from '../../components/ModelIcon';
import { PROVIDER_LABELS, PROVIDER_MARKS } from '../providers/providerIdentity';
import { INLINE_CARD_DURATION_S, INLINE_CARD_EASE } from '../../components/inlineCardMotion';
import { formatRelativeTime } from '../../lib/time';
import type { ThreadRow as ThreadRowModel } from './threadBoard';

/* A thread row reads like a chat row in the inbox, because a thread is a chat:
   the same activity mark, the same title-over-detail, the same trailing model
   mark and time. What differs is nesting — a thread a thread started sits
   indented under it — and that the whole row lives inside Projects. */

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
      disabled={row.unavailable}
      title={row.title}
      aria-current={active ? 'true' : undefined}
      onClick={() => {
        onOpen(row.appSessionId);
      }}
      style={{ paddingLeft: `${String(10 + Math.min(row.depth, 3) * 14)}px` }}
      className={`group flex w-full items-center gap-2.5 rounded-lg py-1.5 pr-2 text-left transition-colors disabled:cursor-default ${
        active ? 'bg-droid-active' : 'hover:bg-droid-elevated/50 disabled:hover:bg-transparent'
      }`}
    >
      <span className="flex w-3.5 shrink-0 items-center justify-center">
        {row.live ? (
          <span
            aria-label="working"
            className="h-3 w-3 rounded-full border-[1.5px] border-droid-text border-r-transparent motion-safe:animate-spin-slow"
          />
        ) : (
          <ActivityStatusGlyph status={row.status} />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-droid-text-secondary group-hover:text-droid-text">
          {row.title}
        </span>
        <span
          className={`mt-0.5 block truncate text-[12px] leading-4 ${
            row.live ? 'shimmer-text font-medium' : 'text-droid-text-muted'
          }`}
        >
          {row.detail}
        </span>
      </span>
      {/* The harness mark the chat list uses, so a thread is identified the
          same way its chat is; Droid, the default, wears none there either. */}
      <span className="ml-2 grid shrink-0 grid-cols-[16px_34px] items-center gap-x-2.5">
        <span className="flex justify-center">
          {harness && (
            <span role="img" aria-label={`${PROVIDER_LABELS[harness]} thread`}>
              <ModelIcon provider={PROVIDER_MARKS[harness]} size={14} />
            </span>
          )}
        </span>
        <span className="text-right text-[12px] tabular-nums text-droid-text-muted">
          {formatRelativeTime(row.updatedAt, now)}
        </span>
      </span>
    </motion.button>
  );
}
