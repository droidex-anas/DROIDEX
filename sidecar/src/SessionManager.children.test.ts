import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { ProgressLogEntryType, type DroidStreamEvent } from '@factory/droid-sdk';

import type * as Protocol from './protocol.js';
import type { SessionFileChange } from './sessionFileCache.js';
import {
  createMission,
  exactSettingsEvents,
  latestSessionList,
  openChild,
  openChildForParent,
} from './testing/childSettingsTestSupport.js';
import { FakeFactorySession } from './testing/fakeFactoryRuntime.js';
import {
  createSessionManagerTestContext,
  historicalSummary,
  notifyDaemonCompaction,
  sessionUpdates,
  type SessionManagerTestContext,
} from './testing/sessionManagerTestContext.js';

// Child agents through the facade: settings targeting, runtime-scoped state,
// history replay, and the parent wake when background agents settle.

type ChildError = Extract<Protocol.ServerEvent, { type: 'child.error' }>;

const childErrors = (h: SessionManagerTestContext, code: string, childSessionId: string) =>
  h.events.filter(
    (event): event is ChildError =>
      event.type === 'child.error' &&
      event.code === code &&
      event.parentAppSessionId === 'provider-1' &&
      event.childSessionId === childSessionId,
  ).length;

const invalidTargets = (h: SessionManagerTestContext, childSessionId: string) =>
  childErrors(h, 'child.settings_target_invalid', childSessionId);

function updateChild(
  h: SessionManagerTestContext,
  childSessionId: string,
  modelId: string | null,
  parentAppSessionId = 'provider-1',
): Promise<void> {
  return h.handle({ type: 'child.updateSettings', parentAppSessionId, childSessionId, modelId });
}

const modelAndLimit = (settings: Record<string, unknown>[]) =>
  settings.map((write) => ({ modelId: write['modelId'], limit: write['compactionTokenLimit'] }));

async function completeWorker(h: SessionManagerTestContext, workerSessionId: string) {
  h.provider.session('provider-1').queueStreamEvents([
    {
      type: 'mission_progress_entry',
      progressLog: [
        {
          type: ProgressLogEntryType.WorkerStarted,
          timestamp: '2026-07-29T00:00:00.000Z',
          workerSessionId,
          spawnId: 'spawn-worker-logical',
        },
      ],
    },
    { type: 'mission_worker_completed', workerSessionId, exitCode: 0 },
  ]);
  await h.handle({ type: 'session.send', appSessionId: 'provider-1', text: 'settle worker' });
}

test('exact child settings target only the resolved worker or validator backend', async () => {
  const h = createSessionManagerTestContext();
  try {
    await createMission(h, {
      workerModel: 'worker-role-default',
      validatorModel: 'validator-role-default',
    });
    const workerA = await openChild(h, 'worker-a', 'worker-backend-a', 'worker', 'worker-old-a');
    const workerB = await openChild(h, 'worker-b', 'worker-backend-b', 'worker', 'worker-old-b');
    const validator = await openChild(h, 'validator', 'validator-backend', 'validator', 'old');
    const retune = (workerLimit: number) =>
      h.handle({
        type: 'settings.compaction.update',
        compactionTokenLimit: 700,
        compactionTokenLimitPerModel: { 'worker-new': workerLimit, 'validator-new': 311 },
      });
    await retune(211);
    const parent = h.provider.session('provider-1');
    const writesBefore = [workerA, workerB, validator, parent].map((s) => s.settings.length);

    await h.handle({
      type: 'child.updateSettings',
      parentAppSessionId: 'provider-1',
      childSessionId: 'worker-a',
      modelId: 'worker-new',
      reasoningEffort: 'high',
    });

    assert.deepEqual(modelAndLimit(workerA.settings.slice(writesBefore[0])), [
      { modelId: 'worker-new', limit: undefined },
      { modelId: undefined, limit: 211 },
    ]);
    assert.deepEqual(
      workerA.settings.slice(-2).map((write) => write['reasoningEffort']),
      ['high', undefined],
    );
    assert.deepEqual(
      [workerB, validator, parent].map((s) => s.settings.length),
      writesBefore.slice(1),
    );
    const workerEvent = exactSettingsEvents(h.events, 'provider-1', 'worker-a').at(-1);
    assert.equal(workerEvent?.modelId, 'worker-new');
    assert.equal('providerSessionId' in workerEvent, false);

    // A global retune follows the child's accepted model.
    await retune(411);
    assert.equal(workerA.settings.at(-1)?.['compactionTokenLimit'], 411);

    const validatorBefore = validator.settings.length;
    const parentBefore = parent.settings.length;
    await updateChild(h, 'validator', 'validator-new');
    assert.deepEqual(modelAndLimit(validator.settings.slice(validatorBefore)), [
      { modelId: 'validator-new', limit: undefined },
      { modelId: undefined, limit: 311 },
    ]);
    assert.equal(parent.settings.length, parentBefore);

    await h.handle({ type: 'sessions.list' });
    const listed = latestSessionList(h.events).find((s) => s.appSessionId === 'provider-1');
    assert.equal(listed?.workerModelId, 'worker-role-default');
    assert.equal(listed?.validatorModelId, 'validator-role-default');
  } finally {
    await h.dispose();
  }
});

