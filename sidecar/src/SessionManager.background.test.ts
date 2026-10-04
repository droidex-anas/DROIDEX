import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import type * as Protocol from './protocol.js';
import type { ProcessRecord } from './processes/processTree.js';
import type { SessionFileChange } from './sessionFileCache.js';
import { FakeFactorySession } from './testing/fakeFactoryRuntime.js';
import { writeProviderConversation } from './testing/historyCharacterizationSupport.js';
import {
  chatCommand,
  createSessionManagerTestContext,
  errorEvents,
  historicalSummary,
  providerCloses,
  sessionUpdates,
  type SessionManagerTestContext,
} from './testing/sessionManagerTestContext.js';

// Work the manager does without the user typing: scheduled automation
// prompts, the session list it keeps current, and idle runtimes it releases.

const lists = (h: SessionManagerTestContext) =>
  h.events.filter(
    (event): event is Extract<Protocol.ServerEvent, { type: 'sessions.list' }> =>
      event.type === 'sessions.list',
  );

const listed = (h: SessionManagerTestContext, appSessionId: string): boolean =>
  lists(h)
    .at(-1)
    ?.sessions.some((session) => session.appSessionId === appSessionId) ?? false;

// Scheduled delivery: an automation prompt is reported delivered only once the
// runtime acknowledged it, and a busy target asks to be retried.

const scheduledPrompt = 'Design Mode reference pack:\nScheduled follow-up';

async function readyForScheduled(
  onSessionAvailable?: (appSessionId: string) => void,
  beforeCreate?: (h: SessionManagerTestContext) => void,
) {
  let finish: () => void = () => undefined;
  const initialTurn = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let streaming = false;
  const h = createSessionManagerTestContext({
    ...(onSessionAvailable ? { onSessionAvailable } : {}),
    onEvent: (event) => {
      if (event.type !== 'session.updated') return;
      if (event.session.streaming) streaming = true;
      else if (streaming) finish();
    },
  });
  beforeCreate?.(h);
  await h.create(
    chatCommand('scheduled-target', {
      cwd: h.home,
      goal: 'Initial user prompt',
      title: 'User conversation',
    }),
  );
  await initialTurn;
  return h;
}

const busy = { status: 'busy', retryOn: 'target' };

test('a failure before the runtime acknowledges a scheduled prompt is never reported delivered', async () => {
  const setup = await readyForScheduled();
  try {
    const provider = setup.provider.session('provider-1');
    provider.nextUpdateSettingsError = new Error('Policy setup failed');
    const receipt = await setup.deliverScheduledMessage('provider-1', scheduledPrompt, () => true);
    assert.equal(receipt.status, 'unavailable');
    assert.deepEqual(provider.prompts, ['Initial user prompt']);
    assert.ok(errorEvents(setup.events).some((event) => /Policy setup failed/.test(event.message)));
  } finally {
    await setup.dispose();
  }

  const transport = await readyForScheduled();
  try {
    const provider = transport.provider.session('provider-1');
    provider.nextStreamError = new Error('Transport failed before first response');
    const receipt = await transport.deliverScheduledMessage('provider-1', 'Follow-up', () => true);
    assert.equal(receipt.status, 'unavailable');
    if (receipt.status === 'unavailable') assert.match(receipt.error, /outcome unknown/);
    assert.deepEqual(provider.prompts, ['Initial user prompt', 'Follow-up']);
  } finally {
    await transport.dispose();
  }
});

for (const action of ['cancel', 'close', 'interrupt'] as const) {
  test(`${action} during async provider setup prevents the scheduled send`, async () => {
    const h = await readyForScheduled();
    const provider = h.provider.session('provider-1');
    const settings = provider.deferNextUpdateSettings();
    let current = true;
    try {
      const count = provider.settings.length;
      const delivery = h.deliverScheduledMessage('provider-1', scheduledPrompt, () => current);
      await provider.waitForSettings(count + 1);
      if (action === 'cancel') current = false;
      else
        await h.handle({
          type: action === 'close' ? 'session.close' : 'session.interrupt',
          appSessionId: 'provider-1',
        });
      settings.resolve();
      // Nothing was dispatched, and only the caller withdrawing it is a cancellation.
      assert.equal((await delivery).status, action === 'cancel' ? 'cancelled' : 'unavailable');
      assert.deepEqual(provider.prompts, ['Initial user prompt']);
      if (action === 'cancel') assert.deepEqual(providerCloses(h), []);
    } finally {
      settings.resolve();
      await h.dispose();
    }
  });
}

