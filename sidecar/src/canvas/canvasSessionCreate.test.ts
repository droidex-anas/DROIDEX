import assert from 'node:assert/strict';
import test from 'node:test';
import { CanvasScopes } from './canvasScopes.js';
import { CanvasTurns } from './canvasTurnContext.js';
import { CanvasWorkspace } from './CanvasWorkspace.js';
import { prepareSessionFirstTurn } from './canvasSessionCreate.js';
import { DEFAULT_DESIGN_SYSTEM_REF } from './designSystems.js';
import { canvasRoot, quietBuilds } from '../testing/canvasStorageSupport.js';
import { FakeFactorySession } from '../testing/fakeFactoryRuntime.js';
import { writeProviderConversation } from '../testing/historyCharacterizationSupport.js';
import {
  chatCommand,
  createSessionManagerTestContext,
  errorEvents,
} from '../testing/sessionManagerTestContext.js';

for (const target of ['new', 'saved'] as const) {
  test(`${target} Design canvas is attached before publication and the first prompt's lease`, async (t) => {
    const scopes = new CanvasScopes();
    const turns = new CanvasTurns(scopes, (id) => workspace.attachedCanvasId(id));
    const projectBindings: string[] = [];
    let publication: { canvasId: string | null; prompts: number } | undefined;
    const h = createSessionManagerTestContext({
      canvasTurns: turns,
      beforeFirstTurn: (session, clientRef, intent) =>
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
    beforeFirstTurn: (session, ref, intent) =>
      prepareSessionFirstTurn(
        session,
        { clientRef: ref, canvas: intent },
        { beforeFirstTurn: async () => undefined },
        Promise.resolve(workspace),
        () => undefined,
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
