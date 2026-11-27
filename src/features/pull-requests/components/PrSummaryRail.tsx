import { useMemo, useState, type ReactNode } from 'react';

import { CheckStatusIcon } from '../../../components/environment/GithubIcons';
import { Badge, CountBadge } from '../../../components/ui/Badge';
import {
  bucketToStatus,
  checksBadge,
  checksSummary,
  type CheckStatus,
  type PrTone,
} from '../../../lib/github';
import { openExternal } from '../../../lib/onboarding';
import type { PrCheck, PullRequest } from '../../../types/vcs';
import { displayLogin } from '../lib/prIdentity';
import { REVIEWER_STATE_LABEL, mergeStateBadge, reviewerRows } from '../lib/prMeta';
import { prAbsoluteTime, prRelativeTime } from '../lib/prTime';
import { GithubAvatar } from './GithubAvatar';
import { PrCollapse } from './PrCollapse';

const VISIBLE_CHECKS = 5;

// Failures first, then work in progress: the runs that need reading lead.
const CHECK_ORDER: Record<CheckStatus, number> = {
  failure: 0,
  pending: 1,
  success: 2,
  neutral: 3,
};

const TONE_TEXT: Record<PrTone, string> = {
  neutral: 'text-secondary',
  success: 'text-success',
  danger: 'text-danger',
  accent: 'text-accent',
};

