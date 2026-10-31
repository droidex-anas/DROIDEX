import assert from 'node:assert/strict';
import test from 'node:test';
import { CanvasWorkspace } from './canvas/CanvasWorkspace.js';
import { prepareSessionFirstTurn } from './canvas/canvasSessionCreate.js';
import { AUTO_DESIGN_SYSTEM_REF } from './canvas/designSystems.js';
import { SessionVoice } from './providers/SessionVoice.js';
import { canvasRoot, deferred, quietBuilds } from './testing/canvasStorageSupport.js';
import { FakeFactorySession } from './testing/fakeFactoryRuntime.js';
import {
  createCommand,
  createHarness,
  delegatingProvider,
  requireLive,
  turnLease,
} from './testing/sessionLifecycleHarness.js';

test('voice and delegated turns wait for the captured Canvas create before leasing', async (t) => {
  const entered = deferred();
  const binding = deferred();
  const h = createHarness(
    [],
    (session, clientRef, canvas, admission) =>
      prepareSessionFirstTurn(
        session,
        { clientRef, canvas },
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
    {},
    (id) => workspace.attachedCanvasId(id),
  );
  const workspace = await CanvasWorkspace.open(await canvasRoot(t), quietBuilds(), {
    isChatKnown: () => true,
    isScopeActive: (id) => h.canvasScopes.isScopeActive(id),
    bindScopeCanvas: (id, canvasId) => h.canvasScopes.bindScopeCanvas(id, canvasId),
  });
  t.after(() => workspace.close());
  const session = new FakeFactorySession('spoken', {}, h.calls);
  let notify: (running: boolean) => void = () => undefined;
  let starts = 0;
  const provider = delegatingProvider(h, session, (listener) => {
    notify = listener;
  });
  const create = provider.create.bind(provider);
  h.setProvider({
    ...provider,
    create: async (input) => ({
      ...(await create(input)),
      voice: {
        isLive: () => starts > 0,
        listVoices: async () => ({ voices: [] }),
        onEvent: () => () => undefined,
        start: async () => {
          starts += 1;
        },
        stop: async () => {
          notify(false);
        },
      },
    }),
  });
  const voice = new SessionVoice({
    liveSession: (id) => h.registry.getLive(id)?.session,
    ensureRunning: async (id) => (await h.lifecycle.prepareTurn(id))?.session,
    emit: (event) => h.events.push(event),
    appendTranscript: () => undefined,
    liveChanged: () => undefined,
  });
  const creating = h.lifecycle.create({
    ...createCommand(),
    goal: '',
    canvas: { canvasId: null, mutationId: 'spoken-canvas' },
  });
  await entered.promise;
  const starting = voice.handle({
    type: 'voice.start',
    appSessionId: 'spoken',
    sdp: 'offer',
    attempt: 'attempt-1',
  });
  try {
    notify(true);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(starts, 0);
    assert.equal(h.canvasTurns.activeScope('spoken'), undefined);
    assert.equal(
      h.events.some((event) => event.type === 'session.created'),
      false,
    );
    binding.resolve();
    await Promise.all([creating, starting]);
    const scope = h.canvasTurns.activeScope('spoken');
    assert.ok(scope?.canvasId);
    const created = await workspace.create(scope, {
      mutationId: 'spoken-model-create',
      frames: [{ name: 'Spoken', width: 720, height: 720, designSystem: AUTO_DESIGN_SYSTEM_REF }],
    });
    assert.equal(created.canvasId, workspace.attachedCanvasId('spoken'));
    assert.equal(workspace.listCanvases().length, 1);
    notify(false);
    assert.throws(() => h.canvasTurns.requireScope(scope.scopeId), { code: 'scope_expired' });
    assert.equal(h.canvasTurns.activeScope('spoken'), undefined);
  } finally {
    binding.resolve();
    await Promise.all([creating, starting]);
    await h.lifecycle.closeAll();
  }
});

for (const pendingRunning of [false, true]) {
  test(`pending delegated running=${String(pendingRunning)} is reconciled before typed turns start`, async () => {
    const entered = deferred();
    const binding = deferred();
    const h = createHarness([], async () => {
      entered.resolve();
      await binding.promise;
    });
    const session = new FakeFactorySession('pending-delegated', {}, h.calls);
    let notify: (running: boolean) => void = () => undefined;
    h.setProvider(
      delegatingProvider(h, session, (listener) => {
        notify = listener;
      }),
    );
    const first = session.deferNextStream();
    const second = session.deferNextStream();
    const third = session.deferNextStream();
    const creating = h.lifecycle.create(createCommand('initial'));
    await entered.promise;
    notify(true);
    if (!pendingRunning) notify(false);
    try {
      assert.equal(h.canvasTurns.activeScope('pending-delegated'), undefined);
      binding.resolve();
      await creating;
      if (pendingRunning) {
        assert.deepEqual(session.prompts, []);
        const delegated = turnLease(h, 'pending-delegated');
        notify(false);
        assert.throws(() => h.canvasTurns.requireScope(delegated.scopeId), {
          code: 'scope_expired',
        });
      }
      await session.waitForPrompts(1);
      await new Promise((resolve) => setImmediate(resolve));
      const firstTurn = requireLive(h, 'pending-delegated').turnPromise;
      const firstScope = turnLease(h, 'pending-delegated');
      assert.equal(requireLive(h, 'pending-delegated').streaming, true);
      notify(true);
      notify(false);
      assert.equal(requireLive(h, 'pending-delegated').streaming, true);
      await h.lifecycle.send('pending-delegated', 'second');
      assert.deepEqual(session.prompts, ['initial']);
      assert.equal(h.canvasTurns.requireScope(firstScope.scopeId), firstScope);

      first.resolve();
      await firstTurn;
      await session.waitForPrompts(2);
      const secondTurn = requireLive(h, 'pending-delegated').turnPromise;
      const secondScope = turnLease(h, 'pending-delegated');
      assert.throws(() => h.canvasTurns.requireScope(firstScope.scopeId), {
        code: 'scope_expired',
      });
      assert.equal(h.canvasTurns.requireScope(secondScope.scopeId), secondScope);
      notify(true);
      notify(false);
      await h.lifecycle.send('pending-delegated', 'third');
      assert.deepEqual(session.prompts, ['initial', 'second']);

      second.resolve();
      await secondTurn;
      await session.waitForPrompts(3);
      const thirdTurn = requireLive(h, 'pending-delegated').turnPromise;
      const thirdScope = turnLease(h, 'pending-delegated');
      assert.throws(() => h.canvasTurns.requireScope(secondScope.scopeId), {
        code: 'scope_expired',
      });
      assert.equal(h.canvasTurns.requireScope(thirdScope.scopeId), thirdScope);
      third.resolve();
      await thirdTurn;
      assert.deepEqual(session.prompts, ['initial', 'second', 'third']);
      assert.equal(h.canvasTurns.activeScope('pending-delegated'), undefined);
      assert.throws(() => h.canvasTurns.requireScope(thirdScope.scopeId), {
        code: 'scope_expired',
      });
    } finally {
      binding.resolve();
      first.resolve();
      second.resolve();
      third.resolve();
      await creating;
      await h.lifecycle.closeAll();
    }
  });
}
