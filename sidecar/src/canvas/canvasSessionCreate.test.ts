import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { McpServerConfigSchema } from '@factory/droid-sdk';
import { CanvasScopes } from './canvasScopes.js';
import { CanvasTurns } from './canvasTurnContext.js';
import { CanvasWorkspace } from './CanvasWorkspace.js';
import { prepareSessionFirstTurn } from './canvasSessionCreate.js';
import { DEFAULT_DESIGN_SYSTEM_REF } from './designSystems.js';
import {
  canvasRoot,
  deferred,
  holdManifestWrite,
  quietBuilds,
} from '../testing/canvasStorageSupport.js';
import { writeProviderConversation } from '../testing/historyCharacterizationSupport.js';
import { FakeFactorySession } from '../testing/fakeFactoryRuntime.js';
import {
  chatCommand,
  createSessionManagerTestContext,
  errorEvents,
  historicalSummary,
} from '../testing/sessionManagerTestContext.js';

for (const target of ['new', 'saved'] as const) {
  test(`${target} Design canvas is attached before publication and the first prompt's lease`, async (t) => {
    const scopes = new CanvasScopes();
    const turns = new CanvasTurns(scopes, (id) => workspace.attachedCanvasId(id));
    const projectBindings: string[] = [];
    let publication: { canvasId: string | null; prompts: number } | undefined;
    const h = createSessionManagerTestContext({
      canvasTurns: turns,
      beforeFirstTurn: (session, clientRef, intent, admission) =>
        prepareSessionFirstTurn(
          session,
          { clientRef, canvas: intent },
          {
            beforeFirstTurn: async (_session, ref) => {
              projectBindings.push(ref);
            },
          },
          Promise.resolve(workspace),
          (event) => {
            h.events.push(event);
          },
          admission,
        ),
      onEvent: (event) => {
        if (event.type === 'session.created') {
          publication = {
            canvasId: workspace.attachedCanvasId(event.session.appSessionId),
            prompts: h.provider.session('design-chat').prompts.length,
          };
        }
      },
    });
    t.after(() => h.dispose());
    const workspace = await CanvasWorkspace.open(await canvasRoot(t), quietBuilds(), {
      isChatKnown: () => true,
      isScopeActive: (id) => scopes.isScopeActive(id),
      bindScopeCanvas: (id, canvasId) => scopes.bindScopeCanvas(id, canvasId),
    });
    t.after(() => workspace.close());
    const saved =
      target === 'saved' ? (await workspace.createCanvas('saved-chat', 'saved')).canvasId : null;
    const provider = new FakeFactorySession('design-chat', {}, h.calls);
    const gate = provider.deferNextStream();
    h.runtime.createQueue.push(provider);
    await h.create(
      chatCommand('design', {
        canvas: { canvasId: saved, name: 'Pricing', mutationId: 'design-mutation' },
      }),
    );
    assert.ok(publication?.canvasId);
    assert.equal(publication.prompts, 0);
    assert.deepEqual(projectBindings, ['design']);
    const createdEvent = h.events.find((event) => event.type === 'session.created');
    assert.ok(createdEvent?.type === 'session.created');
    assert.equal(createdEvent.session.sessionPurpose, 'design');
    assert.equal(
      h.history.summaryPatchesAndHidden().patches.get('design-chat')?.sessionPurpose,
      'design',
    );
    await provider.waitForPrompts(1);
    const canvasId = workspace.attachedCanvasId('design-chat');
    assert.ok(canvasId);
    if (saved) assert.equal(canvasId, saved);
    const scope = turns.activeScope('design-chat');
    assert.ok(scope);
    assert.equal(scope.canvasId, canvasId);
    assert.equal(publication.canvasId, canvasId);
    assert.deepEqual(provider.prompts, ['hello']);
    // The model's first create adds frames to the pane's canvas, never another board.
    const created = await workspace.create(scope, {
      mutationId: 'model-first-create',
      frames: [{ name: 'Card', width: 720, height: 720, designSystem: DEFAULT_DESIGN_SYSTEM_REF }],
    });
    assert.equal(created.canvasId, canvasId);
    assert.equal(workspace.listCanvases().length, 1);
    if (target === 'new') {
      await workspace.createCanvas('design-chat', 'design-mutation');
      assert.equal(workspace.listCanvases().length, 1);
      assert.equal(workspace.attachedCanvasId('design-chat'), canvasId);
    }
    gate.resolve();
    await h.waitForIdle();
    h.fixture.seedHistorySummaries([createdEvent.session]);
    writeProviderConversation(h.home, 'design-chat', 'Design chat');
    await h.handle({ type: 'session.close', appSessionId: 'design-chat' });
    await h.handle({ type: 'session.resume', appSessionId: 'design-chat' });
    const reopened = h.events.findLast((event) => event.type === 'session.created');
    assert.ok(reopened?.type === 'session.created');
    assert.equal(reopened.session.sessionPurpose, 'design');
  });
}

