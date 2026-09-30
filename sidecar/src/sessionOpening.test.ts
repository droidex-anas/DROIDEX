import assert from 'node:assert/strict';
import test from 'node:test';

import type { SessionInitResult } from './DroidRuntime.js';
import type { SessionSummary } from './protocol.js';
import { buildResumedSession } from './sessionOpening.js';

function storedChat(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    appSessionId: 'chat-app',
    providerSessionId: 'chat-provider',
    provider: 'droid',
    sessionPurpose: 'chat',
    interactionMode: 'auto',
    role: 'primary',
    title: 'Chat',
    goal: '',
    cwd: '/workspace',
    workspaceKind: 'folder',
    autonomy: 'low',
    phase: 'paused',
    features: [],
    tokensIn: 0,
    tokensOut: 0,
    contextTokens: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function resume(init: SessionInitResult, historical?: SessionSummary) {
  return buildResumedSession({
    init,
    historical,
    appSessionId: historical?.appSessionId ?? 'child-provider',
    providerSessionId: historical?.providerSessionId ?? 'child-provider',
    defaults: {},
    maxContextTokensForModel: () => undefined,
    now: 999_999,
  }).summary;
}

test('cold resume preserves a persisted Mission Control proposal', () => {
  const historical = storedChat({
    missionId: 'mission-id',
    sessionPurpose: 'mission-control',
    interactionMode: 'agi',
    proposal: '# Persisted plan',
  });

  assert.equal(
    resume({ settings: { interactionMode: 'agi' } }, historical).proposal,
    '# Persisted plan',
  );
});

test('resume keeps the historical updatedAt so reading never reorders the sidebar', () => {
  // Opening an old session resumes it in the background; that resume must not
  // stamp "now" into updatedAt or the session would jump to the top of the
  // list and read as unread in other windows.
  const resumed = resume({ settings: {} }, storedChat({ createdAt: 100, updatedAt: 200 }));

  assert.equal(resumed.updatedAt, 200);
  assert.equal(resumed.createdAt, 100);
});

test('resume keeps an app-reanchored cwd instead of restoring stale provider metadata', () => {
  const resumed = resume(
    { cwd: '/repo/.worktrees/deleted', session: { cwd: '/repo/.worktrees/deleted' } },
    storedChat({ cwd: '/repo' }),
  );

  assert.equal(resumed.cwd, '/repo');
});

test('a child provider cannot be resumed as a top-level session', () => {
  assert.throws(
    () => resume({ session: { decompSessionType: 'worker' } }),
    /cannot be resumed as top-level/i,
  );
});
