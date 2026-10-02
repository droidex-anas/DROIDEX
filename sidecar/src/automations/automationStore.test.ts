import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createAutomationRecord, normalizeAutomationInput } from './automationInput.js';
import { newQueuedRun } from './automationRunRecord.js';
import {
  AutomationStoreFile,
  emptyAutomationStore,
  storeHasRunSession,
  trimAutomationStore,
} from './automationStore.js';
import { parseAutomationStore } from './automationStoreParsing.js';
import type { AutomationInput, AutomationProposal } from './types.js';

function automation(now: number, overrides: Partial<AutomationInput> = {}) {
  return createAutomationRecord(
    normalizeAutomationInput({
      title: 'Task',
      prompt: 'Do the task.',
      enabled: false,
      schedule: { kind: 'daily', time: '23:59' },
      timezone: 'UTC',
      modelId: 'model-a',
      reasoningEffort: 'high',
      ...overrides,
    }),
    now,
  );
}

test('a store from another version, or missing a list, is refused instead of guessed at', () => {
  assert.throws(
    () => parseAutomationStore({ version: 2, automations: [], runs: [] }, Date.now()),
    /Unsupported automations store version 2/,
  );
  // Silently defaulting the proposals would discard them on the next write.
  assert.throws(
    () => parseAutomationStore({ version: 1, automations: [], runs: [] }, Date.now()),
    /missing its automations, runs, or proposals list/,
  );
});

test('saved definitions, run history and proposal drafts default additive target and file fields', () => {
  const now = 1_000;
  const definition = automation(now);
  const run = newQueuedRun(definition, now, now, 'manual');
  Reflect.deleteProperty(definition, 'target');
  Reflect.deleteProperty(definition, 'files');
  Reflect.deleteProperty(run.automation, 'target');
  Reflect.deleteProperty(run.automation, 'files');
  const restored = parseAutomationStore(
    {
      version: 1,
      automations: [definition],
      runs: [run],
      proposals: [{ id: 'proposal', sourceAppSessionId: 'source', draft: definition }],
      sessionOrigins: {},
    },
    now,
  );
  for (const value of [
    restored.automations[0],
    restored.runs[0]?.automation,
    restored.proposals[0]?.draft,
  ]) {
    assert.ok(value);
    assert.deepEqual(value.target, { kind: 'new-session' });
    assert.deepEqual(value.files, []);
  }
});

test('invalid stored records, including an unknown schedule kind, are dropped and logged', (t) => {
  const messages: string[] = [];
  t.mock.method(console, 'error', (message?: unknown) => {
    messages.push(String(message));
  });
  const store = parseAutomationStore(
    {
      version: 1,
      automations: [
        {
          id: 'automation-1',
          title: '',
          prompt: 'Do the task.',
          schedule: { kind: 'daily', time: '23:59' },
        },
        {
          id: 'automation-2',
          title: 'Task',
          prompt: 'Do the task.',
          schedule: { kind: 'monthly', time: '23:59' },
          timezone: 'UTC',
          modelId: 'model-a',
          reasoningEffort: 'high',
        },
      ],
      runs: [],
      proposals: [
        {
          id: 'proposal-1',
          sourceAppSessionId: 'session-1',
          draft: {
            title: '',
            prompt: 'Do the task.',
            schedule: { kind: 'daily', time: '23:59' },
          },
        },
      ],
    },
    Date.now(),
  );
  assert.deepEqual(store.automations, []);
  assert.deepEqual(store.proposals, []);
  assert.deepEqual(messages, [
    'Dropped an invalid automation record',
    'Dropped an invalid automation record',
    'Dropped an invalid automation proposal',
  ]);
});

