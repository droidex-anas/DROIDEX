import assert from 'node:assert/strict';
import test from 'node:test';

import type { InboxPullRequest } from './prInbox';
import {
  applyQuickFilter,
  groupByWorkflowStatus,
  resolveQueuePosition,
  sortBoardPullRequests,
} from './prBoard';

function pr(
  partial: Partial<InboxPullRequest> & Pick<InboxPullRequest, 'number' | 'title'>,
): InboxPullRequest {
  return {
    cwd: '/repos/app',
    repoName: 'app',
    state: 'open',
    url: '',
    isDraft: false,
    headRefName: 'feat',
    baseRefName: 'main',
    mergeable: 'mergeable',
    reviewDecision: null,
    additions: 10,
    deletions: 2,
    changedFiles: 1,
    createdAt: '2026-11-20T00:00:00Z',
    updatedAt: '2026-11-20T00:00:00Z',
    author: 'alice',
    reviewRequests: [],
    reviews: [],
    checks: null,
    ...partial,
  };
}

test('applyQuickFilter filters by review request, checks, draft, and conflicts', () => {
  const items = [
    pr({ number: 1, title: 'Review me', reviewRequests: ['ana'], checks: 'pass' }),
    pr({ number: 2, title: 'Broken build', checks: 'fail', mergeable: 'conflicting' }),
    pr({ number: 3, title: 'Running', checks: 'pending' }),
    pr({ number: 4, title: 'WIP', isDraft: true }),
  ];
  assert.deepEqual(
    applyQuickFilter(items, 'needs-review', 'ana').map((item) => item.number),
    [1],
  );
  assert.deepEqual(
    applyQuickFilter(items, 'passing', 'ana').map((item) => item.number),
    [1],
  );
  assert.deepEqual(
    applyQuickFilter(items, 'failing', 'ana').map((item) => item.number),
    [2],
  );
  assert.deepEqual(
    applyQuickFilter(items, 'pending', 'ana').map((item) => item.number),
    [3],
  );
  assert.deepEqual(
    applyQuickFilter(items, 'draft', 'ana').map((item) => item.number),
    [4],
  );
  assert.deepEqual(
    applyQuickFilter(items, 'conflicts', 'ana').map((item) => item.number),
    [2],
  );
});

test('sortBoardPullRequests sorts by recency or total diff size', () => {
  const olderBig = pr({
    number: 1,
    title: 'Big',
    additions: 200,
    deletions: 100,
    updatedAt: '2026-11-10T00:00:00Z',
  });
  const newerSmall = pr({
    number: 2,
    title: 'Small',
    additions: 5,
    deletions: 1,
    updatedAt: '2026-11-25T00:00:00Z',
  });
  assert.deepEqual(
    sortBoardPullRequests([olderBig, newerSmall], 'updated', 'ana').map((item) => item.number),
    [2, 1],
  );
  assert.deepEqual(
    sortBoardPullRequests([newerSmall, olderBig], 'changes', 'ana').map((item) => item.number),
    [1, 2],
  );
});

test('groupByWorkflowStatus orders actionable tiers before open and draft, and keeps backlog flat', () => {
  const items = [
    pr({ number: 1, title: 'Draft PR', isDraft: true }),
    pr({ number: 2, title: 'Open PR' }),
    pr({ number: 3, title: 'Approved PR', author: 'ana', reviewDecision: 'approved' }),
    pr({ number: 4, title: 'Failing mine', author: 'ana', checks: 'fail' }),
    pr({ number: 5, title: 'Review requested', reviewRequests: ['ana'] }),
  ];
  const groups = groupByWorkflowStatus(items, 'ana');
  assert.deepEqual(
    groups.map((group) => [group.id, group.prs.map((item) => item.number)]),
    [
      ['needs-review', [5]],
      ['needs-attention', [4]],
      ['ready', [3]],
      ['open', [2]],
      ['draft', [1]],
    ],
  );
  assert.deepEqual(
    groupByWorkflowStatus(items, 'ana', true).map((group) => group.id),
    ['backlog'],
  );
});

test('resolveQueuePosition returns neighbors for stepping through the visible queue', () => {
  const items = [
    pr({ number: 10, title: 'First' }),
    pr({ number: 20, title: 'Second' }),
    pr({ number: 30, title: 'Third' }),
  ];
  const middle = resolveQueuePosition(items, '/repos/app', 20);
  assert.equal(middle?.index, 1);
  assert.equal(middle?.total, 3);
  assert.equal(middle?.prev?.number, 10);
  assert.equal(middle?.next?.number, 30);
  assert.equal(resolveQueuePosition(items, '/repos/app', 10)?.prev, null);
  assert.equal(resolveQueuePosition(items, '/repos/app', 30)?.next, null);
  assert.equal(resolveQueuePosition(items, '/repos/other', 20), null);
});
