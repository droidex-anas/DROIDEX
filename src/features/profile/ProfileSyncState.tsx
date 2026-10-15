import { motion } from 'framer-motion';
import { AlertTriangle, Check, RefreshCw } from 'lucide-react';
import type { UsageSyncState } from '../../../packages/remote/src/usage';
import type { ProfileUsageSnapshot } from './profileShare';

const SOURCES: { key: keyof ProfileUsageSnapshot['sync']['sources']; label: string }[] = [
  { key: 'jsonl', label: 'Claude Code and Codex' },
  { key: 'droid', label: 'Droid' },
  { key: 'openCode', label: 'OpenCode' },
];

function SourceMark({ state }: { state: UsageSyncState }) {
  if (state === 'ready') return <Check size={13} className="text-droid-green" />;
  if (state === 'error') return <AlertTriangle size={13} className="text-droid-red" />;
  return (
    <span className="relative flex h-3 w-3 items-center justify-center" aria-hidden>
      <span className="absolute h-3 w-3 rounded-full bg-droid-text-muted/30 motion-safe:animate-ping" />
      <span className="h-1.5 w-1.5 rounded-full bg-droid-text-muted" />
    </span>
  );
}

const STATE_LABEL: Record<UsageSyncState, string> = {
  indexing: 'Reading history',
  ready: 'Done',
  error: 'Needs attention',
};

// Shown while any source is still indexing or has failed. Totals stay hidden
// until every source is ready, so a partial ledger is never presented as real.
export function ProfileSyncState({
  sync,
  refreshing,
  onRefresh,
}: {
  sync: ProfileUsageSnapshot['sync'];
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const failed = sync.status === 'error';
  return (
    <motion.section
      aria-label="Usage indexing"
      role="status"
      className="rounded-2xl bg-droid-surface p-5"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-[13px] font-medium text-droid-text">
            {failed ? 'Indexing needs attention' : 'Indexing your local history'}
          </h3>
          <p className="mt-1 max-w-md text-[12px] leading-[18px] text-droid-text-muted">
            {failed
              ? 'One source could not be read. Restart DROIDEX, then check again. Sharing stays off until every source is complete.'
              : 'Your totals, activity and sharing appear once every source is read. This runs on this computer only.'}
          </p>
        </div>
        <button
          disabled={refreshing}
          onClick={onRefresh}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[12px] font-medium text-droid-text-secondary transition-[background-color,color,transform] duration-150 hover:bg-droid-elevated hover:text-droid-text active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-droid-accent/40 disabled:opacity-40"
        >
          <RefreshCw size={13} className={refreshing ? 'motion-safe:animate-spin' : ''} />
          Check again
        </button>
      </div>
      {!failed && (
        <div className="mt-4 h-1 overflow-hidden rounded-full bg-droid-elevated">
          <div className="h-full w-1/3 rounded-full bg-droid-text-muted/50 motion-safe:animate-[profile-indeterminate_1.6s_ease-in-out_infinite]" />
        </div>
      )}
      <ul className="mt-4 grid gap-2 sm:grid-cols-3">
        {SOURCES.map((source) => {
          const state = sync.sources[source.key];
          return (
            <li
              key={source.key}
              className="flex items-center gap-2.5 rounded-xl bg-droid-elevated/60 px-3 py-2.5"
            >
              <SourceMark state={state} />
              <div className="min-w-0">
                <p className="truncate text-[12px] text-droid-text">{source.label}</p>
                <p className="text-[11px] text-droid-text-muted">{STATE_LABEL[state]}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </motion.section>
  );
}