test('trim keeps the origins of in-flight runs and of review worktrees', () => {
  const now = Date.now();
  const busy = automation(now, { title: 'Busy' });
  const isolated = automation(now, {
    title: 'Isolated',
    workspaceCwd: '/repo',
    executionMode: 'worktree',
  });
  const store = emptyAutomationStore();
  const origin = (automationId: string, runId: string) => ({
    automationId,
    automationTitle: 'Task',
    runId,
    trigger: 'manual' as const,
  });
  for (let index = 0; index < 160; index += 1) {
    const run = newQueuedRun(busy, now + index, now + index, 'manual');
    run.status = 'completed';
    run.finishedAt = now + index;
    store.runs.push(run);
  }
  // A completed run whose review chat still holds its worktree.
  const review = newQueuedRun(isolated, now, now, 'manual');
  review.status = 'completed';
  review.finishedAt = now;
  review.appSessionId = 'session-review';
  review.resolvedCwd = '/repo/.worktrees/isolated/repo';
  store.runs.push(review);
  store.sessionOrigins['session-review'] = origin(isolated.id, review.id);
  const live = newQueuedRun(busy, now, now, 'manual');
  live.status = 'running';
  live.appSessionId = 'session-live';
  store.runs.push(live);
  store.sessionOrigins['session-live'] = origin(busy.id, live.id);
  for (let index = 0; index < 210; index += 1) {
    store.sessionOrigins[`old-${String(index)}`] = origin(busy.id, `old-run-${String(index)}`);
  }

  trimAutomationStore(store);

  assert.equal(
    store.runs.some((run) => run.id === review.id),
    true,
  );
  assert.ok(store.sessionOrigins['session-review']);
  assert.ok(store.sessionOrigins['session-live']);
});

test('trim keeps every unconfirmed proposal while capping confirmed history', () => {
  const now = Date.now();
  const definition = automation(now);
  const store = emptyAutomationStore();
  store.automations = [definition];
  store.proposals = Array.from(
    { length: 60 },
    (_, index): AutomationProposal => ({
      id: `proposal-${String(index)}`,
      sourceAppSessionId: `session-${String(index)}`,
      draft: {
        target: { kind: 'new-session' },
        files: [],
        title: `Task ${String(index)}`,
        prompt: 'Do the task.',
        workspaceCwd: null,
        executionMode: 'local',
        enabled: false,
        schedule: { kind: 'daily', time: '23:59' },
        timezone: 'UTC',
        modelId: 'model-a',
        reasoningEffort: 'high',
        autonomy: 'low',
      },
      status: index < 30 ? 'draft' : 'confirmed',
      missingFields: [],
      automationId: index < 30 ? null : definition.id,
      createdAt: now + index,
      updatedAt: now + index,
      confirmedAt: index < 30 ? null : now + index,
    }),
  );

  trimAutomationStore(store);

  assert.equal(store.proposals.length, 50);
  assert.equal(store.proposals.filter((proposal) => proposal.status === 'draft').length, 30);
  assert.equal(
    store.proposals.some((proposal) => proposal.id === 'proposal-30'),
    false,
  );
});

test('a run session is still recognized after its origin record is dropped', () => {
  const now = Date.now();
  const store = emptyAutomationStore();
  const definition = automation(now);
  store.sessionOrigins['from-origin'] = {
    automationId: definition.id,
    automationTitle: definition.title,
    runId: 'run-1',
    trigger: 'manual',
  };
  assert.equal(storeHasRunSession(store, 'from-origin'), true);
  store.sessionOrigins = {};
  const run = newQueuedRun(definition, now, now, 'manual');
  run.appSessionId = 'from-run';
  store.runs = [run];
  assert.equal(storeHasRunSession(store, 'from-run'), true);
  store.runs = [];
  definition.lastAppSessionId = 'from-last';
  store.automations = [definition];
  assert.equal(storeHasRunSession(store, 'from-last'), true);
  assert.equal(storeHasRunSession(store, 'ordinary-chat'), false);
});

test('an unreadable store is quarantined with a recoverable path', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'droidex-store-'));
  const filePath = join(directory, 'automations.json');
  await writeFile(filePath, '{ not json', 'utf8');
  const store = new AutomationStoreFile(filePath);

  try {
    await assert.rejects(store.read(1_700_000_000_000), /unreadable-1700000000000/);
    const entries = await readdir(directory);
    assert.deepEqual(entries, ['automations.json.unreadable-1700000000000']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('permission semantics stamp existing Droid automations before scheduling without changing their levels', () => {
  const definitions = (['off', 'low', 'medium', 'high'] as const).map((autonomy) =>
    automation(1000, { autonomy }),
  );
  const migrated = parseAutomationStore(
    {
      version: 1,
      automations: definitions,
      runs: [],
      proposals: [],
      sessionOrigins: {},
    },
    1000,
  );
  assert.equal(migrated.permissionSemanticsRevision, 1);
  assert.deepEqual(
    migrated.automations.map((entry) => entry.autonomy),
    ['off', 'low', 'medium', 'high'],
  );
  assert.deepEqual(parseAutomationStore(migrated, 1000), migrated);
});