test('a failed initial Canvas attachment fails the open and releases the session', async (t) => {
  const h = createSessionManagerTestContext({
    beforeFirstTurn: (session, ref, intent, admission) =>
      prepareSessionFirstTurn(
        session,
        { clientRef: ref, canvas: intent },
        { beforeFirstTurn: async () => undefined },
        Promise.resolve(workspace),
        () => undefined,
        admission,
      ),
  });
  t.after(() => h.dispose());
  const workspace = await CanvasWorkspace.open(await canvasRoot(t), quietBuilds(), {
    isChatKnown: () => true,
    isScopeActive: () => false,
    bindScopeCanvas: () => undefined,
  });
  t.after(() => workspace.close());
  const provider = new FakeFactorySession('failed-chat', {}, h.calls);
  h.runtime.createQueue.push(provider);
  await h.create(
    chatCommand('failed-design', {
      canvas: { canvasId: 'missing-canvas', mutationId: 'failed-mutation' },
    }),
  );
  assert.deepEqual(
    errorEvents(h.events).map(({ code, clientRef, message }) => ({ code, clientRef, message })),
    [
      {
        code: 'session.create_failed',
        clientRef: 'failed-design',
        message: 'That canvas is not open.',
      },
    ],
  );
  assert.equal(
    h.events.some((event) => event.type === 'session.created'),
    false,
  );
  assert.deepEqual(provider.prompts, []);
  assert.ok(
    h.calls.some((call) => call.method === 'session.close' && call.args[0] === 'failed-chat'),
  );
  assert.ok(h.mcpServerCloseCalls > 0);
  await h.handle({ type: 'sessions.list', includePlainChats: true });
  const listed = h.events.findLast((event) => event.type === 'sessions.list');
  assert.ok(listed?.type === 'sessions.list');
  assert.equal(
    listed.sessions.some((session) => session.appSessionId === 'failed-chat'),
    false,
  );
  assert.deepEqual(workspace.listCanvases(), []);
});