test('scheduled delivery waits for user settings changes and keeps their effective values', async () => {
  const available: string[] = [];
  const h = await readyForScheduled((id) => {
    available.push(id);
  });
  const provider = h.provider.session('provider-1');
  const gate = provider.deferNextUpdateSettings();
  try {
    const count = provider.settings.length;
    const changing = h.handle({
      type: 'session.updateSettings',
      appSessionId: 'provider-1',
      modelId: 'user-selected-model',
      autonomy: 'medium',
    });
    await provider.waitForSettings(count + 1);
    assert.deepEqual(await h.deliverScheduledMessage('provider-1', 'Later', () => true), busy);
    const eventCount = h.events.length;
    gate.resolve();
    await changing;
    assert.deepEqual(available, ['provider-1']);
    assert.ok(h.events.slice(eventCount).some((event) => event.type === 'session.updated'));
    const receipt = await h.deliverScheduledMessage('provider-1', 'Later', () => true);
    assert.equal(receipt.status, 'accepted');
    if (receipt.status === 'accepted') await receipt.settled;
    const latest = sessionUpdates(h.events, 'provider-1').at(-1);
    assert.equal(latest?.modelId, 'user-selected-model');
    assert.equal(latest?.autonomy, 'medium');
    assert.deepEqual(provider.prompts, ['Initial user prompt', 'Later']);
  } finally {
    gate.resolve();
    await h.dispose();
  }
});

test('manual compaction completion rearms delivery without fabricating a summary update', async () => {
  const available: string[] = [];
  const h = await readyForScheduled((id) => {
    available.push(id);
  });
  const gate = h.provider.session('provider-1').deferNextCompaction();
  try {
    const compacting = h.handle({ type: 'session.compact', appSessionId: 'provider-1' });
    assert.deepEqual(await h.deliverScheduledMessage('provider-1', 'Later', () => true), busy);
    assert.deepEqual(available, []);
    gate.resolve();
    await compacting;
    assert.deepEqual(available, ['provider-1']);
    const receipt = await h.deliverScheduledMessage('provider-1', 'Later', () => true);
    assert.equal(receipt.status, 'accepted');
    if (receipt.status === 'accepted') await receipt.settled;
  } finally {
    gate.resolve();
    await h.dispose();
  }
});

test('only the last pending question response rearms delivery, without protocol noise', async () => {
  const available: string[] = [];
  const h = await readyForScheduled((id) => {
    available.push(id);
  });
  try {
    const ask = h.provider.session('provider-1').handlers.askUserHandler;
    assert.ok(ask);
    const answers = [
      ask({ toolCallId: 'first', questions: [] }),
      ask({ toolCallId: 'last', questions: [] }),
    ];
    const questions = h.events.filter((event) => event.type === 'question.requested');
    assert.equal(questions.length, 2);
    assert.deepEqual(await h.deliverScheduledMessage('provider-1', 'Later', () => true), busy);
    const eventCount = h.events.length;
    for (const [index, event] of questions.entries()) {
      await h.handle({
        type: 'question.respond',
        appSessionId: 'provider-1',
        requestId: event.question.requestId,
        cancelled: true,
        answers: [],
      });
      assert.equal(available.length, index);
    }
    await Promise.all(answers);
    assert.deepEqual(available, ['provider-1']);
    assert.equal(h.events.length, eventCount);
  } finally {
    await h.dispose();
  }
});

