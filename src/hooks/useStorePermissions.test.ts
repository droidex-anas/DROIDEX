import test from 'node:test';
import assert from 'node:assert/strict';

import { adaptEvent, initialState, reducer } from './useStore';
import type { PermissionRequest, SessionQuestion } from '../types/bridge';

function makePermission(appSessionId: string, kind: PermissionRequest['kind'] = 'exec') {
  const request: PermissionRequest = {
    appSessionId,
    requestId: `req-${appSessionId}`,
    kind,
    title: 'Run command',
    detail: 'rm -rf build',
    canAlwaysAllow: true,
    raw: {},
  };
  const action = adaptEvent({ type: 'approval.requested', request });
  assert.ok(action);
  return action;
}

function makeQuestion(appSessionId: string) {
  const question: SessionQuestion = {
    appSessionId,
    requestId: `req-${appSessionId}`,
    questions: [{ index: 0, question: 'Pick one', options: [{ label: 'a' }, { label: 'b' }] }],
  };
  const action = adaptEvent({ type: 'question.requested', question });
  assert.ok(action);
  return action;
}

test('permission requests stay scoped to the session that asked', () => {
  const withFirst = reducer(initialState, makePermission('app-1'));
  const withBoth = reducer(withFirst, makePermission('app-2'));

  assert.equal(withBoth.pendingPermissions['app-1']?.[0]?.requestId, 'req-app-1');
  assert.equal(withBoth.pendingPermissions['app-2']?.[0]?.requestId, 'req-app-2');
});

test('answering a permission clears only that sessions request', () => {
  const withBoth = reducer(reducer(initialState, makePermission('app-1')), makePermission('app-2'));
  const next = reducer(withBoth, {
    type: 'CLEAR_PERMISSION',
    appSessionId: 'app-1',
    requestId: 'req-app-1',
  });

  assert.equal(next.pendingPermissions['app-1'], undefined);
  assert.equal(next.pendingPermissions['app-2']?.[0]?.requestId, 'req-app-2');
});

test('clearing a permission that is not pending leaves other sessions intact', () => {
  const withOne = reducer(initialState, makePermission('app-1'));
  const next = reducer(withOne, {
    type: 'CLEAR_PERMISSION',
    appSessionId: 'app-2',
    requestId: 'req-app-2',
  });
  assert.equal(next.pendingPermissions['app-1']?.[0]?.requestId, 'req-app-1');
});

test('two permissions settle by request id and reveal the oldest unanswered request', () => {
  const withOne = reducer(initialState, makePermission('app-1'));
  const replacement = adaptEvent({
    type: 'approval.requested' as const,
    request: {
      appSessionId: 'app-1',
      requestId: 'req-app-1-second',
      kind: 'edit' as const,
      title: 'Edit file',
      detail: 'src/app.ts',
      canAlwaysAllow: true,
      raw: {},
    },
  });
  assert.ok(replacement);
  const next = reducer(withOne, replacement);
  assert.deepEqual(
    next.pendingPermissions['app-1'].map((request) => request.requestId),
    ['req-app-1', 'req-app-1-second'],
  );
  const firstSettled = reducer(next, {
    type: 'CLEAR_PERMISSION',
    appSessionId: 'app-1',
    requestId: 'req-app-1',
  });
  assert.equal(firstSettled.pendingPermissions['app-1']?.[0]?.requestId, 'req-app-1-second');
  assert.equal(
    reducer(firstSettled, {
      type: 'CLEAR_PERMISSION',
      appSessionId: 'app-1',
      requestId: 'req-app-1',
    }).pendingPermissions,
    firstSettled.pendingPermissions,
  );
  const secondSettled = reducer(firstSettled, {
    type: 'CLEAR_PERMISSION',
    appSessionId: 'app-1',
    requestId: 'req-app-1-second',
  });
  assert.equal(secondSettled.pendingPermissions['app-1'], undefined);
});

test('questions stay scoped to the session that asked', () => {
  const withFirst = reducer(initialState, makeQuestion('app-1'));
  const withBoth = reducer(withFirst, makeQuestion('app-2'));

  assert.equal(withBoth.pendingQuestions['app-1']?.[0]?.requestId, 'req-app-1');
  assert.equal(withBoth.pendingQuestions['app-2']?.[0]?.requestId, 'req-app-2');

  const answered = reducer(withBoth, {
    type: 'CLEAR_QUESTION',
    appSessionId: 'app-2',
    requestId: 'req-app-2',
  });
  assert.equal(answered.pendingQuestions['app-2'], undefined);
  assert.equal(answered.pendingQuestions['app-1']?.[0]?.requestId, 'req-app-1');
});

test('closing a session drops its pending permission and question', () => {
  const withPermission = reducer(initialState, makePermission('app-1'));
  const withBoth = reducer(withPermission, makeQuestion('app-1'));
  const next = reducer(withBoth, { type: 'SESSION_CLOSED', appSessionId: 'app-1' });

  assert.equal(next.pendingPermissions['app-1'], undefined);
  assert.equal(next.pendingQuestions['app-1'], undefined);
});

test('a spec permission still seeds the session spec while pending', () => {
  const action = adaptEvent({
    type: 'approval.requested' as const,
    request: {
      appSessionId: 'app-1',
      requestId: 'req-spec',
      kind: 'spec' as const,
      title: 'Plan ready for review',
      detail: '# Plan',
      plan: '# Plan',
      canAlwaysAllow: true,
      raw: {},
    },
  });
  assert.ok(action);
  const next = reducer(initialState, action);

  assert.equal(next.pendingPermissions['app-1']?.[0]?.kind, 'spec');
  assert.equal(next.sessionSpecs['app-1']?.content, '# Plan');
  assert.equal(next.specPlans['app-1'], '# Plan');
});

test('queued questions survive out-of-order cancellation and duplicate delivery', () => {
  const first = makeQuestion('app-1');
  assert.equal(first.type, 'SESSION_QUESTION');
  if (first.type !== 'SESSION_QUESTION') throw new Error('Expected a question');
  const second = { ...first, question: { ...first.question, requestId: 'second' } };
  const pending = reducer(reducer(initialState, first), second);
  assert.equal(reducer(pending, first), pending);
  const cancelled = reducer(pending, {
    type: 'CLEAR_INTERACTION',
    appSessionId: 'app-1',
    requestId: 'second',
  });
  assert.deepEqual(
    cancelled.pendingQuestions['app-1'].map((question) => question.requestId),
    ['req-app-1'],
  );
  const settled = reducer(cancelled, {
    type: 'CLEAR_QUESTION',
    appSessionId: 'app-1',
    requestId: 'req-app-1',
  });
  assert.equal(settled.pendingQuestions['app-1'], undefined);
});
