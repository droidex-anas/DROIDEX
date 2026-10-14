import assert from 'node:assert/strict';
import test from 'node:test';

import { ContextStatsAccuracy } from '@factory/droid-sdk';

import type * as Protocol from './protocol.js';
import { FakeFactorySession, type RecordedCall } from './testing/fakeFactoryRuntime.js';
import { writeProviderConversation } from './testing/historyCharacterizationSupport.js';
import {
  chatCommand,
  createSessionManagerTestContext,
  notifyDaemonCompaction,
  sessionUpdates,
  type SessionCreateInput,
  type SessionManagerTestContext,
} from './testing/sessionManagerTestContext.js';

// Compaction through the facade: daemon arming, the provider swap a compaction
// can cause, and the work queued behind it. SessionCompaction owns the
// adoption and retune rules.

async function createChat(
  h: SessionManagerTestContext,
  options: Partial<SessionCreateInput> = {},
): Promise<void> {
  await h.create(chatCommand('compaction', { goal: 'go', ...options }));
  await h.waitForIdle();
}

const appendedTextIndex = (h: SessionManagerTestContext, text: string): number =>
  h.events.findIndex((event) => event.type === 'event.appended' && event.event.text === text);

const errorMessages = (h: SessionManagerTestContext, recoverable?: boolean): string[] =>
  h.events.flatMap((event) =>
    event.type === 'error' && (recoverable === undefined || event.recoverable === recoverable)
      ? [event.message]
      : [],
  );

const compactionArms = (h: SessionManagerTestContext, providerSessionId = 'provider-1') =>
  h.provider
    .session(providerSessionId)
    .settings.filter((settings) => settings['compactionThresholdCheckEnabled'] === true);

function callCount(
  calls: RecordedCall[],
  target: RecordedCall['target'],
  method: string,
  id: string,
) {
  return calls.filter(
    (call) => call.target === target && call.method === method && call.args[0] === id,
  ).length;
}

function syncsSummary(calls: RecordedCall[], appSessionId: string, providerSessionId: string) {
  return calls.some(
    (call) =>
      call.target === 'history' &&
      call.method === 'syncSummaries' &&
      (call.args[0] as Protocol.SessionSummary[]).some(
        (summary) =>
          summary.appSessionId === appSessionId && summary.providerSessionId === providerSessionId,
      ),
  );
}

test('create arms daemon compaction, and its notifications stream before an active turn settles', async () => {
  const h = createSessionManagerTestContext();
  try {
    await createChat(h, { compactionTokenLimit: 600 });
    assert.equal(compactionArms(h).at(-1)?.['compactionTokenLimit'], 600);

    const streamGate = h.provider.deferNextStream('provider-1');
    let turnSettled = false;
    const turn = h
      .handle({ type: 'session.send', appSessionId: 'provider-1', text: 'long running task' })
      .then(() => {
        turnSettled = true;
      });
    await h.provider.waitForPrompts('provider-1', 2);
    h.events.length = 0;

    notifyDaemonCompaction(h, 'provider-1', 'started');
    const started = appendedTextIndex(h, 'Compacting conversation...');
    assert.equal(turnSettled, false);
    assert.equal(started >= 0, true);

    notifyDaemonCompaction(h, 'provider-1', 'completed', 'first-completion');
    const completed = h.events.findIndex(
      (event) => event.type === 'event.appended' && event.event.kind === 'compaction',
    );
    const summary = sessionUpdates(h.events).at(-1);
    assert.equal(turnSettled, false);
    assert.equal(completed > started, true);
    assert.equal(summary?.streaming, true);
    assert.equal(summary?.autoCompactions, 1);
    notifyDaemonCompaction(h, 'provider-1', 'started');
    notifyDaemonCompaction(h, 'provider-1', 'completed');
    notifyDaemonCompaction(h, 'provider-1', 'completed');
    assert.equal(sessionUpdates(h.events).at(-1)?.autoCompactions, 3);
    notifyDaemonCompaction(h, 'provider-1', 'completed', 'first-completion');
    assert.equal(sessionUpdates(h.events).at(-1)?.autoCompactions, 3);
    assert.equal(
      h.events.filter(
        (event) => event.type === 'event.appended' && event.event.kind === 'compaction',
      ).length,
      3,
    );
    // The daemon owns automatic compaction; the client never compacts on its own.
    assert.equal(callCount(h.calls, 'provider', 'compactSession', 'provider-1'), 0);

    streamGate.resolve();
    await turn;
    assert.equal(turnSettled, true);
  } finally {
    await h.dispose();
  }
});