test('acknowledged delivery need not wait for turn cleanup', async () => {
  let release: () => void = () => undefined;
  const settlement = new Promise<void>((resolve) => {
    release = resolve;
  });
  let provider: DeferredSettlementSession | undefined;
  class DeferredSettlementSession extends FakeFactorySession {
    waitForSettlement = false;
    override async *stream(text: string, options: Parameters<FakeFactorySession['stream']>[1]) {
      yield* super.stream(text, options);
      if (this.waitForSettlement) await settlement;
    }
  }
  const h = await readyForScheduled(undefined, (context) => {
    provider = new DeferredSettlementSession('provider-delivery', {}, context.calls);
    context.runtime.createQueue.push(provider);
  });
  try {
    assert.ok(provider);
    provider.waitForSettlement = true;
    const receipt = await h.deliverScheduledMessage('provider-delivery', 'Later', () => true);
    assert.equal(receipt.status, 'accepted');
    let settled = false;
    if (receipt.status === 'accepted')
      void receipt.settled.then(() => {
        settled = true;
      });
    await Promise.resolve();
    assert.equal(settled, false);
    release();
    if (receipt.status === 'accepted') await receipt.settled;
    assert.deepEqual(provider.prompts, ['Initial user prompt', 'Later']);
  } finally {
    release();
    await h.dispose();
  }
});

// Session list: the manager wires live sessions, closes, and provider swaps into
// the session-file index; SessionFileServing owns the reconcile rules.

function writeExternalSession(
  home: string,
  id: string,
  cwd: string,
  answer = 'hello',
): SessionFileChange {
  const sessionPath = path.join(home, '.factory', 'sessions', '2026', '08', `${id}.jsonl`);
  mkdirSync(path.dirname(sessionPath), { recursive: true });
  const message = (role: string, text: string) => ({
    type: 'message',
    timestamp: '2026-08-09T00:00:00.000Z',
    message: { role, content: [{ type: 'text', text }] },
  });
  writeFileSync(
    sessionPath,
    [
      {
        type: 'session_start',
        cwd,
        sessionTitle: 'External CLI session',
        settings: { interactionMode: 'auto' },
      },
      message('user', 'the earlier question'),
      message('assistant', answer),
    ]
      .map((line) => JSON.stringify(line))
      .join('\n') + '\n',
  );
  return { providerSessionId: id, path: sessionPath };
}

function withCapturedWatcher(consumeLiveSessionFile: (id: string) => string | undefined) {
  return createSessionManagerTestContext({
    startSessionFileWatcher: () => ({
      liveSessionFile: () => undefined,
      consumeLiveSessionFile,
      close: () => undefined,
    }),
  });
}

test('a live first turn stays visible before the provider writes its response', async () => {
  const h = createSessionManagerTestContext();
  try {
    await h.create(chatCommand('live-first-turn', { cwd: '/tmp/live-first-turn' }));
    await h.handle({ type: 'sessions.list', workspaceCwds: ['/tmp/live-first-turn'] });
    assert.equal(listed(h, 'provider-1'), true);
  } finally {
    await h.dispose();
  }
});

test('closing a live session reconciles its final file before republishing', async () => {
  const workspace = '/tmp/finalized-workspace';
  let finalizedSessionFile: string | undefined;
  const h = withCapturedWatcher(() => finalizedSessionFile);
  try {
    await h.create(chatCommand('finalized-session', { cwd: workspace, goal: 'finish' }));
    finalizedSessionFile = writeExternalSession(h.home, 'provider-1', workspace).path;
    await h.handle({ type: 'sessions.list', workspaceCwds: [workspace] });
    const reconcilesBeforeClose = h.history.fullReconcileCalls;
    const targetedReconcilesBeforeClose = h.history.targetedReconcileCalls.length;

    await h.handle({ type: 'session.close', appSessionId: 'provider-1' });

    assert.equal(
      h.history.fullReconcileCalls,
      reconcilesBeforeClose,
      'an observed live file does not trigger a full sessions-tree walk on close',
    );
    assert.deepEqual(
      h.history.targetedReconcileCalls.slice(targetedReconcilesBeforeClose),
      [[{ providerSessionId: 'provider-1', path: finalizedSessionFile }]],
      'close reconciles only the finalized file after the live registry entry is removed',
    );
    const list = lists(h).at(-1);
    assert.ok(list);
    assert.ok(
      list.sessions.some((session) => session.appSessionId === 'provider-1'),
      'the post-close list retains the newly historical session',
    );
    assert.ok(
      list.sessions.every((session) => session.cwd === workspace),
      'the post-close list preserves the renderer active workspace filter',
    );
  } finally {
    await h.dispose();
  }
});

