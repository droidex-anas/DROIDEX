import test from 'node:test';
import assert from 'node:assert/strict';

import { sessionAttention } from './sessionAttention';
import type { PermissionRequest, SessionQuestion } from '../types/bridge';

function makePermission(appSessionId: string): PermissionRequest {
  return {
    appSessionId,
    requestId: `req-${appSessionId}`,
    kind: 'exec',
    title: 'Run command',
    detail: 'ls',
    canAlwaysAllow: true,
    raw: {},
  };
}

function makeQuestion(appSessionId: string): SessionQuestion {
  return {
    appSessionId,
    requestId: `req-${appSessionId}`,
    questions: [{ index: 0, question: 'Pick one', options: [{ label: 'a' }, { label: 'b' }] }],
  };
}

test('sessionAttention reports the session own approval first, then its question', () => {
  const permissions = { 'app-1': [makePermission('app-1')] };
  const questions = { 'app-1': [makeQuestion('app-1')] };
  assert.equal(sessionAttention('app-1', permissions, {}), 'approval');
  assert.equal(sessionAttention('app-1', {}, questions), 'question');
  // Approval wins when both are pending.
  assert.equal(sessionAttention('app-1', permissions, questions), 'approval');
  // A pending request from another session does not leak over.
  assert.equal(sessionAttention('app-2', permissions, questions), null);
});