test('child default reset prefers the parent role model then the validated Factory role default', async () => {
  const cases = [
    {
      mission: { workerModel: 'worker-role-default' },
      role: 'worker',
      expected: 'worker-role-default',
    },
    { mission: {}, role: 'validator', expected: 'model-default' },
  ] as const;
  for (const { mission, role, expected } of cases) {
    const h = createSessionManagerTestContext();
    try {
      await createMission(h, mission);
      const child = await openChild(h, `${role}-logical`, `${role}-backend`, role, `${role}-old`);
      await h.handle({
        type: 'settings.compaction.update',
        compactionTokenLimit: 700,
        compactionTokenLimitPerModel: { [expected]: 271, [`${role}-old`]: 171 },
      });
      await updateChild(h, `${role}-logical`, null);
      assert.equal(child.settings.at(-2)?.['modelId'], expected, role);
      assert.equal(child.settings.at(-1)?.['compactionTokenLimit'], 271, role);
    } finally {
      await h.dispose();
    }
  }
});

test('a parent provider alias is never accepted as parentAppSessionId', async () => {
  const h = createSessionManagerTestContext();
  try {
    await createMission(h);
    h.provider.session('provider-1').nextCompactResult = {
      newSessionId: 'parent-backend',
      removedCount: 1,
    };
    h.runtime.loadQueue.set('parent-backend', [
      new FakeFactorySession('parent-backend', {}, h.calls),
    ]);
    await h.handle({ type: 'session.compact', appSessionId: 'provider-1' });
    const child = await openChild(h, 'child-logical', 'child-backend', 'worker', 'worker-old');
    const writes = child.settings.length;

    await updateChild(h, 'child-logical', 'must-not-apply', 'parent-backend');
    assert.equal(child.settings.length, writes);

    await updateChild(h, 'child-logical', 'worker-new');
    assert.equal(child.settings.slice(writes)[0]?.['modelId'], 'worker-new');
  } finally {
    await h.dispose();
  }
});

