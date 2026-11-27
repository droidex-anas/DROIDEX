import { prKind } from '../../../lib/github';
import type { InboxPullRequest } from './prInbox';

// Inbox priority is the order a reviewer should work the list in: what needs
// their action first, everything else by recency inside its tier. It is a
// pure function of the pull request and the viewer, so the ordering is
// testable and identical in every repo group.
export type PrPriorityTier =
  | 'review-requested' // someone asked you to review and you have not reviewed
  | 'changes-requested' // your pull request has requested changes or failing checks
  | 'ready' // your pull request is approved and passing
  | 'default';

function sameLogin(left: string | null | undefined, right: string | null | undefined): boolean {
  if (!left || !right) return false;
  return left.toLowerCase() === right.toLowerCase();
}

export function prPriorityTier(pr: InboxPullRequest, viewerLogin: string | null): PrPriorityTier {
  if (!viewerLogin) return 'default';
  const authored = sameLogin(pr.author, viewerLogin);
  const requested = pr.reviewRequests.some((login) => sameLogin(login, viewerLogin));
  const reviewed = pr.reviews.some((review) => sameLogin(review.author, viewerLogin));
  if (!authored && requested && !reviewed) return 'review-requested';
  if (authored) {
    if (pr.reviewDecision === 'changes_requested' || pr.checks === 'fail')
      return 'changes-requested';
    if (pr.reviewDecision === 'approved') return 'ready';
  }
  return 'default';
}

const TIER_RANK: Record<PrPriorityTier, number> = {
  'review-requested': 0,
  'changes-requested': 1,
  ready: 2,
  default: 3,
};

function timestamp(value: string | null): number {
  if (!value) return 0;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

// Tier first, then the most recently updated inside the tier. Drafts sink
// within their tier: a draft is its author's work in progress, never the
// most urgent thing on someone else's desk.
function compareInboxPriority(
  left: InboxPullRequest,
  right: InboxPullRequest,
  viewerLogin: string | null,
): number {
  const tier =
    TIER_RANK[prPriorityTier(left, viewerLogin)] - TIER_RANK[prPriorityTier(right, viewerLogin)];
  if (tier !== 0) return tier;
  const draft = Number(prKind(left) === 'draft') - Number(prKind(right) === 'draft');
  if (draft !== 0) return draft;
  return (
    timestamp(right.updatedAt ?? right.createdAt) - timestamp(left.updatedAt ?? left.createdAt)
  );
}

export function sortInboxPullRequests(
  prs: InboxPullRequest[],
  viewerLogin: string | null,
): InboxPullRequest[] {
  return [...prs].sort((left, right) => compareInboxPriority(left, right, viewerLogin));
}