test('manual in-place compaction refreshes context, then delivers the send queued behind it once', async () => {
  const h = createSessionManagerTestContext();
  try {
    await createChat(h);
    const compactGate = h.provider.deferNextCompaction('provider-1');
    const queuedStreamGate = h.provider.deferNextStream('provider-1');
    h.provider.session('provider-1').nextCompactResult = {
      newSessionId: 'provider-1',
      removedCount: 1,
    };

    const compacting = h.handle({
      type: 'session.compact',
      appSessionId: 'provider-1',
      customInstructions: 'preserve decisions',
    });
    await h.handle({ type: 'session.send', appSessionId: 'provider-1', text: 'queued once' });
    compactGate.resolve();
    await h.provider.waitForPrompts('provider-1', 2);

    const compactingStatus = appendedTextIndex(h, 'Compacting conversation...');
    const refreshedContext = h.events.findIndex(
      (event, index) =>
        index > compactingStatus &&
        event.type === 'context.updated' &&
        event.sourceSessionId === 'provider-1',
    );
    const completionStatus = appendedTextIndex(h, 'Compaction complete.');
    assert.ok(compactingStatus >= 0);
    assert.ok(refreshedContext > compactingStatus);
    assert.ok(completionStatus > refreshedContext);
    const completionRecord = h.calls.findIndex(
      (call) =>
        call.target === 'protocol' &&
        call.method === 'event' &&
        (call.args[0] as Protocol.ServerEvent).type === 'event.appended' &&
        (call.args[0] as Extract<Protocol.ServerEvent, { type: 'event.appended' }>).event.text ===
          'Compaction complete.',
    );
    const queuedDelivery = h.calls.findIndex(
      (call) =>
        call.target === 'provider' &&
        call.method === 'stream' &&
        call.args[0] === 'provider-1' &&
        call.args[1] === 'queued once',
    );
    assert.ok(completionRecord >= 0);
    assert.ok(queuedDelivery > completionRecord);
    assert.deepEqual(h.provider.session('provider-1').prompts, ['go', 'queued once']);

    queuedStreamGate.resolve();
    await compacting;
    const compactCall = h.calls.find(
      (call) => call.target === 'provider' && call.method === 'compactSession',
    );
    assert.deepEqual(compactCall?.args, [
      'provider-1',
      { customInstructions: 'preserve decisions' },
    ]);
    assert.equal(sessionUpdates(h.events).at(-1)?.providerSessionId, 'provider-1');
  } finally {
    await h.dispose();
  }
});

test('manual compaction is refused mid-turn, and a failed one stays recoverable with unique statuses', async (t) => {
  const h = createSessionManagerTestContext();
  try {
    await createChat(h);
    const streamGate = h.provider.deferNextStream('provider-1');
    const sending = h.handle({ type: 'session.send', appSessionId: 'provider-1', text: 'turn' });
    await h.provider.waitForPrompts('provider-1', 2);
    await h.handle({ type: 'session.compact', appSessionId: 'provider-1' });
    assert.equal(callCount(h.calls, 'provider', 'compactSession', 'provider-1'), 0);
    assert.equal(
      h.events.some(
        (event) =>
          event.type === 'event.appended' &&
          /cannot compact while a turn is active/i.test(event.event.text ?? ''),
      ),
      true,
    );
    streamGate.resolve();
    await sending;
    await h.waitForIdle();

    h.events.length = 0;
    h.provider.session('provider-1').nextCompactError = new Error('transient failure');
    t.mock.method(Date, 'now', () => 123_456);
    await h.handle({ type: 'session.compact', appSessionId: 'provider-1' });

    const statuses = h.events.flatMap((event) =>
      event.type === 'event.appended' && event.event.kind === 'status' ? [event.event] : [],
    );
    assert.equal(statuses.length, 2);
    assert.equal(new Set(statuses.map((event) => event.id)).size, statuses.length);
    assert.equal(
      statuses.some((event) => /could not finish/i.test(event.text ?? '')),
      true,
    );
    assert.deepEqual(errorMessages(h, true), ['Could not compact session: transient failure']);
    assert.equal(
      sessionUpdates(h.events).some((summary) => summary.phase === 'failed'),
      false,
    );
  } finally {
    await h.dispose();
  }
});