test('child settings reject every target that is not a live exact child of the parent', async () => {
  const h = createSessionManagerTestContext();
  try {
    await createMission(h);
    const child = await openChild(h, 'worker-logical', 'worker-backend', 'worker', 'worker-old');
    const writes = child.settings.length;
    const parentWrites = h.provider.session('provider-1').settings.length;
    const successes = exactSettingsEvents(h.events, 'provider-1', 'worker-logical').length;
    const rejected: [string, Protocol.ClientCommand][] = [
      [
        'the backend provider id is not the child command identity',
        {
          type: 'child.updateSettings',
          parentAppSessionId: 'provider-1',
          childSessionId: 'worker-backend',
          modelId: 'must-not-apply',
        },
      ],
      [
        'a model-less command is malformed',
        {
          type: 'child.updateSettings',
          parentAppSessionId: 'provider-1',
          childSessionId: 'worker-logical',
          reasoningEffort: 'high',
        } as unknown as Protocol.ClientCommand,
      ],
      [
        'an unknown child is not a target',
        {
          type: 'child.updateSettings',
          parentAppSessionId: 'provider-1',
          childSessionId: 'unknown-child',
          modelId: 'must-not-apply',
        },
      ],
    ];
    for (const [reason, command] of rejected) {
      const childSessionId = (command as { childSessionId: string }).childSessionId;
      const errors = invalidTargets(h, childSessionId);
      await h.handle(command);
      assert.equal(child.settings.length, writes, reason);
      assert.equal(invalidTargets(h, childSessionId), errors + 1, reason);
    }
    assert.equal(h.provider.session('provider-1').settings.length, parentWrites);
    assert.equal(exactSettingsEvents(h.events, 'provider-1', 'worker-logical').length, successes);

    // An unknown child cannot be opened into the parent's child map either.
    const loads = h.runtime.loadCalls.length;
    await h.handle({
      type: 'child.open',
      parentAppSessionId: 'provider-1',
      childSessionId: 'unknown-child',
      requestId: 'open-unknown-child',
    });
    assert.equal(h.runtime.loadCalls.length, loads);
    assert.equal(childErrors(h, 'child.not_in_session', 'unknown-child'), 1);

    // A completed child is no longer a settings target.
    await completeWorker(h, 'worker-backend');
    const errors = invalidTargets(h, 'worker-logical');
    await updateChild(h, 'worker-logical', 'must-not-apply');
    assert.equal(child.settings.length, writes);
    assert.equal(invalidTargets(h, 'worker-logical'), errors + 1);
  } finally {
    await h.dispose();
  }
});

test('a closing parent rejects exact child settings before provider issue', async () => {
  const h = createSessionManagerTestContext();
  try {
    await createMission(h);
    const child = await openChild(h, 'worker-logical', 'worker-backend', 'worker', 'worker-old');
    const closeGate = h.provider.session('provider-1').deferNextClose();
    const closing = h.handle({ type: 'session.close', appSessionId: 'provider-1' });
    await h.waitForIdle();
    const writes = child.settings.length;

    await updateChild(h, 'worker-logical', 'must-not-apply');

    assert.equal(child.settings.length, writes);
    assert.equal(invalidTargets(h, 'worker-logical'), 1);
    closeGate.resolve();
    await closing;
  } finally {
    await h.dispose().catch(() => undefined);
  }
});

test('the same child identity under another parent is not interchangeable', async () => {
  const h = createSessionManagerTestContext();
  try {
    await createMission(h);
    await createMission(h);
    const open = (parent: string, backend: string) =>
      openChildForParent(h, parent, {
        childSessionId: 'shared-logical',
        providerSessionId: backend,
        role: 'worker',
        modelId: 'worker-old',
      });
    const first = await open('provider-1', 'worker-backend-1');
    const second = await open('provider-2', 'worker-backend-2');
    const firstWrites = first.settings.length;
    const secondWrites = second.settings.length;

    await updateChild(h, 'shared-logical', 'second-only', 'provider-2');

    assert.equal(first.settings.length, firstWrites);
    assert.deepEqual(modelAndLimit(second.settings.slice(secondWrites)), [
      { modelId: 'second-only', limit: undefined },
      { modelId: undefined, limit: 250_000 },
    ]);
    const latest = (parent: string) =>
      exactSettingsEvents(h.events, parent, 'shared-logical').at(-1)?.modelId;
    assert.equal(latest('provider-1'), 'worker-old');
    assert.equal(latest('provider-2'), 'second-only');
  } finally {
    await h.dispose();
  }
});

