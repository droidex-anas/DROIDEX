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

test('a store written by another version is refused instead of guessed at', () => {
  assert.throws(
    () => parseAutomationStore({ version: 2, automations: [], runs: [] }, Date.now()),
    /Unsupported automations store version 2/,
  );
});

test('a store missing proposals is refused instead of silently discarding them', () => {
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

test('a stored automation with an unknown schedule kind is dropped', () => {
  const messages: string[] = [];
  const original = console.error;
  console.error = (message?: unknown) => {
    messages.push(String(message));
  };
  try {
    const store = parseAutomationStore(
      {
        version: 1,
        automations: [
          {
            id: 'automation-1',
            title: 'Task',
            prompt: 'Do the task.',
            schedule: { kind: 'monthly', time: '23:59' },
            timezone: 'UTC',
            modelId: 'model-a',
            reasoningEffort: 'high',
          },
        ],
        runs: [],
        proposals: [],
      },
      Date.now(),
    );
    assert.deepEqual(store.automations, []);
    assert.deepEqual(messages, ['Dropped an invalid automation record']);
  } finally {
    console.error = original;
  }
});

test('invalid stored records are dropped and logged', () => {
  const messages: string[] = [];
  const original = console.error;
  console.error = (message?: unknown) => {
    messages.push(String(message));
  };
  try {
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
      'Dropped an invalid automation proposal',
    ]);
  } finally {
    console.error = original;
  }
});

test('trim keeps a review worktree until its chat origin is dropped', () => {
  const now = Date.now();
  const busy = automation(now, { title: 'Busy' });
  const isolated = automation(now, {
    title: 'Isolated',
    workspaceCwd: '/repo',
    executionMode: 'worktree',
  });
  const store = emptyAutomationStore();
  const runs = [];
  for (let index = 0; index < 160; index += 1) {
    const run = newQueuedRun(busy, now + index, now + index, 'manual');
    run.status = 'completed';
    run.finishedAt = now + index;
    runs.push(run);
  }
  const review = newQueuedRun(isolated, now, now, 'manual');
  review.status = 'completed';
  review.finishedAt = now;
  review.appSessionId = 'session-review';
  review.resolvedCwd = '/repo/.worktrees/isolated/repo';
  runs.push(review);
  store.runs = runs;
  store.sessionOrigins['session-review'] = {
    automationId: isolated.id,
    automationTitle: isolated.title,
    runId: review.id,
    trigger: 'manual',
  };
  for (let index = 0; index < 210; index += 1) {
    store.sessionOrigins[`old-${String(index)}`] = {
      automationId: busy.id,
      automationTitle: busy.title,
      runId: `old-run-${String(index)}`,
      trigger: 'manual',
    };
  }

  trimAutomationStore(store);

  assert.equal(
    store.runs.some((run) => run.id === review.id),
    true,
  );
  assert.ok(store.sessionOrigins['session-review']);
});

test('trim keeps the origin of an in-flight run', () => {
  const now = Date.now();
  const definition = automation(now);
  const store = emptyAutomationStore();
  const run = newQueuedRun(definition, now, now, 'manual');
  run.status = 'running';
  run.appSessionId = 'session-live';
  store.runs = [run];
  store.sessionOrigins['session-live'] = {
    automationId: definition.id,
    automationTitle: definition.title,
    runId: run.id,
    trigger: 'manual',
  };
  for (let index = 0; index < 210; index += 1) {
    store.sessionOrigins[`old-${String(index)}`] = {
      automationId: definition.id,
      automationTitle: definition.title,
      runId: `old-run-${String(index)}`,
      trigger: 'manual',
    };
  }

  trimAutomationStore(store);

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