test('provider-session swap retries a failed load, rewires the replacement, and redelivers the queued send once', async () => {
  const h = createSessionManagerTestContext();
  try {
    await createChat(h);
    const compactGate = h.provider.deferNextCompaction('provider-1');
    h.provider.session('provider-1').nextCompactResult = {
      newSessionId: 'provider-2',
      removedCount: 1,
    };
    h.runtime.loadQueue.set('provider-2', [
      new Error('first load fails'),
      new FakeFactorySession('provider-2', {}, h.calls),
    ]);

    const compacting = h.handle({ type: 'session.compact', appSessionId: 'provider-1' });
    await h.handle({ type: 'session.send', appSessionId: 'provider-1', text: 'redeliver once' });
    compactGate.resolve();
    await compacting;

    assert.equal(h.runtime.loadCalls.filter((call) => call.sessionId === 'provider-2').length, 2);
    assert.ok(errorMessages(h).includes('Could not compact session: first load fails'));
    const update = sessionUpdates(h.events).at(-1);
    const load = h.runtime.loadCalls.at(-1);
    const creation = h.runtime.createCalls[0];
    assert.ok(update && load && creation);
    assert.equal(update.appSessionId, 'provider-1');
    assert.equal(update.providerSessionId, 'provider-2');
    assert.equal(update.autonomy, 'low');
    assert.deepEqual(h.provider.session('provider-2').settings[0], { autonomyLevel: 'off' });
    assert.equal(typeof load.handlers.permissionHandler, 'function');
    assert.equal(typeof load.handlers.askUserHandler, 'function');
    assert.equal(load.handlers.mcpServers, creation.mcpServers);
    // Each turn adds and removes its own listener beside the compaction subscription.
    assert.equal(callCount(h.calls, 'provider', 'onNotification', 'provider-2'), 2);
    assert.equal(callCount(h.calls, 'cleanup', 'unsubscribe', 'provider-1'), 2);
    assert.equal(compactionArms(h, 'provider-2').length > 0, true);
    assert.equal(callCount(h.calls, 'cleanup', 'session.close', 'provider-1'), 1);
    assert.equal(syncsSummary(h.calls, 'provider-1', 'provider-2'), true);
    assert.deepEqual(h.provider.session('provider-1').prompts, ['go']);
    assert.deepEqual(h.provider.session('provider-2').prompts, ['redeliver once']);

    await h.handle({ type: 'session.send', appSessionId: 'provider-1', text: 'after' });
    assert.deepEqual(h.provider.session('provider-2').prompts, ['redeliver once', 'after']);
  } finally {
    await h.dispose();
  }
});

test('permanent swap failure settles after old-provider close rejects and reloads on the next send', async () => {
  const h = createSessionManagerTestContext();
  try {
    await createChat(h);
    const original = h.provider.session('provider-1');
    const compactGate = original.deferNextCompaction();
    original.nextCompactResult = { newSessionId: 'provider-7', removedCount: 1 };
    original.nextCloseError = new Error('old provider close failed');
    const resumed = new FakeFactorySession('provider-7', {}, h.calls);
    writeProviderConversation(h.home, 'provider-7', 'C7 compacted');
    h.runtime.loadQueue.set('provider-7', [
      new Error('first adoption failed'),
      new Error('second adoption failed'),
      resumed,
    ]);

    const compacting = h.handle({ type: 'session.compact', appSessionId: 'provider-1' });
    await h.waitForIdle();
    await h.handle({
      type: 'session.send',
      appSessionId: 'provider-1',
      text: 'redeliver after resume',
    });
    compactGate.resolve();
    await compacting;

    assert.equal(h.runtime.loadCalls.filter((call) => call.sessionId === 'provider-7').length, 3);
    assert.ok(
      errorMessages(h, true).includes(
        'Compaction moved this conversation to a new session but reloading it failed: second adoption failed. It will reload on your next message.',
      ),
    );
    assert.equal(
      h.events.some(
        (event) =>
          event.type === 'error' &&
          event.providerSessionId === 'provider-1' &&
          event.recoverable === true &&
          event.message ===
            'Could not fully close the compacted session: old provider close failed',
      ),
      true,
    );
    assert.equal(syncsSummary(h.calls, 'provider-1', 'provider-7'), true);
    assert.equal(callCount(h.calls, 'cleanup', 'session.close', 'provider-1'), 1);
    assert.deepEqual(original.prompts, ['go']);
    assert.deepEqual(resumed.prompts, ['redeliver after resume']);
    assert.equal(sessionUpdates(h.events).at(-1)?.providerSessionId, 'provider-7');
  } finally {
    await h.dispose();
  }
});