test('provider rejection commits no child success and role-default rejection stays truthful', async () => {
  const h = createSessionManagerTestContext();
  try {
    await createMission(h, { workerModel: 'worker-accepted' });
    const child = await openChild(h, 'worker-logical', 'worker-backend', 'worker', 'worker-old');
    const successes = exactSettingsEvents(h.events, 'provider-1', 'worker-logical').length;
    const writes = child.settings.length;
    child.nextUpdateSettingsError = new Error('child provider rejected');

    await updateChild(h, 'worker-logical', 'worker-rejected');

    assert.equal(child.settings.length, writes + 1);
    assert.equal(child.settings.at(-1)?.['modelId'], 'worker-rejected');
    assert.equal(exactSettingsEvents(h.events, 'provider-1', 'worker-logical').length, successes);
    assert.equal(childErrors(h, 'child.settings_update_failed', 'worker-logical'), 1);

    h.provider.session('provider-1').nextUpdateSettingsError = new Error('role default rejected');
    await h.handle({
      type: 'settings.agent.update',
      appSessionId: 'provider-1',
      agent: 'worker',
      modelId: 'worker-false-projection',
    });
    await h.handle({ type: 'sessions.list' });
    assert.equal(
      latestSessionList(h.events).find((session) => session.appSessionId === 'provider-1')
        ?.workerModelId,
      'worker-accepted',
    );
  } finally {
    await h.dispose();
  }
});

test('child open emits no settings readiness after the parent closes', async () => {
  const h = createSessionManagerTestContext();
  try {
    await createMission(h);
    const child = new FakeFactorySession('worker-backend', {}, h.calls);
    child.setInitModel('worker-old');
    const gate = child.deferNextUpdateSettings();
    h.history.seedChildSessions([
      {
        parentAppSessionId: 'provider-1',
        childSessionId: 'worker-logical',
        providerSessionId: 'worker-backend',
        role: 'worker',
        status: 'paused',
        modelId: 'worker-old',
        transcriptAvailable: true,
        updatedAt: Date.now(),
      },
    ]);
    h.runtime.loadQueue.set('worker-backend', [child]);

    const opening = h.handle({
      type: 'child.open',
      parentAppSessionId: 'provider-1',
      childSessionId: 'worker-logical',
      requestId: 'open-worker-logical',
    });
    await h.waitForIdle();
    await h.handle({ type: 'session.close', appSessionId: 'provider-1' });
    gate.resolve();
    await opening;

    assert.equal(
      h.events.some(
        (event) =>
          event.type === 'child.updated' &&
          event.childSessionId === 'worker-logical' &&
          event.access === 'ready',
      ),
      false,
    );
    assert.equal(
      h.calls.filter(
        (call) =>
          call.target === 'cleanup' &&
          call.method === 'session.close' &&
          call.args[0] === 'worker-backend',
      ).length,
      1,
    );
  } finally {
    await h.dispose();
  }
});

test('child sessions publish confirmed autonomy only while their runtime is live', async () => {
  const h = createSessionManagerTestContext();
  try {
    await createMission(h);

    await openChildForParent(h, 'provider-1', {
      childSessionId: 'worker-logical',
      providerSessionId: 'provider-worker',
      role: 'worker',
      modelId: 'worker-model',
      initAutonomy: 'medium',
    });
    const opened = exactSettingsEvents(h.events, 'provider-1', 'worker-logical').at(-1);
    assert.equal(opened?.autonomy, 'medium');

    // A child whose provider did not report autonomy publishes none.
    await openChild(h, 'validator-logical', 'provider-validator', 'validator', 'validator-model');
    const unreported = exactSettingsEvents(h.events, 'provider-1', 'validator-logical').at(-1);
    assert.equal(unreported !== undefined && 'autonomy' in unreported, false);

    // Autonomy is runtime-scoped: once the runtime closes, history carries none.
    await h.handle({ type: 'session.close', appSessionId: 'provider-1' });
    await h.handle({ type: 'session.loadHistory', appSessionId: 'provider-1' });
    const history = h.events.filter((event) => event.type === 'session.history').at(-1);
    const historical = history?.childSessions?.find(
      (child) => child.childSessionId === 'worker-logical',
    );
    assert.equal(historical !== undefined && 'autonomy' in historical, false);
  } finally {
    await h.dispose();
  }
});

// History replay for child agents.

type SessionHistoryEvent = Extract<Protocol.ServerEvent, { type: 'session.history' }>;

const histories = (h: SessionManagerTestContext): SessionHistoryEvent[] =>
  h.events.filter((event): event is SessionHistoryEvent => event.type === 'session.history');

