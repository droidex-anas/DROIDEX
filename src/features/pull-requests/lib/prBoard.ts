import { comparablePath } from '../../../lib/pathComparison';
import { prKind } from '../../../lib/github';
import { hasMergeConflicts } from './prMeta';
import type { InboxPullRequest, PrInboxTab } from './prInbox';
import { prPriorityTier, sortInboxPullRequests } from './prPriority';

export type PrQuickFilter =
  | 'all'
  | 'needs-review'
  | 'passing'
  | 'failing'
  | 'pending'
  | 'draft'
  | 'conflicts';

export type PrSortOrder = 'priority' | 'updated' | 'changes';

export interface PrBoardState {
  tab: PrInboxTab;
  query: string;
  quickFilter: PrQuickFilter;
  sort: PrSortOrder;
  repoScope: string | null;
}

export const INITIAL_PR_BOARD_STATE: PrBoardState = {
  tab: 'all',
  query: '',
  quickFilter: 'all',
  sort: 'priority',
  repoScope: null,
};

export interface PrStatusGroup {
  id: 'needs-review' | 'needs-attention' | 'ready' | 'open' | 'draft' | 'backlog';
  label: string;
  dotClass: string;
  prs: InboxPullRequest[];
}

export const PR_QUICK_FILTERS: { id: PrQuickFilter; label: string }[] = [
  { id: 'all', label: 'All statuses' },
  { id: 'needs-review', label: 'Needs your review' },
  { id: 'passing', label: 'Passing checks' },
  { id: 'failing', label: 'Failing checks' },
  { id: 'pending', label: 'Running checks' },
  { id: 'draft', label: 'Drafts' },
  { id: 'conflicts', label: 'Merge conflicts' },
];

export const PR_SORT_OPTIONS: { id: PrSortOrder; label: string }[] = [
  { id: 'priority', label: 'Priority' },
  { id: 'updated', label: 'Recently updated' },
  { id: 'changes', label: 'Largest diff' },
];

export function applyQuickFilter(
  prs: InboxPullRequest[],
  filter: PrQuickFilter,
  viewerLogin: string | null,
): InboxPullRequest[] {
  switch (filter) {
    case 'all':
      return prs;
    case 'needs-review':
      return prs.filter((pr) => prPriorityTier(pr, viewerLogin) === 'review-requested');
    case 'passing':
      return prs.filter((pr) => pr.checks === 'pass');
    case 'failing':
      return prs.filter((pr) => pr.checks === 'fail');
    case 'pending':
      return prs.filter((pr) => pr.checks === 'pending');
    case 'draft':
      return prs.filter((pr) => prKind(pr) === 'draft');
    case 'conflicts':
      return prs.filter((pr) => hasMergeConflicts(pr));
  }
}

function timestamp(value: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function sortBoardPullRequests(
  prs: InboxPullRequest[],
  sort: PrSortOrder,
  viewerLogin: string | null,
): InboxPullRequest[] {
  if (sort === 'priority') return sortInboxPullRequests(prs, viewerLogin);
  if (sort === 'updated') {
    return [...prs].sort(
      (left, right) =>
        timestamp(right.updatedAt ?? right.createdAt) - timestamp(left.updatedAt ?? left.createdAt),
    );
  }
  return [...prs].sort(
    (left, right) => right.additions + right.deletions - (left.additions + left.deletions),
  );
}

const GROUP_META: Record<PrStatusGroup['id'], { label: string; dotClass: string }> = {
  'needs-review': { label: 'Needs review', dotClass: 'bg-warning' },
  'needs-attention': { label: 'Needs attention', dotClass: 'bg-danger' },
  ready: { label: 'Ready to merge', dotClass: 'bg-success' },
  open: { label: 'Open', dotClass: 'bg-success' },
  draft: { label: 'Draft', dotClass: 'bg-muted' },
  backlog: { label: 'Backlog', dotClass: 'bg-muted' },
};

const GROUP_ORDER: PrStatusGroup['id'][] = [
  'needs-review',
  'needs-attention',
  'ready',
  'open',
  'draft',
];

function statusGroupFor(pr: InboxPullRequest, viewerLogin: string | null): PrStatusGroup['id'] {
  if (prKind(pr) === 'draft') return 'draft';
  const tier = prPriorityTier(pr, viewerLogin);
  if (tier === 'review-requested') return 'needs-review';
  if (tier === 'changes-requested') return 'needs-attention';
  if (tier === 'ready') return 'ready';
  return 'open';
}

export function groupByWorkflowStatus(
  prs: InboxPullRequest[],
  viewerLogin: string | null,
  isBacklog = false,
): PrStatusGroup[] {
  if (prs.length === 0) return [];
  if (isBacklog) {
    return [{ id: 'backlog', ...GROUP_META.backlog, prs }];
  }
  const buckets = new Map<PrStatusGroup['id'], InboxPullRequest[]>();
  for (const pr of prs) {
    const id = statusGroupFor(pr, viewerLogin);
    const list = buckets.get(id);
    if (list) list.push(pr);
    else buckets.set(id, [pr]);
  }
  const groups: PrStatusGroup[] = [];
  for (const id of GROUP_ORDER) {
    const items = buckets.get(id);
    if (items && items.length > 0) {
      groups.push({ id, ...GROUP_META[id], prs: items });
    }
  }
  return groups;
}

export interface PrQueuePosition {
  index: number;
  total: number;
  prev: InboxPullRequest | null;
  next: InboxPullRequest | null;
}

export function prRowKey(pr: Pick<InboxPullRequest, 'cwd' | 'number'>): string {
  return `${comparablePath(pr.cwd)}:${String(pr.number)}`;
}

export function stepFocusedPrKey(
  items: readonly InboxPullRequest[],
  focusedKey: string | null,
  delta: 1 | -1,
): string | null {
  if (items.length === 0) return null;
  const index = items.findIndex((item) => prRowKey(item) === focusedKey);
  if (delta === 1) return prRowKey(items[(index + 1) % items.length]);
  const prevIndex = index <= 0 ? items.length - 1 : index - 1;
  return prRowKey(items[prevIndex]);
}

export function resolveQueuePosition(
  prs: readonly InboxPullRequest[],
  cwd: string | null,
  number: number | null,
): PrQueuePosition | null {
  if (!cwd || number == null || prs.length === 0) return null;
  const bound = comparablePath(cwd);
  const index = prs.findIndex(
    (item) => item.number === number && comparablePath(item.cwd) === bound,
  );
  if (index === -1) return null;
  return {
    index,
    total: prs.length,
    prev: index > 0 ? (prs[index - 1] ?? null) : null,
    next: index < prs.length - 1 ? (prs[index + 1] ?? null) : null,
  };
}
