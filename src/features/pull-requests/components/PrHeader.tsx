import type { ReactNode } from 'react';

import { Badge } from '../../../components/ui/Badge';
import {
  CheckStatusIcon,
  Octicon,
  type OcticonName,
} from '../../../components/environment/GithubIcons';
import {
  checksBadge,
  checksSummary,
  prKind,
  prKindLabel,
  reviewDecisionBadge,
  type PrKind,
  type PrTone,
} from '../../../lib/github';
import type { PrCheck, PullRequest } from '../../../types/vcs';
import { displayLogin } from '../lib/prIdentity';
import { REVIEWER_STATE_LABEL, mergeStateBadge, reviewerRows } from '../lib/prMeta';
import { prAbsoluteTime, prRelativeTime } from '../lib/prTime';
import { GithubAvatar } from './GithubAvatar';

// Plain status text (no badge fill) for a PR fact, such as the checks rollup
// beside the reviewers. Badges use the same tones in ui/Badge.
const TONE_TEXT: Record<PrTone, string> = {
  neutral: 'text-secondary',
  success: 'text-success',
  danger: 'text-danger',
  accent: 'text-accent',
};

const STATE_PILL: Record<PrKind, { tone: PrTone; icon: OcticonName }> = {
  open: { tone: 'success', icon: 'git-pull-request' },
  draft: { tone: 'neutral', icon: 'git-pull-request-draft' },
  merged: { tone: 'accent', icon: 'git-merge' },
  closed: { tone: 'danger', icon: 'git-pull-request-closed' },
};

function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-x-4">
      <dt className="w-20 shrink-0 pt-0.5 text-body text-muted">{label}</dt>
      <dd className="min-w-0 flex-1 text-body text-secondary">{children}</dd>
    </div>
  );
}

function Reviewers({ pr }: { pr: PullRequest }) {
  const rows = reviewerRows(pr);
  if (rows.length === 0) return <span className="text-muted">No reviewers</span>;
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {rows.map((row) => (
        <span key={row.login} className="flex items-center gap-1.5">
          <GithubAvatar login={row.login} size={18} />
          <span className="text-primary">{displayLogin(row.login)}</span>
          <span className="text-muted">{REVIEWER_STATE_LABEL[row.state]}</span>
        </span>
      ))}
    </span>
  );
}

// The rolled-up check state, next to the reviewers and comment count it is read
// with. The Checks section below owns the individual runs.
function ChecksMeta({
  checks,
  loading,
  error,
}: {
  checks: PrCheck[];
  loading: boolean;
  error: string | null;
}) {
  const summary = checksSummary(checks);
  const badge = checksBadge(summary);
  if (!badge) {
    // A failed load must not read as "this pull request has no checks"; the
    // Checks section below states the error itself.
    if (loading) return <span className="text-muted">Loading…</span>;
    return <span className="text-muted">{error ? 'Unavailable' : 'No checks reported'}</span>;
  }
  return (
    <span className="flex items-center gap-1.5">
      <CheckStatusIcon status={summary.status === 'none' ? 'neutral' : summary.status} size={14} />
      <span className={TONE_TEXT[badge.tone]}>{badge.label}</span>
    </span>
  );
}

export function PrHeader({
  pr,
  number,
  commentCount,
  checks,
  checksLoading,
  checksError,
}: {
  pr: PullRequest | null;
  number: number;
  commentCount: number;
  checks: PrCheck[];
  checksLoading: boolean;
  checksError: string | null;
}) {
  const kind = pr ? prKind(pr) : null;
  const updated = prRelativeTime(pr?.updatedAt ?? pr?.createdAt ?? null);
  const mergeState = mergeStateBadge(pr);
  const decision = reviewDecisionBadge(pr);

  return (
    <header>
      <h1 className="text-title text-primary">
        {pr ? (
          <>
            {pr.title}
            <span className="ml-2 font-normal tabular-nums text-muted">#{String(number)}</span>
          </>
        ) : (
          `Pull request #${String(number)}`
        )}
      </h1>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {kind ? (
          <Badge tone={STATE_PILL[kind].tone}>
            <Octicon name={STATE_PILL[kind].icon} size={12} />
            {prKindLabel(kind)}
          </Badge>
        ) : (
          <span className="inline-flex h-5 w-20 rounded-full bg-elevated/60" />
        )}
        {pr ? (
          <span className="flex items-center gap-1.5 text-body text-secondary">
            <GithubAvatar login={pr.author} size={20} />
            <span className="text-primary">{displayLogin(pr.author)}</span>
            {updated ? (
              <span title={prAbsoluteTime(pr.updatedAt ?? pr.createdAt)} className="text-muted">
                {/* `prRelativeTime` returns either "now" or an age like "3d",
                    and only an age reads as "ago". */}
                updated {updated === 'now' ? 'now' : `${updated} ago`}
              </span>
            ) : null}
          </span>
        ) : null}
        {decision ? <Badge tone={decision.tone}>{decision.label}</Badge> : null}
      </div>
      {pr ? (
        <dl className="mt-4 flex flex-col gap-y-2">
          <MetaRow label="Branch">
            <span className="flex min-w-0 items-center gap-1.5">
              <Octicon name="git-branch" size={13} className="shrink-0 text-muted" />
              <span className="truncate text-primary">{pr.headRefName ?? 'unknown'}</span>
              <span className="shrink-0 text-muted">into</span>
              <span className="truncate">{pr.baseRefName ?? 'unknown'}</span>
            </span>
          </MetaRow>
          <MetaRow label="Changes">
            <span className="flex items-center gap-2 tabular-nums">
              <span>
                {pr.changedFiles} {pr.changedFiles === 1 ? 'file' : 'files'}
              </span>
              <span style={{ color: 'var(--diff-add-fg)' }}>+{pr.additions}</span>
              <span style={{ color: 'var(--diff-del-fg)' }}>−{pr.deletions}</span>
            </span>
          </MetaRow>
          <MetaRow label="Reviewers">
            <Reviewers pr={pr} />
          </MetaRow>
          <MetaRow label="Comments">
            <span className="tabular-nums">{commentCount}</span>
          </MetaRow>
          <MetaRow label="Checks">
            <ChecksMeta checks={checks} loading={checksLoading} error={checksError} />
          </MetaRow>
          {mergeState ? (
            <MetaRow label="Status">
              <span className={TONE_TEXT[mergeState.tone]}>{mergeState.label}</span>
            </MetaRow>
          ) : null}
        </dl>
      ) : null}
    </header>
  );
}