function writeHistorySession(
  home: string,
  id: string,
  lines: unknown[],
  sessionStart: Record<string, unknown> = {},
): SessionFileChange {
  const dir = path.join(home, '.factory', 'sessions', '2026', '07');
  mkdirSync(dir, { recursive: true });
  const sessionPath = path.join(dir, `${id}.jsonl`);
  const start = {
    type: 'session_start',
    id,
    cwd: home,
    sessionTitle: 'History',
    settings: { interactionMode: 'auto' },
    ...sessionStart,
  };
  writeFileSync(
    sessionPath,
    [start, ...lines].map((line) => JSON.stringify(line)).join('\n') + '\n',
  );
  return { providerSessionId: id, path: sessionPath };
}

function message(role: 'user' | 'assistant', id: string, text: string, timestamp: number) {
  return {
    type: 'message',
    id,
    timestamp: new Date(timestamp).toISOString(),
    message: { role, content: [{ type: 'text', text }] },
  };
}

function linkedWorker(
  parentAppSessionId: string,
  childSessionId: string,
  toolUseId: string,
  status: Protocol.ChildSessionSummary['status'] = 'completed',
): Protocol.ChildSessionSummary {
  return {
    parentAppSessionId,
    childSessionId,
    role: 'worker',
    status,
    modelId: 'model-default',
    spawnLink: { kind: 'tool-use', id: toolUseId },
    transcriptAvailable: true,
    streamFidelity: 'state',
  };
}

test('child.loadHistory serves each logical child its own pages and rejects unknown children', async () => {
  const h = createSessionManagerTestContext();
  try {
    h.fixture.publishSessionFiles([
      writeHistorySession(h.home, 'provider-child-a', [
        message('assistant', 'oldest', 'oldest', 1),
        message('assistant', 'middle', 'middle', 2),
        message('assistant', 'newest', 'newest', 3),
      ]),
      writeHistorySession(h.home, 'provider-child-b', [message('assistant', 'b', 'child b', 1)]),
    ]);
    h.history.seedChildSessions(
      (
        [
          ['logical-a', 'provider-child-a', 'worker'],
          ['logical-b', 'provider-child-b', 'validator'],
        ] as const
      ).map(([childSessionId, providerSessionId, role]) => ({
        parentAppSessionId: 'parent',
        childSessionId,
        providerSessionId,
        role,
        status: 'completed' as const,
        modelId: 'model-default',
        transcriptAvailable: true,
        updatedAt: 1,
      })),
    );
    const load = async (childSessionId: string, cursor?: string) => {
      await h.handle({
        type: 'child.loadHistory',
        parentAppSessionId: 'parent',
        childSessionId,
        limit: 2,
        ...(cursor ? { cursor } : {}),
      });
      const page = histories(h).at(-1);
      assert.equal(page?.childSessionId, childSessionId);
      return page;
    };
    const rows = (page: SessionHistoryEvent) =>
      page.transcripts.map((event) => [
        event.text,
        event.appSessionId,
        event.sourceSessionId,
        event.role,
      ]);

    const initial = await load('logical-a');
    assert.equal(initial.mode, 'replace');
    assert.equal(initial.hasMore, true);
    assert.deepEqual(rows(initial), [
      ['middle', 'parent', 'logical-a', 'worker'],
      ['newest', 'parent', 'logical-a', 'worker'],
    ]);
    assert.equal(
      h.calls.some((call) => call.target === 'history' && call.method === 'recordEvent'),
      false,
      'child history pages are replayed, not re-recorded into the parent timeline',
    );
    const older = await load('logical-a', initial.olderCursor);
    assert.equal(older.mode, 'prepend');
    assert.equal(older.hasMore, false);
    assert.deepEqual(rows(older), [['oldest', 'parent', 'logical-a', 'worker']]);
    assert.deepEqual(rows(await load('logical-b')), [
      ['child b', 'parent', 'logical-b', 'validator'],
    ]);

    const pages = histories(h).length;
    await h.handle({
      type: 'child.loadHistory',
      parentAppSessionId: 'parent',
      childSessionId: 'missing-child',
    });
    assert.equal(
      h.events.some(
        (event) =>
          event.type === 'child.error' &&
          event.code === 'child.not_in_session' &&
          event.childSessionId === 'missing-child',
      ),
      true,
    );
    assert.equal(histories(h).length, pages);
  } finally {
    await h.dispose();
  }
});

