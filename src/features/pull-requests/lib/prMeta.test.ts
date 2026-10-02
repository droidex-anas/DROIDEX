import assert from 'node:assert/strict';
import test from 'node:test';

import type { PrCheck, PullRequest } from '../../../types/vcs';
import { checksBadge, checksSummary } from '../../../lib/github';
import { mergeBlockReason, reviewerRows } from './prMeta';

const pr = (overrides: Partial<PullRequest> = {}): PullRequest => ({
  number: 7,
  title: 'Ship it',
  state: 'open',
  url: 'https://github.com/o/r/pull/7',
  isDraft: false,
  headRefName: 'feature',
  baseRefName: 'main',
  mergeable: 'mergeable',
  reviewDecision: null,
  additions: 1,
  deletions: 0,
  changedFiles: 1,
  createdAt: null,
  updatedAt: null,
  author: 'ana',
  reviewRequests: [],
  reviews: [],
  ...overrides,
});

const check = (bucket: string): PrCheck => ({
  name: bucket,
  workflow: null,
  bucket,
  state: '',
  description: '',
  link: null,
  startedAt: null,
  completedAt: null,
});

test('a mergeable pull request is not blocked', () => {
  assert.equal(mergeBlockReason(pr()), null);
});

test('drafts and conflicting branches block the merge with a reason', () => {
  assert.match(mergeBlockReason(pr({ isDraft: true })) ?? '', /ready for review/);
  assert.match(mergeBlockReason(pr({ mergeable: 'conflicting' })) ?? '', /conflicts/);
});

// Branch protection is invisible to `gh pr view`, so a requested-changes review
// or an unknown mergeability must not disable the button locally; gh reports
// GitHub's own refusal instead.
test('review state and unknown mergeability leave the merge to gh', () => {
  assert.equal(mergeBlockReason(pr({ reviewDecision: 'changes_requested' })), null);
  assert.equal(mergeBlockReason(pr({ mergeable: null })), null);
});

test('check badges are green only when every check passed', () => {
  const cases: [string[], ReturnType<typeof checksBadge>][] = [
    [['pass', 'pass', 'pass'], { label: '3/3 passed', tone: 'success' }],
    [['skipping', 'skipping', 'skipping'], { label: '3 skipped', tone: 'neutral' }],
    [['pass', 'skipping', 'skipping'], { label: '1/3 passed', tone: 'neutral' }],
    [['neutral', 'neutral'], { label: '2 neutral', tone: 'neutral' }],
    [['mystery'], { label: '1 unknown', tone: 'neutral' }],
    [[], null],
  ];
  for (const [buckets, badge] of cases) {
    assert.deepEqual(checksBadge(checksSummary(buckets.map(check))), badge, buckets.join(','));
  }
});

test('pending reviews stay pending and current requests override old reviews', () => {
  assert.deepEqual(
    reviewerRows(
      pr({
        reviews: [
          { author: 'ana', state: 'pending' },
          { author: 'rae', state: 'approved' },
        ],
        reviewRequests: ['rae'],
      }),
    ),
    [
      { login: 'ana', state: 'pending' },
      { login: 'rae', state: 'pending' },
    ],
  );
});