test('provider replacement finalizes the retired file without treating its alias as live', async () => {
  const consumedProviderSessionIds: string[] = [];
  const retiredPath = '/tmp/provider-1.jsonl';
  const h = withCapturedWatcher((providerSessionId) => {
    consumedProviderSessionIds.push(providerSessionId);
    return providerSessionId === 'provider-1' ? retiredPath : undefined;
  });
  try {
    await h.create(
      chatCommand('compacted-session', { cwd: '/tmp/compacted-workspace', goal: 'compact' }),
    );
    await h.waitForIdle();
    await h.handle({ type: 'sessions.list' });
    const targetedBefore = h.history.targetedReconcileCalls.length;
    h.provider.session('provider-1').nextCompactResult = {
      newSessionId: 'provider-2',
      removedCount: 1,
    };
    h.runtime.loadQueue.set('provider-2', [new FakeFactorySession('provider-2', {}, h.calls)]);

    await h.handle({ type: 'session.compact', appSessionId: 'provider-1' });
    await h.waitForIdle();

    assert.deepEqual(consumedProviderSessionIds, ['provider-1']);
    assert.deepEqual(h.history.targetedReconcileCalls.slice(targetedBefore), [
      [{ providerSessionId: 'provider-1', path: retiredPath }],
    ]);
  } finally {
    await h.dispose();
  }
});

// Idle retirement: the manager supplies each retirement fact from live state;
// sessionRuntimeRetirement owns the policy.

const focusElsewhere = (h: SessionManagerTestContext): Promise<void> =>
  h.handle({ type: 'app.backgroundWork', tier: 'interactive', focusedAppSessionId: 'other' });

async function openIdleSession(h: SessionManagerTestContext, clientRef: string): Promise<string> {
  await h.create(chatCommand(clientRef, { goal: `first turn for ${clientRef}` }));
  const created = h.events.find(
    (event) => event.type === 'session.created' && event.clientRef === clientRef,
  );
  assert.ok(created?.type === 'session.created');
  assert.equal(created.session.providerSessionId, created.session.appSessionId);
  await h.waitForIdle();
  return created.session.appSessionId;
}

const appendedTexts = (h: SessionManagerTestContext, appSessionId: string): string[] =>
  h.events.flatMap((event) =>
    event.type === 'event.appended' && event.event.appSessionId === appSessionId
      ? [event.event.text ?? '']
      : [],
  );

test('a turn, an open browser, or an unapplied model choice keeps a session from retiring', async () => {
  const h = createSessionManagerTestContext({ sessionRuntimeIdleMs: 0 });
  try {
    const session = await openIdleSession(h, 'held');
    await focusElsewhere(h);

    const streamGate = h.provider.deferNextStream(session);
    const sending = h.handle({ type: 'session.send', appSessionId: session, text: 'keep working' });
    await h.provider.waitForPrompts(session, 2);
    await h.retireIdleSessionRuntimes();
    assert.deepEqual(providerCloses(h), [], 'an in-flight turn must never be retired');
    streamGate.resolve();
    await sending;
    await h.waitForIdle();

    await h.handle({ type: 'browser.open', appSessionId: session, url: 'https://example.test' });
    await h.retireIdleSessionRuntimes();
    assert.deepEqual(providerCloses(h), [], 'an open browser must never be retired');
    await h.handle({ type: 'browser.close', appSessionId: session });

    const settingsGate = h.provider.deferNextUpdateSettings(session);
    const updating = h.handle({
      type: 'settings.agent.update',
      appSessionId: session,
      agent: 'primary',
      modelId: 'model-alt',
    });
    await h.retireIdleSessionRuntimes();
    assert.deepEqual(providerCloses(h), [], 'a pending model choice would be dropped by a close');
    settingsGate.resolve();
    await updating;

    await h.retireIdleSessionRuntimes();
    assert.deepEqual(providerCloses(h), [session]);
  } finally {
    await h.dispose();
  }
});

