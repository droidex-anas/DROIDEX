import assert from 'node:assert/strict';
import test from 'node:test';
import { initialPrListState, mergePullRequestLists, reducePrList } from './prListState';
import type { InboxPullRequest } from './prInbox';
import type { PullRequestListResult } from '../../../types/vcs';

const sample: InboxPullRequest = {
  number: 1,
  title: 'A',
  state: 'open',
  url: 'https://github.com/acme/app/pull/1',
  isDraft: false,
  headRefName: 'f',
  baseRefName: 'main',
  mergeable: null,
  reviewDecision: null,
  additions: 1,
  deletions: 0,
  changedFiles: 1,
  createdAt: null,
  updatedAt: null,
  author: 'ana',
  reviewRequests: [],
  reviews: [],
  cwd: '/repo',
  repoName: 'repo',
};

function listResult(overrides: Partial<PullRequestListResult> = {}): PullRequestListResult {
  return {
    ok: true,
    viewerLogin: 'ana',
    prs: [],
    ...overrides,
  };
}

test('bind increments generation and drops rows', () => {
  const loaded = reducePrList(initialPrListState, {
    type: 'load-success',
    generation: 0,
    prs: [sample],
    viewerLogin: 'ana',
    repoErrors: [],
    error: null,
  });
  const bound = reducePrList(loaded, { type: 'bind' });
  assert.equal(bound.prs.length, 0);
  assert.equal(bound.generation, 1);
  assert.equal(bound.loaded, false);
});

test('a stale result is ignored and the current result ends loading', () => {
  const start = reducePrList(initialPrListState, { type: 'load-start', generation: 1 });
  const stale = reducePrList(start, {
    type: 'load-success',
    generation: 0,
    prs: [sample],
    viewerLogin: 'ana',
    repoErrors: [],
    error: null,
  });
  assert.equal(stale, start);
  const ok = reducePrList(start, {
    type: 'load-success',
    generation: 1,
    prs: [sample],
    viewerLogin: 'ana',
    repoErrors: [],
    error: null,
  });
  assert.equal(ok.loading, false);
  assert.equal(ok.loaded, true);
  assert.deepEqual(ok.prs, [sample]);
});

test('an unresolved repository does not wipe pull requests from other workspaces', () => {
  const merged = mergePullRequestLists([
    {
      cwd: '/repos/app',
      result: listResult({
        prs: [{ ...sample, number: 8, title: 'Ship', url: 'https://github.com/acme/app/pull/8' }],
      }),
    },
    {
      cwd: '/repos/clinic',
      result: listResult({
        ok: false,
        reason: 'unresolved_repository',
        message: 'GitHub could not find evilfps/dr-koshley-skin-clinic.',
        viewerLogin: null,
        prs: [],
      }),
    },
  ]);
  assert.deepEqual(
    merged.prs.map((item) => [item.repoName, item.number]),
    [['app', 8]],
  );
  assert.equal(merged.error, null);
  assert.equal(merged.repoErrors.length, 1);
  assert.equal(merged.repoErrors[0].repoName, 'clinic');
  assert.match(merged.repoErrors[0].message, /dr-koshley-skin-clinic/);
});

test('a global GitHub CLI failure stays a full inbox error when nothing loaded', () => {
  const merged = mergePullRequestLists([
    {
      cwd: '/repos/app',
      result: listResult({
        ok: false,
        reason: 'gh_unavailable',
        message: 'GitHub CLI was not found.',
        viewerLogin: null,
      }),
    },
  ]);
  assert.equal(merged.prs.length, 0);
  assert.equal(merged.error, 'GitHub CLI was not found.');
  assert.equal(merged.repoErrors.length, 0);
});