test('a cancelled create cannot attach to or clean up a resumed replacement', async (t) => {
  const binding = deferred();
  const entered = deferred();
  const h = createSessionManagerTestContext({
    beforeFirstTurn: (session, clientRef, intent, admission) =>
      prepareSessionFirstTurn(
        session,
        { clientRef, canvas: intent },
        {
          beforeFirstTurn: async () => {
            entered.resolve();
            await binding.promise;
          },
        },
        Promise.resolve(workspace),
        (event) => h.events.push(event),
        admission,
      ),
  });
  t.after(() => h.dispose());
  const workspace = await CanvasWorkspace.open(await canvasRoot(t), quietBuilds(), {
    isChatKnown: () => true,
    isScopeActive: () => false,
    bindScopeCanvas: () => undefined,
  });
  t.after(() => workspace.close());
  const original = new FakeFactorySession('replaced-chat', {}, h.calls);
  const replacement = new FakeFactorySession('replaced-chat', {}, h.calls);
  h.runtime.createQueue.push(original);
  h.runtime.loadQueue.set('replaced-chat', [replacement]);
  writeProviderConversation(h.home, 'replaced-chat', 'Resumable chat');
  h.fixture.seedHistorySummaries([historicalSummary('replaced-chat', 'replaced-chat')]);
  const creating = h.create(
    chatCommand('cancelled', {
      goal: '',
      canvas: { canvasId: null, mutationId: 'cancelled-canvas' },
    }),
  );
  await entered.promise;
  const waitingResume = h.handle({ type: 'session.resume', appSessionId: 'replaced-chat' });
  const waitingSend = h.handle({
    type: 'session.send',
    appSessionId: 'replaced-chat',
    text: 'Cancelled prompt',
  });
  try {
    await h.handle({ type: 'session.close', appSessionId: 'replaced-chat' });
    await Promise.all([waitingResume, waitingSend]);
    assert.equal(
      h.events.some((event) => event.type === 'session.created'),
      false,
    );
    await h.handle({ type: 'session.resume', appSessionId: 'replaced-chat' });
    assert.ok(
      h.events.some(
        (event) => event.type === 'session.created' && event.clientRef === 'resume:replaced-chat',
      ),
    );
    const chosen = await workspace.createCanvas('replaced-chat', 'replacement-canvas');
    const cleanupCount = h.calls.filter((call) => call.target === 'cleanup').length;
    binding.resolve();
    await creating;
    await Promise.all([waitingResume, waitingSend]);
    assert.equal(workspace.attachedCanvasId('replaced-chat'), chosen.canvasId);
    assert.equal(workspace.listCanvases().length, 1);
    assert.equal(h.calls.filter((call) => call.target === 'cleanup').length, cleanupCount);
    assert.deepEqual(original.prompts, []);
    assert.equal(h.events.filter((event) => event.type === 'canvas.summaries').length, 0);
  } finally {
    binding.resolve();
    await creating;
  }
});

test('resume and send wait for Canvas preparation so the first model create uses one board', async (t) => {
  const binding = deferred();
  const entered = deferred();
  const scopes = new CanvasScopes();
  const turns = new CanvasTurns(scopes, (id) => workspace.attachedCanvasId(id));
  const h = createSessionManagerTestContext({
    canvasTurns: turns,
    beforeFirstTurn: (session, clientRef, intent, admission) =>
      prepareSessionFirstTurn(
        session,
        { clientRef, canvas: intent },
        {
          beforeFirstTurn: async () => {
            entered.resolve();
            await binding.promise;
          },
        },
        Promise.resolve(workspace),
        (event) => h.events.push(event),
        admission,
      ),
  });
  t.after(() => h.dispose());
  const workspace = await CanvasWorkspace.open(await canvasRoot(t), quietBuilds(), {
    isChatKnown: () => true,
    isScopeActive: (id) => scopes.isScopeActive(id),
    bindScopeCanvas: (id, canvasId) => scopes.bindScopeCanvas(id, canvasId),
  });
  t.after(() => workspace.close());
  const provider = new FakeFactorySession('pending-chat', {}, h.calls);
  const stream = provider.deferNextStream();
  h.runtime.createQueue.push(provider);
  const creating = h.create(
    chatCommand('pending', {
      goal: '',
      canvas: { canvasId: null, mutationId: 'pending-canvas' },
    }),
  );
  await entered.promise;
  await h.handle({ type: 'sessions.list', includePlainChats: true });
  const listed = h.events.findLast((event) => event.type === 'sessions.list');
  assert.ok(listed?.type === 'sessions.list');
  assert.ok(listed.sessions.some((session) => session.appSessionId === 'pending-chat'));
  const resuming = h.handle({ type: 'session.resume', appSessionId: 'pending-chat' });
  const sending = h.handle({
    type: 'session.send',
    appSessionId: 'pending-chat',
    text: 'Build a card',
  });
  try {
    await h.waitForIdle();
    assert.equal(
      h.events.some((event) => event.type === 'session.created'),
      false,
    );
    assert.deepEqual(provider.prompts, []);
    binding.resolve();
    await Promise.all([creating, resuming]);
    await provider.waitForPrompts(1);
    const scope = turns.activeScope('pending-chat');
    assert.ok(scope?.canvasId);
    const result = await workspace.create(scope, {
      mutationId: 'first-model-create',
      frames: [{ name: 'Card', width: 720, height: 720, designSystem: DEFAULT_DESIGN_SYSTEM_REF }],
    });
    assert.equal(result.canvasId, scope.canvasId);
    assert.equal(workspace.attachedCanvasId('pending-chat'), scope.canvasId);
    assert.equal(workspace.listCanvases().length, 1);
    const publications = h.events.filter((event) => event.type === 'session.created');
    assert.equal(publications.length, 2);
    assert.deepEqual(provider.prompts, ['Build a card']);
  } finally {
    binding.resolve();
    stream.resolve();
    await Promise.all([creating, resuming, sending]);
  }
});

