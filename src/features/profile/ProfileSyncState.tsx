import { motion } from 'framer-motion';
import { AlertTriangle, Check, RefreshCw } from '@droidex/icons';
import { Button } from '../../components/ui/Button';
import type { UsageSyncState } from '../../../packages/remote/src/usage';
import type { ProfileUsageSnapshot } from './profileShare';

const SOURCES: { key: keyof ProfileUsageSnapshot['sync']['sources']; label: string }[] = [
  { key: 'jsonl', label: 'Claude Code and Codex' },
  { key: 'droid', label: 'Droid' },
  { key: 'openCode', label: 'OpenCode' },
];

function SourceMark({ state }: { state: UsageSyncState }) {
  if (state === 'ready') return <Check className="size-icon-sm text-success" aria-hidden="true" />;
  if (state === 'error')
    return <AlertTriangle className="size-icon-sm text-danger" aria-hidden="true" />;
  return (
    <span className="relative flex size-3 items-center justify-center" aria-hidden="true">
      <span className="absolute size-3 rounded-full bg-muted/30 motion-safe:animate-ping" />
      <span className="size-1.5 rounded-full bg-muted" />
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
      className="rounded-xl bg-surface p-5"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-body-strong text-primary">
            {failed ? 'Indexing needs attention' : 'Indexing your local history'}
          </h3>
          <p className="mt-1 max-w-md text-body text-muted">
            {failed
              ? 'One source could not be read. Restart DROIDEX, then check again. Sharing stays off until every source is complete.'
              : 'Your totals, activity and sharing appear once every source is read. This runs on this computer only.'}
          </p>
        </div>
        <Button
          variant="ghost"
          disabled={refreshing}
          onClick={onRefresh}
          icon={
            <RefreshCw
              className={`size-icon-md shrink-0 ${refreshing ? 'motion-safe:animate-spin' : ''}`}
              aria-hidden="true"
            />
          }
        >
          Check again
        </Button>
      </div>
      {!failed && (
        <div className="mt-4 h-1 overflow-hidden rounded-full bg-elevated">
          <div className="profile-indeterminate h-full w-1/3 rounded-full bg-muted/50" />
        </div>
      )}
      <ul className="mt-4 grid gap-2 sm:grid-cols-3">
        {SOURCES.map((source) => {
          const state = sync.sources[source.key];
          return (
            <li
              key={source.key}
              className="flex items-center gap-2.5 rounded-lg bg-elevated/60 px-3 py-2.5"
            >
              <SourceMark state={state} />
              <div className="min-w-0">
                <p className="truncate text-body text-primary">{source.label}</p>
                <p className="text-caption text-muted">{STATE_LABEL[state]}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </motion.section>
  );
}
