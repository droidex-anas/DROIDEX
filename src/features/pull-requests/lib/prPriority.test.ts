import assert from 'node:assert/strict';
import test from 'node:test';

import type { InboxPullRequest } from './prInbox';
import { prPriorityTier, sortInboxPullRequests } from './prPriority';

function pr(overrides: Partial<InboxPullRequest>): InboxPullRequest {
  return {
    id: 'o/r#1',
    number: 1,
    title: 'Pull request',
    url: 'https://github.com/o/r/pull/1',
    author: 'someone',
    repoOwner: 'o',
    repoName: 'r',
    headRefName: 'branch',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    isDraft: false,
    reviewRequests: [],
    reviews: [],
    labels: [],
    ...overrides,
  };
}

test('a request the viewer has not answered outranks everything else', () => {
  const requested = pr({ number: 1, reviewRequests: ['viewer'] });
  const authoredFailing = pr({ number: 2, author: 'viewer', reviewDecision: 'changes_requested' });
  const authoredReady = pr({ number: 3, author: 'viewer', reviewDecision: 'approved' });
  const plain = pr({ number: 4 });
  assert.equal(prPriorityTier(requested, 'viewer'), 'review-requested');
  assert.equal(prPriorityTier(authoredFailing, 'viewer'), 'changes-requested');
  assert.equal(prPriorityTier(authoredReady, 'viewer'), 'ready');
  assert.equal(prPriorityTier(plain, 'viewer'), 'default');
  const sorted = sortInboxPullRequests(
    [plain, authoredReady, requested, authoredFailing],
    'viewer',
  );
  assert.deepEqual(
    sorted.map((item) => item.number),
    [1, 2, 3, 4],
  );
});

test('a review the viewer already gave is no longer waiting on them', () => {
  const done = pr({
    reviewRequests: ['viewer'],
    reviews: [{ author: 'viewer', state: 'APPROVED', submittedAt: null }],
  });
  assert.equal(prPriorityTier(done, 'viewer'), 'default');
});

test('drafts sink inside their tier and recency breaks ties', () => {
  const older = pr({ number: 1, updatedAt: '2024-01-01T00:00:00Z' });
  const newer = pr({ number: 2, updatedAt: '2024-02-01T00:00:00Z' });
  const draft = pr({ number: 3, isDraft: true, updatedAt: '2024-03-01T00:00:00Z' });
  const sorted = sortInboxPullRequests([older, draft, newer], null);
  assert.deepEqual(
    sorted.map((item) => item.number),
    [2, 1, 3],
  );
});

test('login matching folds case, and without a viewer nothing is prioritized', () => {
  const requested = pr({ reviewRequests: ['Viewer'] });
  assert.equal(prPriorityTier(requested, 'viewer'), 'review-requested');
  assert.equal(prPriorityTier(requested, null), 'default');
});