function taskProgress(toolUseId: string, subagentSessionId: string): DroidStreamEvent {
  return {
    type: 'tool_progress',
    toolName: 'Task',
    toolUseId,
    content: '',
    update: { type: 'tool_call', subagentSessionId, parameters: { subagent_type: 'worker' } },
  };
}

test('a linked child opens, replays, and keeps its status beside live Task children', async () => {
  const h = createSessionManagerTestContext();
  try {
    h.fixture.seedHistorySummaries([historicalSummary('app-a2', 'provider-a2')]);
    h.fixture.seedChildSessions([
      linkedWorker('app-a2', 'worker-a2', 'tool-a2', 'paused'),
      linkedWorker('app-a2', 'worker-unknown-a2', 'tool-unknown-a2'),
    ]);
    h.fixture.publishSessionFiles([
      writeHistorySession(h.home, 'provider-a2', [
        message('user', 'user-a2', 'parent prompt', 0),
        message('assistant', 'parent-a2', 'parent response', 1),
      ]),
      writeHistorySession(
        h.home,
        'worker-a2',
        [message('assistant', 'child-a2', 'child replay', 0)],
        { callingSessionId: 'provider-a2', callingToolUseId: 'tool-a2' },
      ),
    ]);
    const childStatus = (
      page: SessionHistoryEvent | undefined,
      match: (child: Protocol.ChildSessionSummary) => boolean,
    ) => page?.childSessions?.find(match)?.status;
    const byId = (id: string) => (child: Protocol.ChildSessionSummary) =>
      child.childSessionId === id;
    const bySpawn = (id: string) => (child: Protocol.ChildSessionSummary) =>
      child.spawnLink?.id === id;

    await h.handle({ type: 'session.loadHistory', appSessionId: 'app-a2' });
    const historical = histories(h).at(-1);
    assert.equal(childStatus(historical, byId('worker-a2')), 'paused');
    assert.equal(childStatus(historical, byId('worker-unknown-a2')), 'completed');

    // A non-live parent opens its child as history without loading a provider.
    await h.handle({
      type: 'child.open',
      parentAppSessionId: 'app-a2',
      childSessionId: 'worker-unknown-a2',
      requestId: 'open-before-resume',
    });
    assert.equal(h.runtime.loadCalls.length, 0);
    assert.equal(
      h.events.some(
        (event) =>
          event.type === 'child.updated' &&
          event.childSessionId === 'worker-unknown-a2' &&
          event.access === 'history',
      ),
      true,
    );
    assert.equal(
      h.events.some((event) => event.type === 'child.error'),
      false,
    );

    await h.handle({ type: 'session.resume', appSessionId: 'app-a2' });
    await h.handle({
      type: 'child.open',
      parentAppSessionId: 'app-a2',
      childSessionId: 'worker-a2',
      requestId: 'open-worker-a2',
    });
    for (const id of ['worker-completed-a2', 'worker-running-a2'])
      h.history.seedSessionLaunchSettings(id, { modelId: 'model-default' });
    h.provider.session('provider-a2').queueStreamEvents([
      taskProgress('tool-completed-a2', 'worker-completed-a2'),
      {
        type: 'tool_result',
        toolName: 'Task',
        toolUseId: 'tool-completed-a2',
        content: 'done',
        isError: false,
      },
      taskProgress('tool-running-a2', 'worker-running-a2'),
    ]);
    await h.handle({ type: 'session.send', appSessionId: 'app-a2', text: 'run child' });
    await h.handle({ type: 'session.loadHistory', appSessionId: 'app-a2' });

    assert.equal(h.runtime.loadCalls.at(-1)?.sessionId, 'worker-a2');
    assert.equal(
      h.events.some(
        (event) =>
          event.type === 'child.updated' &&
          event.childSessionId === 'worker-a2' &&
          event.access === 'ready',
      ),
      true,
    );
    assert.equal(
      histories(h).some(
        (event) =>
          event.childSessionId === 'worker-a2' &&
          event.transcripts.some(
            (transcript) =>
              transcript.sourceSessionId === 'worker-a2' && transcript.text === 'child replay',
          ),
      ),
      true,
    );
    const live = histories(h).at(-1);
    assert.equal(childStatus(live, byId('worker-a2')), 'paused');
    assert.equal(childStatus(live, bySpawn('tool-completed-a2')), 'completed');
    assert.equal(childStatus(live, bySpawn('tool-running-a2')), 'running');
    assert.equal(childStatus(live, byId('worker-unknown-a2')), 'completed');
  } finally {
    await h.dispose();
  }
});

