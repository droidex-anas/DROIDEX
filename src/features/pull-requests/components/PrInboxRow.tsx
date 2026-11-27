import { ExternalLink, ListTodo, Undo } from '@droidex/icons';
import { motion, useReducedMotion } from 'framer-motion';

import { CheckStatusIcon, PrStateIcon } from '../../../components/environment/GithubIcons';
import { prKind } from '../../../lib/github';
import { openExternal } from '../../../lib/onboarding';
import type { PrChecksRollup } from '../../../types/vcs';
import type { InboxPullRequest } from '../lib/prInbox';
import { displayLogin } from '../lib/prIdentity';
import { hasMergeConflicts } from '../lib/prMeta';
import { prAbsoluteTime, prRelativeTime } from '../lib/prTime';
import { GithubAvatar } from './GithubAvatar';

const compactCount = new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

function CheckCell({ checks }: { checks?: PrChecksRollup | null }) {
  if (checks === 'pass') {
    return (
      <span className="flex w-20 shrink-0 items-center justify-start">
        <CheckStatusIcon status="success" size={14} />
      </span>
    );
  }
  if (checks === 'pending') {
    return (
      <span className="flex w-20 shrink-0 items-center gap-1.5 text-caption text-warning">
        <CheckStatusIcon status="pending" size={14} />
        <span className="truncate">Running</span>
      </span>
    );
  }
  if (checks === 'fail') {
    return (
      <span className="flex w-20 shrink-0 items-center gap-1.5 text-caption text-danger">
        <CheckStatusIcon status="failure" size={14} />
        <span className="truncate">Failing</span>
      </span>
    );
  }
  return <span aria-hidden="true" className="w-20 shrink-0" />;
}

function RowQuickActions({
  pr,
  backlogged,
  onToggleBacklog,
}: {
  pr: InboxPullRequest;
  backlogged: boolean;
  onToggleBacklog: (pr: InboxPullRequest) => void;
}) {
  return (
    <div className="pointer-events-none absolute right-2 flex items-center gap-0.5 opacity-0 transition-opacity duration-quick group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
      {pr.url ? (
        <button
          type="button"
          title="Open on GitHub"
          aria-label="Open on GitHub"
          onClick={(event) => {
            event.stopPropagation();
            void openExternal(pr.url);
          }}
          className="flex size-control-sm items-center justify-center rounded-md text-muted transition-colors hover:bg-elevated hover:text-primary"
        >
          <ExternalLink className="size-icon-sm" aria-hidden="true" />
        </button>
      ) : null}
      <button
        type="button"
        title={backlogged ? 'Restore from backlog' : 'Move to backlog'}
        aria-label={backlogged ? 'Restore from backlog' : 'Move to backlog'}
        onClick={(event) => {
          event.stopPropagation();
          onToggleBacklog(pr);
        }}
        className="flex size-control-sm items-center justify-center rounded-md text-muted transition-colors hover:bg-elevated hover:text-primary"
      >
        {backlogged ? (
          <Undo className="size-icon-sm" aria-hidden="true" />
        ) : (
          <ListTodo className="size-icon-sm" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}

export function PrInboxRow({
  pr,
  selected,
  focused,
  backlogged,
  showRepo,
  onSelect,
  onToggleBacklog,
}: {
  pr: InboxPullRequest;
  selected: boolean;
  focused: boolean;
  backlogged: boolean;
  showRepo: boolean;
  onSelect: (pr: InboxPullRequest) => void;
  onToggleBacklog: (pr: InboxPullRequest) => void;
}) {
  const reduceMotion = useReducedMotion() === true;
  const time = prRelativeTime(pr.updatedAt ?? pr.createdAt);
  const conflicting = hasMergeConflicts(pr);
  const branchText = pr.headRefName
    ? `${pr.baseRefName ? `${pr.baseRefName} ← ` : ''}${pr.headRefName}`
    : null;

  return (
    <motion.div
      layout={reduceMotion ? false : 'position'}
      transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 40 }}
      data-pr-row={`${pr.cwd}#${String(pr.number)}`}
      className={`group relative flex items-center rounded-lg transition-colors duration-quick ${
        selected || focused ? 'bg-active' : 'hover:bg-surface'
      }`}
    >
      <button
        type="button"
        aria-current={selected ? 'true' : undefined}
        onClick={() => {
          onSelect(pr);
        }}
        className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left"
      >
        <span className="flex size-4 shrink-0 items-center justify-center">
          <PrStateIcon kind={prKind(pr)} size={16} />
        </span>

        <span className="w-12 shrink-0 text-caption tabular-nums text-muted">#{pr.number}</span>

        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span title={pr.title} className="min-w-0 truncate text-body-strong text-primary">
            {pr.title}
          </span>
          {showRepo && pr.repoName ? (
            <span className="hidden max-w-32 shrink-0 truncate rounded-sm bg-elevated px-1.5 py-0.5 text-caption text-secondary sm:inline-block">
              {pr.repoName}
            </span>
          ) : null}
          {branchText ? (
            <span
              title={branchText}
              className="hidden max-w-44 shrink-0 truncate rounded-sm bg-elevated/70 px-1.5 py-0.5 text-caption text-muted lg:inline-block"
            >
              {branchText}
            </span>
          ) : null}
          {conflicting ? (
            <span className="shrink-0 text-caption text-danger">Conflicts</span>
          ) : null}
        </span>

        <span className="hidden w-24 shrink-0 text-right text-caption tabular-nums sm:inline">
          <span style={{ color: 'var(--diff-add-fg)' }}>+{compactCount.format(pr.additions)}</span>{' '}
          <span style={{ color: 'var(--diff-del-fg)' }}>−{compactCount.format(pr.deletions)}</span>
        </span>

        <span className="hidden md:flex">
          <CheckCell checks={pr.checks} />
        </span>

        <span className="hidden w-28 shrink-0 items-center gap-1.5 md:flex">
          <GithubAvatar login={pr.author} size={18} />
          <span className="min-w-0 truncate text-caption text-secondary">
            {displayLogin(pr.author)}
          </span>
        </span>

        <span className="flex w-14 shrink-0 items-center justify-end">
          {time ? (
            <span
              title={prAbsoluteTime(pr.updatedAt ?? pr.createdAt)}
              className="text-caption tabular-nums text-muted transition-opacity duration-quick group-hover:opacity-0 group-focus-within:opacity-0"
            >
              {time}
            </span>
          ) : null}
        </span>
      </button>

      <RowQuickActions pr={pr} backlogged={backlogged} onToggleBacklog={onToggleBacklog} />
    </motion.div>
  );
}
