import assert from 'node:assert/strict';
import test from 'node:test';
import type { AutomationRun } from '@droidex/protocol';
import { AutomationRuns } from './automationRuns.js';
import type { AutomationStore } from './types.js';

test('queued drain backs off storage failures and resumes when writes recover', async (t) => {
  const yieldToTimer = setTimeout;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const run: AutomationRun = {
    id: 'run',
    automationId: 'automation',
    trigger: 'manual',
    scheduledAt: 0,
    requestedAt: 0,
    status: 'queued',
    startedAt: null,
    finishedAt: null,
    clientRef: null,
    appSessionId: null,
    resolvedCwd: null,
    error: null,
    effectiveModelId: null,
    effectiveReasoningEffort: null,
    selectionVerified: null,
    automation: {
      id: 'automation',
      title: 'Test',
      prompt: 'Test',
      files: [],
      target: { kind: 'new-session' },
      workspaceCwd: null,
      executionMode: 'local',
      timezone: 'UTC',
      modelId: 'model',
      reasoningEffort: 'off',
      autonomy: 'low',
    },
  };
  let store: AutomationStore = {
    version: 1,
    permissionSemanticsRevision: 1,
    automations: [],
    runs: [run],
    proposals: [],
    sessionOrigins: {},
  };
  let attempts = 0;
  let failing = true;
  let closed = false;
  let launches = 0;
  t.mock.method(console, 'error', () => undefined);
  const runs = new AutomationRuns({
    store: () => store,
    now: () => 0,
    isClosed: () => closed,
    persist: async (apply) => {
      const previous = structuredClone(store);
      apply();
      attempts++;
      if (!failing) return;
      store = previous;
      // Bound the broken implementation so it cannot starve the test runner.
      if (attempts >= 20) closed = true;
      throw new Error('ENOSPC');
    },
    commit: async (apply) => apply(),
    validateSelection: async () => undefined,
    prepareWorkspace: async () => '',
    createWorkspace: async () => undefined,
    releaseWorkspace: async () => undefined,
    closeSession: async () => undefined,
    launchSession: async () => {
      launches++;
    },
    rearmScheduler: () => undefined,
  });
  t.after(() => {
    closed = true;
    runs.stop();
  });
  runs.startQueued();
  await new Promise<void>((resolve) => yieldToTimer(resolve, 0));
  assert.ok(attempts <= 2, `expected bounded writes before timer fired, got ${attempts}`);
  assert.equal(store.runs[0]?.status, 'queued');
  assert.equal(launches, 0);
  for (let wake = 0; wake < 5; wake++) runs.startQueued();
  await runs.pending();
  assert.ok(attempts <= 2, 'external wakes must respect the pending retry');
  const attemptsBeforeRetry = attempts;
  t.mock.timers.tick(59_999);
  await runs.pending();
  assert.equal(attempts, attemptsBeforeRetry, 'must not retry before the 60-second deadline');
  t.mock.timers.tick(1);
  await runs.pending();
  assert.equal(attempts, attemptsBeforeRetry + 2, 'one retry attempts starting and failed writes');
  failing = false;
  t.mock.timers.tick(60_000);
  await runs.pending();
  assert.equal(store.runs[0]?.status, 'starting');
  assert.equal(launches, 1);
});