// Events from children and background agents land on the parent.

async function createSession(
  h: SessionManagerTestContext,
  sessionPurpose: 'chat' | 'mission-control' = 'chat',
): Promise<FakeFactorySession> {
  await h.create({
    sessionPurpose,
    clientRef: 'event-flow',
    title: 'Event flow',
    goal: 'initial',
    interactionMode: sessionPurpose === 'chat' ? 'auto' : 'agi',
    autonomy: 'low',
  });
  await h.provider.waitForPrompts('provider-1', 1);
  await h.waitForIdle();
  return h.provider.session('provider-1');
}

const send = (h: SessionManagerTestContext, text: string): Promise<void> =>
  h.handle({ type: 'session.send', appSessionId: 'provider-1', text });

const latestSummary = (h: SessionManagerTestContext) => sessionUpdates(h.events).at(-1);

test('worker usage and context follow the parent-scoped child identity', async () => {
  const h = createSessionManagerTestContext();
  const usage = (
    inputTokens: number,
    outputTokens: number,
    cacheCreationTokens = 0,
    cacheReadTokens = 0,
  ) => ({
    type: 'token_usage_update' as const,
    inputTokens,
    outputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    thinkingTokens: 0,
  });
  try {
    const primary = await createSession(h, 'mission-control');
    primary.queueStreamEvents([usage(5, 2, 1, 2)]);
    await send(h, 'primary usage');
    assert.equal(latestSummary(h)?.contextTokens, 9);
    assert.equal(latestSummary(h)?.contextAccuracy, 'exact');

    h.history.seedSessionLaunchSettings('worker-history-id', { modelId: 'model-default' });
    primary.queueStreamEvents([taskProgress('task-context', 'worker-history-id')]);
    await send(h, 'spawn worker');
    const worker = new FakeFactorySession('worker-runtime-id', {}, h.calls);
    h.runtime.loadQueue.set('worker-history-id', [worker]);
    await h.handle({
      type: 'child.open',
      parentAppSessionId: 'provider-1',
      childSessionId: 'child-1',
      requestId: 'open-child-history',
    });
    notifyDaemonCompaction(h, 'worker-runtime-id', 'started');
    notifyDaemonCompaction(h, 'worker-runtime-id', 'completed');
    await h.waitForIdle();
    h.events.length = 0;

    worker.queueStreamEvents([usage(50, 20)]);
    await h.handle({
      type: 'child.send',
      parentAppSessionId: 'provider-1',
      childSessionId: 'child-1',
      text: 'worker usage',
    });

    // Worker tokens add to the totals without replacing the primary context reading.
    const summary = latestSummary(h);
    assert.equal(summary?.tokensIn, 50);
    assert.equal(summary?.tokensOut, 20);
    assert.equal(summary?.contextTokens, 9);
    assert.equal(summary?.contextAccuracy, 'exact');
    const childContext = h.events.find(
      (event) =>
        event.type === 'context.updated' &&
        event.appSessionId === 'provider-1' &&
        event.sourceSessionId === 'child-1' &&
        event.parentAppSessionId === 'provider-1' &&
        event.childSessionId === 'child-1',
    );
    assert.equal(childContext?.type, 'context.updated');
    assert.equal(childContext.stats.compactions, 1);
  } finally {
    await h.dispose();
  }
});
