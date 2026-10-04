import assert from 'node:assert/strict';
import test from 'node:test';

import type { PrCheck, PrComment } from '../../../types/vcs';
import { initialPrDetailState } from '../lib/prDetailState';
import { prActionError, prevForSettledMeta, resolveMeta } from './usePullRequestDetail';

const failedView = { ok: false as const, message: 'view down', pr: null };
const failedChecks = { ok: false as const, message: 'checks down', checks: [] };
const failedComments = { ok: false as const, message: 'comments down', comments: [] };

const sampleCheck: PrCheck = {
  name: 'ci',
  workflow: null,
  bucket: 'pass',
  state: 'SUCCESS',
  description: '',
  link: null,
  startedAt: null,
  completedAt: null,
};

const sampleComment: PrComment = {
  id: 'c1',
  kind: 'comment',
  author: 'ana',
  body: 'Looks good',
  createdAt: null,
  url: null,
  state: null,
  reactions: [],
};

const loadedState = {
  ...initialPrDetailState,
  loaded: true,
  body: 'Hi',
  checks: [sampleCheck],
  comments: [sampleComment],
  checksError: null,
  commentsError: null,
  metaError: null,
};

test('all-fail first load writes per-section errors instead of a total meta-failure', () => {
  const resolved = resolveMeta(
    1,
    { view: failedView, checks: failedChecks, comments: failedComments },
    initialPrDetailState,
    true,
  );
  assert.equal(resolved.pr, null);
  assert.equal(resolved.event.body, '');
  assert.deepEqual(resolved.event.checks, []);
  assert.deepEqual(resolved.event.comments, []);
  assert.equal(resolved.event.metaError, 'view down');
  assert.equal(resolved.event.checksError, 'checks down');
  assert.equal(resolved.event.commentsError, 'comments down');
});

test('empty failure messages use visible fallbacks', () => {
  const failed = resolveMeta(
    1,
    {
      view: { ...failedView, message: '' },
      checks: { ...failedChecks, message: '' },
      comments: { ...failedComments, message: '' },
    },
    initialPrDetailState,
    true,
  );
  assert.equal(failed.event.metaError, 'Could not load pull request');
  assert.equal(failed.event.checksError, 'Could not load PR checks');
  assert.equal(failed.event.commentsError, 'Could not load PR comments');

  const partial = resolveMeta(
    1,
    {
      view: failedView,
      checks: failedChecks,
      comments: { ok: true, partial: true, message: '', comments: [sampleComment] },
    },
    initialPrDetailState,
    true,
  );
  assert.equal(partial.event.commentsError, 'Some PR comments could not be loaded');

  assert.equal(
    prActionError('', 'Could not load pull request diff'),
    'Could not load pull request diff',
  );
  assert.equal(prActionError(undefined, 'Could not post comment'), 'Could not post comment');
  assert.equal(prActionError('merge refused', 'Could not merge pull request'), 'merge refused');
});

test('all-fail refresh keeps last good rows and surfaces section errors', () => {
  const resolved = resolveMeta(
    2,
    { view: failedView, checks: failedChecks, comments: failedComments },
    loadedState,
    true,
  );
  assert.equal(resolved.event.body, 'Hi');
  assert.equal(resolved.event.checks, loadedState.checks);
  assert.equal(resolved.event.comments, loadedState.comments);
  assert.equal(resolved.event.metaError, 'view down');
  assert.equal(resolved.event.checksError, 'checks down');
  assert.equal(resolved.event.commentsError, 'comments down');
});

test('settled meta from /repo#1 is not kept as the base for /repo#2', () => {
  const liveFromOne = { ...loadedState, cwd: '/repo', number: 1 };
  assert.equal(prevForSettledMeta(liveFromOne, '/repo', 2), initialPrDetailState);
  assert.equal(prevForSettledMeta(liveFromOne, '/repo', 1), liveFromOne);
});

test('poll all-fail after success keeps last good rows and previous errors', () => {
  const resolved = resolveMeta(
    3,
    { view: failedView, checks: failedChecks, comments: failedComments },
    loadedState,
    false,
  );
  assert.equal(resolved.event.body, 'Hi');
  assert.equal(resolved.event.checks, loadedState.checks);
  assert.equal(resolved.event.comments, loadedState.comments);
  assert.equal(resolved.event.metaError, null);
  assert.equal(resolved.event.checksError, null);
  assert.equal(resolved.event.commentsError, null);
});