test('an idle session whose child agent is still working is never retired', async () => {
  const h = createSessionManagerTestContext({ sessionRuntimeIdleMs: 0 });
  try {
    h.fixture.seedHistorySummaries([historicalSummary('app-parent', 'provider-parent')]);
    h.fixture.seedChildSessions([
      {
        parentAppSessionId: 'app-parent',
        childSessionId: 'worker-1',
        role: 'worker',
        status: 'paused',
        modelId: 'model-default',
        transcriptAvailable: true,
        streamFidelity: 'state',
      },
    ]);
    writeProviderConversation(h.home, 'provider-parent', 'parent');
    await h.handle({ type: 'session.resume', appSessionId: 'app-parent' });
    await h.handle({
      type: 'child.open',
      parentAppSessionId: 'app-parent',
      childSessionId: 'worker-1',
      requestId: 'open-worker-1',
    });
    await focusElsewhere(h);

    // The parent's own turn is idle: only the child is working.
    const gate = h.provider.deferNextStream('worker-1');
    const sending = h.handle({
      type: 'child.send',
      parentAppSessionId: 'app-parent',
      childSessionId: 'worker-1',
      text: 'keep working',
    });
    await h.provider.waitForPrompts('worker-1', 1);

    await h.retireIdleSessionRuntimes();
    assert.deepEqual(providerCloses(h), [], 'retiring a parent would close its child subtree');

    gate.resolve();
    await sending;
    await h.waitForIdle();

    await h.retireIdleSessionRuntimes();
    assert.equal(
      providerCloses(h).includes('provider-parent'),
      true,
      'the parent becomes retirable once its children settle',
    );
  } finally {
    await h.dispose();
  }
});

test('a session whose agent left a dev server running is never retired', async (t) => {
  // `droid` and the dev server it spawned. Retiring the session closes the
  // provider, which kills the whole tree, so the server has to hold it open.
  const table: ProcessRecord[] = [
    { pid: 600, ppid: 1, startedAt: 0, command: '/usr/local/bin/droid' },
    { pid: 700, ppid: 600, startedAt: 0, command: 'node ./node_modules/.bin/vite dev' },
  ];
  const killed: number[] = [];
  const h = createSessionManagerTestContext({
    sessionRuntimeIdleMs: 0,
    agentProcessHost: {
      listProcesses: () => Promise.resolve([...table]),
      listListeningPorts: () => Promise.resolve(new Map([[700, [5173]]])),
      kill: (pid) => {
        killed.push(pid);
      },
    },
  });
  try {
    h.fixture.seedHistorySummaries([historicalSummary('app-parent', 'provider-parent')]);
    writeProviderConversation(h.home, 'provider-parent', 'parent');
    h.runtime.processIds.set('provider-parent', 600);
    await h.handle({ type: 'session.resume', appSessionId: 'app-parent' });
    await focusElsewhere(h);
    await h.scanAgentProcesses();

    await h.retireIdleSessionRuntimes();
    assert.deepEqual(providerCloses(h), [], 'retiring would kill the running dev server');
    assert.deepEqual(killed, [], 'a retirement that never happened must signal nothing');
    const published = h.events.findLast(
      (event): event is Extract<Protocol.ServerEvent, { type: 'session.processes' }> =>
        event.type === 'session.processes',
    );
    assert.deepEqual(
      published?.processes.map((entry) => [entry.pid, entry.name, entry.ports]),
      [[700, 'vite dev', [5173]]],
      'the renderer must be told what the session is holding',
    );

    // A fresh renderer needs the current processes even when the monitor
    // has nothing new to publish.
    const beforeList = h.events.length;
    await h.handle({ type: 'sessions.list' });
    assert.deepEqual(
      h.events
        .slice(beforeList)
        .flatMap((event) => (event.type === 'sessions.processes' ? [event.processes] : [])),
      [{ 'app-parent': published?.processes }],
    );

    // The user stops the server themselves: the process publish has to re-arm
    // the retirement wakeup the dev server cancelled, or nothing would retire it.
    t.mock.timers.enable({ apis: ['setTimeout'] });
    table.splice(1, 1);
    await h.scanAgentProcesses();
    t.mock.timers.tick(1);
    await h.waitForIdle();
    assert.deepEqual(providerCloses(h), ['provider-parent']);
  } finally {
    t.mock.timers.reset();
    await h.dispose();
  }
});