for (const stage of ['prepared', 'published'] as const) {
  test(`close drains a ${stage} Canvas commit before admitting a replacement`, async (t) => {
    const write = holdManifestWrite(stage);
    const h = createSessionManagerTestContext({
      beforeFirstTurn: (session, clientRef, intent, admission) =>
        prepareSessionFirstTurn(
          session,
          { clientRef, canvas: intent },
          { beforeFirstTurn: async () => undefined },
          Promise.resolve(workspace),
          (event) => h.events.push(event),
          admission,
        ),
    });
    t.after(() => h.dispose());
    const workspace = await CanvasWorkspace.open(await canvasRoot(t), quietBuilds(), {
      isChatKnown: () => true,
      isScopeActive: () => false,
      bindScopeCanvas: () => undefined,
      fs: write.fs,
    });
    t.after(() => workspace.close());
    const original = new FakeFactorySession('closing-chat', {}, h.calls);
    h.runtime.createQueue.push(original);
    writeProviderConversation(h.home, 'closing-chat', 'Resumable chat');
    h.fixture.seedHistorySummaries([historicalSummary('closing-chat', 'closing-chat')]);
    write.arm();
    const creating = h.create(
      chatCommand('closing', {
        goal: '',
        canvas: { canvasId: null, mutationId: 'closing-canvas' },
      }),
    );
    await write.reached;
    let closed = false;
    const closing = h.handle({ type: 'session.close', appSessionId: 'closing-chat' }).then(() => {
      closed = true;
    });
    const resuming = h.handle({ type: 'session.resume', appSessionId: 'closing-chat' });
    try {
      await h.waitForIdle();
      assert.equal(closed, false);
      assert.equal(
        h.events.some((event) => event.type === 'session.created'),
        false,
      );
      write.release();
      await Promise.all([creating, closing, resuming]);
      assert.ok(
        h.events.some(
          (event) => event.type === 'session.created' && event.clientRef === 'resume:closing-chat',
        ),
      );
      assert.deepEqual(original.prompts, []);
      assert.equal(workspace.listCanvases().length, stage === 'published' ? 1 : 0);
      const chosen = await workspace.createCanvas('closing-chat', 'chosen-after-close');
      assert.equal(workspace.attachedCanvasId('closing-chat'), chosen.canvasId);
      assert.equal(h.events.filter((event) => event.type === 'canvas.summaries').length, 0);
    } finally {
      write.release();
      await Promise.all([creating, closing, resuming]);
    }
  });
}

