import { useMemo } from 'react';
import { ExternalLink } from '@droidex/icons';

import { Button } from '../../../components/ui/Button';
import { openExternal } from '../../../lib/onboarding';
import type { PrCheck, PrComment, PrCommit, PullRequest } from '../../../types/vcs';
import { prCommentBlocks } from '../lib/prCommentBody';
import { hasMergeConflicts } from '../lib/prMeta';
import { PrBody } from './PrBody';
import { PrConversation } from './PrConversation';
import { PrHeader } from './PrHeader';
import { PrSection } from './PrSection';
import { PrRailChecks, PrRailFacts } from './PrSummaryRail';
import { PrTimeline } from './PrTimeline';

function Description({
  loaded,
  body,
  metaError,
}: {
  loaded: boolean;
  body: string;
  metaError: string | null;
}) {
  // Generated descriptions carry the same disclosures, footers, and badge links
  // as bot comments, so they go through the same renderer.
  const blocks = useMemo(() => (body ? prCommentBlocks(body) : []), [body]);
  if (!loaded && !body) return <div className="h-16 rounded-lg bg-elevated/40" />;
  if (blocks.length === 0) {
    return <p className="text-body text-muted">{metaError ?? 'No description.'}</p>;
  }
  return (
    <>
      {/* A refresh that fails after the description loaded still has to report
          the failure; the cached body must not read as a successful load. */}
      {metaError ? <p className="mb-2 text-body text-muted">{metaError}</p> : null}
      <PrBody blocks={blocks} />
    </>
  );
}

// Conflicts are resolved in a checkout or on github.com, so this states the
// fact and links out instead of offering a resolve button it cannot honor.
function MergeConflicts({ pr }: { pr: PullRequest }) {
  return (
    <div className="rounded-lg bg-danger-soft px-3 py-2.5">
      <p className="text-body text-secondary">
        <span className="text-primary">{pr.headRefName ?? 'This branch'}</span> cannot be merged
        into <span className="text-primary">{pr.baseRefName ?? 'the base branch'}</span>{' '}
        automatically. Resolve the conflicts in a checkout of the branch.
      </p>
      <Button
        variant="secondary"
        size="sm"
        className="mt-2"
        icon={ExternalLink}
        onClick={() => {
          void openExternal(pr.url);
        }}
      >
        View conflicts on GitHub
      </Button>
    </div>
  );
}

export function PrSummary({
  pr,
  number,
  body,
  loaded,
  loading,
  metaError,
  checks,
  checksError,
  comments,
  commentsError,
  commits,
  compact = false,
  draft,
  posting,
  onDraftChange,
  onSubmit,
}: {
  pr: PullRequest | null;
  number: number;
  body: string;
  loaded: boolean;
  loading: boolean;
  metaError: string | null;
  checks: PrCheck[];
  checksError: string | null;
  comments: PrComment[];
  commentsError: string | null;
  commits: PrCommit[];
  compact?: boolean;
  draft: string;
  posting: boolean;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const pending = loading && !loaded;

  return (
    <PrConversation
      compact={compact}
      draft={draft}
      posting={posting}
      onDraftChange={onDraftChange}
      onSubmit={onSubmit}
    >
      <div className="pr-summary pr-reading-width">
        <PrHeader pr={pr} number={number} compact={compact} />
        <div className="pr-summary-grid">
          <PrRailChecks checks={checks} loading={pending} error={checksError} />
          <div className="pr-summary-main min-w-0">
            {pr && hasMergeConflicts(pr) ? (
              <PrSection key="merge-conflicts" title="Merge conflicts">
                <MergeConflicts pr={pr} />
              </PrSection>
            ) : null}
            <PrSection key="description" title="Description">
              <Description loaded={loaded} body={body} metaError={metaError} />
            </PrSection>
            <PrSection key="conversation" title="Conversation" count={comments.length}>
              <PrTimeline
                pr={pr}
                comments={comments}
                commits={commits}
                loading={pending}
                error={commentsError}
              />
            </PrSection>
          </div>
          {pr ? (
            <PrRailFacts pr={pr} commentCount={comments.length} commitCount={commits.length} />
          ) : null}
        </div>
      </div>
    </PrConversation>
  );
}