function RailGroup({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="flex h-6 items-center justify-between gap-2">
        <h2 className="text-label text-muted">{title}</h2>
        {meta}
      </div>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function CheckRow({ check }: { check: PrCheck }) {
  const finished = prRelativeTime(check.completedAt ?? check.startedAt);
  const detail = [check.workflow, check.description].filter(Boolean).join(' · ');
  return (
    <button
      type="button"
      onClick={() => {
        if (check.link) void openExternal(check.link);
      }}
      disabled={!check.link}
      title={check.link ? `Open ${check.name} on GitHub` : detail || check.state}
      className="flex h-8 w-full select-none items-center gap-2.5 rounded-md px-2 text-left transition-colors duration-quick enabled:hover:bg-elevated disabled:cursor-default"
    >
      <CheckStatusIcon status={bucketToStatus(check.bucket)} size={16} />
      <span className="min-w-0 flex-1 truncate text-body text-primary">{check.name}</span>
      {finished ? (
        <span className="shrink-0 text-caption tabular-nums text-muted">{finished}</span>
      ) : null}
    </button>
  );
}

function checkKey(check: PrCheck, index: number): string {
  // A matrix job or a re-run reports the same name and workflow twice; the
  // run link is what tells the two runs apart.
  return `${check.name}-${check.workflow ?? ''}-${check.link ?? ''}-${String(index)}`;
}

function Checks({
  checks,
  loading,
  error,
}: {
  checks: PrCheck[];
  loading: boolean;
  error: string | null;
}) {
  const [showAll, setShowAll] = useState(false);
  const ordered = useMemo(
    () =>
      checks
        .map((check, index) => ({ check, key: checkKey(check, index) }))
        .sort(
          (left, right) =>
            CHECK_ORDER[bucketToStatus(left.check.bucket)] -
            CHECK_ORDER[bucketToStatus(right.check.bucket)],
        ),
    [checks],
  );

  if (ordered.length === 0) {
    if (loading) {
      return (
        <div className="space-y-1">
          {[0, 1, 2].map((row) => (
            <div key={row} className="h-8 rounded-md bg-elevated/40" />
          ))}
        </div>
      );
    }
    return <p className="text-body text-muted">{error ?? 'No checks reported'}</p>;
  }

  const head = ordered.slice(0, VISIBLE_CHECKS);
  const rest = ordered.slice(VISIBLE_CHECKS);
  return (
    <>
      {error ? <p className="mb-1 text-body text-muted">{error}</p> : null}
      {/* Rows are ghost controls, so their text aligns with the group title
          and the hover fill hangs into the gutter. */}
      <div className="-mx-2">
        {head.map(({ check, key }) => (
          <CheckRow key={key} check={check} />
        ))}
        {rest.length > 0 ? (
          <>
            <PrCollapse open={showAll}>
              {rest.map(({ check, key }) => (
                <CheckRow key={key} check={check} />
              ))}
            </PrCollapse>
            <button
              type="button"
              aria-expanded={showAll}
              onClick={() => {
                setShowAll((value) => !value);
              }}
              className="flex h-8 w-full select-none items-center rounded-md px-2 text-left text-body text-muted transition-colors duration-quick hover:bg-elevated hover:text-secondary"
            >
              {showAll ? 'Show fewer' : `Show ${String(rest.length)} more`}
            </button>
          </>
        ) : null}
      </div>
    </>
  );
}

function Reviewers({ pr }: { pr: PullRequest }) {
  const rows = reviewerRows(pr);
  if (rows.length === 0) return <p className="text-body text-muted">No reviewers</p>;
  return (
    <ul>
      {rows.map((row) => (
        <li key={row.login} className="flex h-8 items-center gap-2.5">
          <GithubAvatar login={row.login} size={18} />
          <span className="min-w-0 flex-1 truncate text-body text-primary">
            {displayLogin(row.login)}
          </span>
          <span className="shrink-0 text-caption text-muted">
            {REVIEWER_STATE_LABEL[row.state]}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex h-7 items-center justify-between gap-3">
      <dt className="shrink-0 text-body text-muted">{label}</dt>
      <dd className="min-w-0 truncate text-body text-secondary tabular-nums">{children}</dd>
    </div>
  );
}

function Details({
  pr,
  commentCount,
  commitCount,
}: {
  pr: PullRequest;
  commentCount: number;
  commitCount: number;
}) {
  const mergeState = mergeStateBadge(pr);
  const opened = prRelativeTime(pr.createdAt);
  return (
    <dl>
      <Fact label="Files">
        {pr.changedFiles}
        {' · '}
        <span style={{ color: 'var(--diff-add-fg)' }}>
          +{pr.additions.toLocaleString('en')}
        </span>{' '}
        <span style={{ color: 'var(--diff-del-fg)' }}>−{pr.deletions.toLocaleString('en')}</span>
      </Fact>
      <Fact label="Commits">{commitCount}</Fact>
      <Fact label="Comments">{commentCount}</Fact>
      {opened ? (
        <Fact label="Opened">
          <span title={prAbsoluteTime(pr.createdAt)}>
            {opened === 'now' ? 'now' : `${opened} ago`}
          </span>
        </Fact>
      ) : null}
      {mergeState ? (
        <Fact label="Merge">
          <span className={TONE_TEXT[mergeState.tone]}>{mergeState.label}</span>
        </Fact>
      ) : null}
    </dl>
  );
}

// The glanceable status of a pull request. Both groups sit in a rail beside
// the conversation in a wide pane; a narrow pane puts the checks above the
// description and the people and facts after the conversation (see
// `.pr-summary-grid` in index.css).
function ChecksState({
  badge,
  loading,
  error,
}: {
  badge: ReturnType<typeof checksBadge>;
  loading: boolean;
  error: string | null;
}) {
  if (badge) return <Badge tone={badge.tone}>{badge.label}</Badge>;
  // A failed load must not read as "this pull request has no checks".
  if (error && !loading) return <Badge>Unavailable</Badge>;
  return null;
}

export function PrRailChecks({
  checks,
  loading,
  error,
}: {
  checks: PrCheck[];
  loading: boolean;
  error: string | null;
}) {
  const badge = checksBadge(checksSummary(checks));
  return (
    <aside aria-label="Checks" className="pr-summary-checks">
      <RailGroup
        title="Checks"
        meta={<ChecksState badge={badge} loading={loading} error={error} />}
      >
        <Checks checks={checks} loading={loading} error={error} />
      </RailGroup>
    </aside>
  );
}

export function PrRailFacts({
  pr,
  commentCount,
  commitCount,
}: {
  pr: PullRequest;
  commentCount: number;
  commitCount: number;
}) {
  const reviewerCount = reviewerRows(pr).length;
  return (
    <aside aria-label="Reviewers and details" className="pr-summary-facts flex flex-col gap-7">
      <RailGroup
        title="Reviewers"
        meta={reviewerCount > 0 ? <CountBadge size="sm">{reviewerCount}</CountBadge> : null}
      >
        <Reviewers pr={pr} />
      </RailGroup>
      <RailGroup title="Details">
        <Details pr={pr} commentCount={commentCount} commitCount={commitCount} />
      </RailGroup>
    </aside>
  );
}
