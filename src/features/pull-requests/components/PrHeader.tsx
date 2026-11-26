import {
  ArrowRight,
  GitBranch,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  GitPullRequestMerged,
  type IconComponent,
} from '@droidex/icons';

import { Badge } from '../../../components/ui/Badge';
import {
  prKind,
  prKindLabel,
  reviewDecisionBadge,
  type PrKind,
  type PrTone,
} from '../../../lib/github';
import type { PullRequest } from '../../../types/vcs';
import { displayLogin } from '../lib/prIdentity';
import { prAbsoluteTime, prRelativeTime } from '../lib/prTime';
import { GithubAvatar } from './GithubAvatar';

const STATE_BADGE: Record<PrKind, { tone: PrTone; icon: IconComponent }> = {
  open: { tone: 'success', icon: GitPullRequest },
  draft: { tone: 'neutral', icon: GitPullRequestDraft },
  merged: { tone: 'accent', icon: GitPullRequestMerged },
  closed: { tone: 'danger', icon: GitPullRequestClosed },
};

// `owner/repo` as GitHub spells it, read from the pull request's own URL.
function repositoryName(url: string | undefined): string | null {
  const match = /^https?:\/\/[^/]+\/([^/]+\/[^/]+)\/pull\//.exec(url ?? '');
  return match ? match[1] : null;
}

function Byline({ pr }: { pr: PullRequest }) {
  const updated = prRelativeTime(pr.updatedAt ?? pr.createdAt);
  return (
    <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 text-body text-secondary">
      <span className="flex shrink-0 items-center gap-1.5">
        <GithubAvatar login={pr.author} size={20} />
        <span className="text-primary">{displayLogin(pr.author)}</span>
        {updated ? (
          <span title={prAbsoluteTime(pr.updatedAt ?? pr.createdAt)} className="text-muted">
            {/* `prRelativeTime` returns either "now" or an age like "3d",
                and only an age reads as "ago". */}
            {updated === 'now' ? 'updated now' : `updated ${updated} ago`}
          </span>
        ) : null}
      </span>
      <span className="flex min-w-0 items-center gap-1.5">
        <GitBranch className="size-icon-sm shrink-0 text-muted" aria-hidden="true" />
        <span title={pr.headRefName ?? undefined} className="truncate text-primary">
          {pr.headRefName ?? 'unknown'}
        </span>
        <ArrowRight className="size-icon-sm shrink-0 text-muted" aria-label="into" />
        <span title={pr.baseRefName ?? undefined} className="truncate">
          {pr.baseRefName ?? 'unknown'}
        </span>
      </span>
    </div>
  );
}

// The pull request's identity: state and repository, the title, then who
// opened it and where it goes. Status details live in the summary rail.
export function PrHeader({
  pr,
  number,
  compact = false,
}: {
  pr: PullRequest | null;
  number: number;
  // The utility pane reads as a sheet, so its title steps down a scale.
  compact?: boolean;
}) {
  const kind = pr ? prKind(pr) : null;
  const decision = reviewDecisionBadge(pr);
  const repository = repositoryName(pr?.url);

  return (
    <header>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {kind ? (
          <Badge tone={STATE_BADGE[kind].tone} icon={STATE_BADGE[kind].icon}>
            {prKindLabel(kind)}
          </Badge>
        ) : (
          <span className="inline-flex h-5 w-16 rounded-full bg-elevated" />
        )}
        {/* Until the pull request loads, the title already names its number. */}
        {pr ? (
          <span className="min-w-0 truncate text-body text-muted tabular-nums">
            {repository ? `${repository} ` : ''}#{number}
          </span>
        ) : null}
        {decision ? <Badge tone={decision.tone}>{decision.label}</Badge> : null}
      </div>
      <h1 className={`mt-3 text-balance text-primary ${compact ? 'text-heading' : 'text-title'}`}>
        {pr ? pr.title : `Pull request #${String(number)}`}
      </h1>
      {pr ? <Byline pr={pr} /> : null}
    </header>
  );
}