test('cancelling a queued Canvas create releases cleanup before an unrelated write finishes', async (t) => {
  const write = holdManifestWrite('prepared');
  const enqueued = deferred();
  let ownSettled = false;
  const h = createSessionManagerTestContext({
    beforeFirstTurn: (session, clientRef, canvas, admission) =>
      prepareSessionFirstTurn(
        session,
        { clientRef, canvas },
        { beforeFirstTurn: async () => undefined },
        Promise.resolve(workspace),
        (event) => h.events.push(event),
        admission,
      ),
  });
  t.after(() => h.dispose());
  const workspace = await CanvasWorkspace.open(await canvasRoot(t), quietBuilds(), {
    isChatKnown: () => true,
    isScopeActive: () => false,
    bindScopeCanvas: () => undefined,
    fs: write.fs,
  });
  t.after(() => workspace.close());
  const createCanvas = workspace.createCanvas.bind(workspace);
  t.mock.method(workspace, 'createCanvas', (...args: Parameters<typeof createCanvas>) => {
    const pending = createCanvas(...args);
    if (args[0] === 'queued-chat') {
      enqueued.resolve();
      void pending.then(
        () => {
          ownSettled = true;
        },
        () => {
          ownSettled = true;
        },
      );
    }
    return pending;
  });
  h.runtime.createQueue.push(new FakeFactorySession('queued-chat', {}, h.calls));
  writeProviderConversation(h.home, 'queued-chat', 'Resumable chat');
  h.fixture.seedHistorySummaries([historicalSummary('queued-chat', 'queued-chat')]);
  write.arm();
  const unrelated = workspace.createCanvas('other-chat', 'unrelated-write');
  await write.reached;
  const creating = h.create(
    chatCommand('queued', { goal: '', canvas: { canvasId: null, mutationId: 'queued-canvas' } }),
  );
  await enqueued.promise;
  const closing = h.handle({ type: 'session.close', appSessionId: 'queued-chat' });
  try {
    await h.waitForIdle();
    assert.equal(ownSettled, true);
    await Promise.all([creating, closing]);
    assert.ok(
      h.calls.some((call) => call.method === 'session.close' && call.args[0] === 'queued-chat'),
    );
    await h.handle({ type: 'session.resume', appSessionId: 'queued-chat' });
    assert.ok(
      h.events.some(
        (event) => event.type === 'session.created' && event.clientRef === 'resume:queued-chat',
      ),
    );
  } finally {
    write.release();
    await Promise.all([unrelated, creating, closing]);
  }
  assert.equal(workspace.listCanvases().length, 1);
  assert.equal(workspace.attachedCanvasId('queued-chat'), null);
});

test('a configured Canvas name collision closes servers started earlier in admission', async () => {
  const h = createSessionManagerTestContext({
    configuredMcpServers: [
      McpServerConfigSchema.parse({
        type: 'http',
        name: 'DROIDEX_CANVAS',
        url: 'https://example.test/mcp',
      }),
    ],
  });
  try {
    await h.create(chatCommand('collision'));
    assert.equal(h.runtime.createCalls.length, 0);
    assert.equal(h.mcpServerCloseCalls, 1);
    assert.match(JSON.stringify(errorEvents(h.events)), /reserved by DROIDEX/);
  } finally {
    await h.dispose();
  }
});

test('closing while a local MCP server starts releases it before a provider opens', async () => {
  let releaseStart = (): void => undefined;
  let signalStart = (): void => undefined;
  const held = new Promise<void>((resolve) => {
    releaseStart = resolve;
  });
  const started = new Promise<void>((resolve) => {
    signalStart = resolve;
  });
  let closes = 0;
  const h = createSessionManagerTestContext({
    createLocalMcpResource: () => ({
      start: async () => {
        signalStart();
        await held;
        return McpServerConfigSchema.parse({
          type: 'http',
          name: 'test-browser',
          url: 'http://127.0.0.1/test',
        });
      },
      close: async () => {
        closes += 1;
      },
    }),
  });
  try {
    const opening = h.create(chatCommand('closing'));
    await started;
    const closing = h.shutdown();
    releaseStart();
    await Promise.all([opening, closing]);
    assert.equal(closes, 1);
    assert.equal(h.runtime.createCalls.length, 0);
  } finally {
    releaseStart();
    await h.dispose();
  }
});

test('an app-owned chat with incomplete native history refuses resume without losing Design metadata', async () => {
  const h = createSessionManagerTestContext();
  try {
    const id = 'unfinished-design';
    h.fixture.seedHistorySummaries([{ ...historicalSummary(id, id), sessionPurpose: 'design' }]);
    writeProviderConversation(h.home, id, 'Unfinished design');
    writeFileSync(
      path.join(h.home, '.factory', 'sessions', `${id}.jsonl`),
      JSON.stringify({ type: 'session_start', sessionId: id, cwd: '/workspace' }) + '\n',
    );
    const before = h.history.summaryPatchesAndHidden().patches.get(id);

    await h.handle({ type: 'session.resume', appSessionId: id });

    assert.equal(h.runtime.loadCalls.length, 0);
    assert.equal(
      h.events.some((event) => event.type === 'session.created'),
      false,
    );
    assert.match(errorEvents(h.events)[0]?.message ?? '', /missing or incomplete/);
    assert.deepEqual(h.history.summaryPatchesAndHidden().patches.get(id), before);
  } finally {
    await h.dispose();
  }
});