test('a swap whose new identity cannot be persisted keeps the queued send off the old provider', async () => {
  const h = createSessionManagerTestContext();
  try {
    await createChat(h);
    const compactGate = h.provider.deferNextCompaction('provider-1');
    h.provider.session('provider-1').nextCompactResult = {
      newSessionId: 'provider-9',
      removedCount: 1,
    };
    h.runtime.loadQueue.set('provider-9', [
      new Error('first adoption failed'),
      new Error('second adoption failed'),
    ]);

    const compacting = h.handle({ type: 'session.compact', appSessionId: 'provider-1' });
    await h.waitForIdle();
    await h.handle({ type: 'session.send', appSessionId: 'provider-1', text: 'must stay queued' });
    h.history.nextSyncError = new Error('history unavailable');
    compactGate.resolve();
    await assert.rejects(compacting, /history unavailable/);
    await h.waitForIdle();

    assert.deepEqual(h.provider.session('provider-1').prompts, ['go']);
    const errors = errorMessages(h, true);
    assert.ok(errors.includes('Could not persist compacted session identity: history unavailable'));
    assert.equal(
      errors.some((message) => /reloading it failed/i.test(message)),
      false,
    );
  } finally {
    await h.dispose();
  }
});

test('Stop reaches the parent and child providers while the daemon compacts them', async () => {
  const h = createSessionManagerTestContext();
  const interrupts = (id: string) => callCount(h.calls, 'provider', 'interrupt', id);
  try {
    await createChat(h, { sessionPurpose: 'mission-control', interactionMode: 'agi' });
    h.history.seedChildSessions([
      {
        parentAppSessionId: 'provider-1',
        childSessionId: 'child-c4',
        providerSessionId: 'worker-c4',
        role: 'worker',
        status: 'paused',
        modelId: 'model-default',
        transcriptAvailable: true,
        updatedAt: Date.now(),
      },
    ]);
    await h.handle({
      type: 'child.open',
      parentAppSessionId: 'provider-1',
      childSessionId: 'child-c4',
      requestId: 'open-child-c4',
    });
    notifyDaemonCompaction(h, 'provider-1', 'started');
    notifyDaemonCompaction(h, 'worker-c4', 'started');

    await h.handle({ type: 'session.interrupt', appSessionId: 'provider-1' });
    await h.handle({
      type: 'child.interrupt',
      parentAppSessionId: 'provider-1',
      childSessionId: 'child-c4',
    });

    assert.deepEqual([interrupts('provider-1'), interrupts('worker-c4')], [1, 1]);
  } finally {
    await h.dispose();
  }
});