test('a settled background session past the budget is released, says why, and reopens on the next prompt', async () => {
  const h = createSessionManagerTestContext({ sessionRuntimeIdleMs: 0 });
  try {
    const session = await openIdleSession(h, 'reopened');
    h.fixture.publishSessionFiles([
      writeExternalSession(h.home, session, h.home, 'the earlier answer'),
    ]);
    await focusElsewhere(h);
    await h.retireIdleSessionRuntimes();
    assert.deepEqual(providerCloses(h), [session]);
    assert.equal(
      h.events.some((event) => event.type === 'session.closed' && event.appSessionId === session),
      true,
      'the client must learn the runtime is gone',
    );
    assert.ok(
      appendedTexts(h, session).some((text) => /released after 30 minutes idle/.test(text)),
      'a retired session must leave a visible reason in its transcript',
    );

    await h.handle({ type: 'session.loadHistory', appSessionId: session });
    const history = h.events.find(
      (event): event is Extract<Protocol.ServerEvent, { type: 'session.history' }> =>
        event.type === 'session.history' && event.appSessionId === session,
    );
    assert.ok(history, 'a retired session must still serve its persisted transcript');
    assert.equal(
      history.transcripts.some((event) => (event.text ?? '').includes('the earlier answer')),
      true,
      'the reopened transcript must still contain the earlier turn',
    );
    await h.handle({ type: 'sessions.list' });
    assert.equal(listed(h, session), true, 'a retired session must stay in the sidebar');

    await h.handle({ type: 'session.send', appSessionId: session, text: 'back again' });
    await h.provider.waitForPrompts(session, 1);
    assert.deepEqual(
      h.runtime.loadCalls.map((call) => call.sessionId),
      [session],
      'the next prompt reloads the same provider session',
    );
    assert.deepEqual(h.provider.session(session).prompts, ['back again']);
  } finally {
    await h.dispose();
  }
});

test('selecting a retired chat starts its runtime again before any prompt', async () => {
  const h = createSessionManagerTestContext({ sessionRuntimeIdleMs: 0 });
  try {
    const session = await openIdleSession(h, 'reselected');
    writeProviderConversation(h.home, session, 'reselected');
    await focusElsewhere(h);
    await h.retireIdleSessionRuntimes();
    assert.deepEqual(providerCloses(h), [session]);

    await h.handle({
      type: 'app.backgroundWork',
      tier: 'interactive',
      focusedAppSessionId: session,
    });
    await h.warmSelectedSessionRuntime();

    assert.deepEqual(
      h.runtime.loadCalls.map((call) => call.sessionId),
      [session],
      'selecting the chat reloads its runtime without waiting for a prompt',
    );
    assert.deepEqual(h.provider.session(session).prompts, [], 'a warm-up must not start a turn');
    assert.deepEqual(
      appendedTexts(h, session).filter((text) => /Starting|Resuming|warm/i.test(text)),
      [],
      'a warm-up must not write a row into the transcript',
    );

    await h.handle({ type: 'session.send', appSessionId: session, text: 'instant' });
    await h.provider.waitForPrompts(session, 1);
    assert.deepEqual(
      h.runtime.loadCalls.map((call) => call.sessionId),
      [session],
      'the send reuses the warmed runtime rather than reloading it again',
    );
  } finally {
    await h.dispose();
  }
});

test('a prompt that lands while the runtime is being released still reaches the session', async () => {
  const h = createSessionManagerTestContext({ sessionRuntimeIdleMs: 0 });
  try {
    const session = await openIdleSession(h, 'racing');
    writeProviderConversation(h.home, session, 'racing');
    await focusElsewhere(h);

    const retiring = h.retireIdleSessionRuntimes();
    const sending = h.handle({ type: 'session.send', appSessionId: session, text: 'mid-release' });
    await retiring;
    await sending;
    await h.provider.waitForPrompts(session, 1);

    assert.deepEqual(
      h.runtime.loadCalls.map((call) => call.sessionId),
      [session],
      'the send must wait for the release and reopen rather than vanish',
    );
    assert.deepEqual(h.provider.session(session).prompts, ['mid-release']);
  } finally {
    await h.dispose();
  }
});