test('role model changes retune only the matching live child sessions', async () => {
  const h = createSessionManagerTestContext({
    defaults: {
      modelId: 'model-default',
      workerModelId: 'model-worker-default',
      validatorModelId: 'model-validator-default',
      interactionMode: 'auto',
      autonomy: 'low',
    },
  });
  const parent = new FakeFactorySession('provider-1', {}, h.calls);
  const worker = new FakeFactorySession('worker-c5', {}, h.calls);
  const validator = new FakeFactorySession('validator-c5', {}, h.calls);
  parent.setInitModel('model-parent-loaded');
  worker.setInitModel('model-worker-loaded');
  validator.setInitModel('model-validator-loaded');
  h.runtime.createQueue.push(parent);
  h.runtime.loadQueue.set('worker-c5', [worker]);
  h.runtime.loadQueue.set('validator-c5', [validator]);

  try {
    await h.create({
      sessionPurpose: 'mission-control',
      clientRef: 'c5',
      title: 'C5',
      goal: 'go',
      interactionMode: 'agi',
      autonomy: 'low',
      modelId: 'model-parent-effective',
      workerModel: 'model-worker-fallback',
      validatorModel: 'model-validator-fallback',
    });
    await h.waitForIdle();
    h.history.seedChildSessions([
      {
        parentAppSessionId: 'provider-1',
        childSessionId: 'worker-logical-c5',
        providerSessionId: 'worker-c5',
        role: 'worker',
        status: 'paused',
        modelId: 'model-worker-loaded',
        transcriptAvailable: true,
        updatedAt: Date.now(),
      },
      {
        parentAppSessionId: 'provider-1',
        childSessionId: 'validator-logical-c5',
        providerSessionId: 'validator-c5',
        role: 'validator',
        status: 'paused',
        modelId: 'model-validator-loaded',
        transcriptAvailable: true,
        updatedAt: Date.now(),
      },
    ]);
    await h.handle({
      type: 'child.open',
      parentAppSessionId: 'provider-1',
      childSessionId: 'worker-logical-c5',
      requestId: 'open-worker-c5',
    });
    await h.handle({
      type: 'child.open',
      parentAppSessionId: 'provider-1',
      childSessionId: 'validator-logical-c5',
      requestId: 'open-validator-c5',
    });

    await h.handle({
      type: 'settings.compaction.update',
      compactionTokenLimit: 400,
      compactionTokenLimitPerModel: {
        'model-parent-effective': 100,
        'model-default': 260,
        'model-worker-loaded': 200,
        'model-worker-new': 250,
        'model-worker-default': 260,
        'model-validator-loaded': 300,
        'model-validator-new': 350,
        'model-worker-fallback': 201,
        'model-validator-fallback': 301,
      },
    });
    const compactionWrites = (id: string) =>
      h.provider
        .session(id)
        .settings.filter((settings) => settings['compactionThresholdCheckEnabled'] === true);
    const latestCompactionLimit = (id: string) =>
      compactionWrites(id).at(-1)?.['compactionTokenLimit'];
    assert.equal(latestCompactionLimit('provider-1'), 100);
    assert.equal(latestCompactionLimit('worker-c5'), 200);
    assert.equal(latestCompactionLimit('validator-c5'), 300);

    const parentCompactions = compactionWrites('provider-1').length;
    const validatorCompactions = compactionWrites('validator-c5').length;
    await h.handle({
      type: 'settings.agent.update',
      appSessionId: 'provider-1',
      agent: 'worker',
      modelId: 'model-worker-new',
    });
    assert.equal(latestCompactionLimit('worker-c5'), 250);
    assert.equal(compactionWrites('provider-1').length, parentCompactions);
    assert.equal(compactionWrites('validator-c5').length, validatorCompactions);

    await h.handle({
      type: 'settings.agent.update',
      appSessionId: 'provider-1',
      agent: 'worker',
      modelId: null,
    });
    assert.equal(latestCompactionLimit('worker-c5'), 260);

    const workerCompactions = compactionWrites('worker-c5').length;
    parent.nextUpdateSettingsError = new Error('role default rejected');
    await h.handle({
      type: 'settings.agent.update',
      appSessionId: 'provider-1',
      agent: 'validator',
      modelId: 'model-validator-new',
    });
    assert.equal(compactionWrites('worker-c5').length, workerCompactions);
    assert.equal(compactionWrites('validator-c5').length, validatorCompactions);

    await h.handle({
      type: 'settings.agent.update',
      appSessionId: 'provider-1',
      agent: 'validator',
      modelId: 'model-validator-new',
    });
    assert.equal(latestCompactionLimit('validator-c5'), 350);
    assert.equal(compactionWrites('provider-1').length, parentCompactions);
    assert.equal(compactionWrites('worker-c5').length, workerCompactions);
  } finally {
    await h.dispose();
  }
});

test('a learned context window retunes with the 80% ceiling', async () => {
  const h = createSessionManagerTestContext();
  const custom = new FakeFactorySession('provider-1', {}, h.calls, {
    settings: { modelId: 'custom-model' },
  });
  custom.nextContextStats = {
    used: 100,
    remaining: 9_900,
    limit: 10_000,
    accuracy: ContextStatsAccuracy.Estimated,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  h.runtime.createQueue.push(custom);
  try {
    await createChat(h, { modelId: 'custom-model' });

    // Initial arm: custom-model is absent from the catalog, so there is no
    // window ceiling and the daemon default (250k) is used verbatim.
    assert.equal(compactionArms(h).at(0)?.['compactionTokenLimit'], 250_000);

    // Wait for the poll → refresh → noteContextWindow → retuneAll chain.
    for (let i = 0; i < 5; i++) await h.waitForIdle();

    // After learning the 10k window from provider stats, the retune clamps to
    // 80% (8_000) — the compaction window fraction.
    assert.equal(compactionArms(h).at(-1)?.['compactionTokenLimit'], 8_000);
  } finally {
    await h.dispose();
  }
});

test('an arm failure emits a visible recoverable error and clears the published limit', async () => {
  const h = createSessionManagerTestContext();
  try {
    await createChat(h);
    h.events.length = 0;
    h.provider.session('provider-1').nextUpdateSettingsError = new Error('provider rejected');

    await h.handle({ type: 'settings.compaction.update', compactionTokenLimit: 400 });
    await h.waitForIdle();

    assert.equal(
      h.events.some(
        (event) =>
          event.type === 'error' &&
          event.appSessionId === 'provider-1' &&
          event.recoverable === true &&
          /Could not arm auto-compaction/.test(event.message),
      ),
      true,
    );
    // The summary no longer claims a limit the provider never accepted.
    const latest = sessionUpdates(h.events).at(-1);
    assert.ok(latest);
    assert.equal(latest.compactionTokenLimit, undefined);
  } finally {
    await h.dispose();
  }
});
