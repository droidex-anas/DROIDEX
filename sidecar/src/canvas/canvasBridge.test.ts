import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import type { ServerEvent } from '../protocol.js';
import { canvasRoot } from '../testing/canvasStorageSupport.js';
import { createCanvasCommandHandler } from './canvasBridge.js';
import { CanvasScopes } from './canvasScopes.js';
import { CanvasWorkspace } from './CanvasWorkspace.js';
import type { CanvasEvent, CanvasReply, CanvasScope } from './protocol.js';

const designSystem = { id: 'droidex', version: 1, mode: 'light' } as const;
const APP = 'app-1';
const HEY = 'export default function Hey(){return <h1>Hey</h1>}';

interface Harness {
  root: string;
  workspace: CanvasWorkspace;
  scopes: CanvasScopes;
  events: ServerEvent[];
  handle: (command: unknown) => Promise<boolean>;
}

async function harness(t: TestContext, root?: string): Promise<Harness> {
  const directory = root ?? (await canvasRoot(t));
  const scopes = new CanvasScopes();
  const events: ServerEvent[] = [];
  const workspace = await CanvasWorkspace.open(directory, scopes);
  t.after(() => workspace.close());
  const handle = createCanvasCommandHandler(Promise.resolve(workspace), scopes, (event) => {
    events.push(event);
  });
  return { root: directory, workspace, scopes, events, handle };
}

/** The event answering one request, which every command produces exactly one of. */
function answer(harnessed: Harness, requestId: string): CanvasEvent {
  const matched = harnessed.events.filter(
    (event): event is CanvasEvent =>
      (event.type === 'canvas.result' || event.type === 'canvas.snapshot') &&
      event.requestId === requestId,
  );
  assert.equal(matched.length, 1, `expected one answer for ${requestId}`);
  const [only] = matched;
  assert.ok(only);
  return only;
}

function okReply(harnessed: Harness, requestId: string): CanvasReply {
  const event = answer(harnessed, requestId);
  assert.ok(event.type === 'canvas.result' && event.ok, `expected ${requestId} to succeed`);
  return event.reply;
}

function errorOf(harnessed: Harness, requestId: string): { code: string; message: string } {
  const event = answer(harnessed, requestId);
  assert.ok(event.type === 'canvas.result' && !event.ok, `expected ${requestId} to fail`);
  return event.error;
}

/** Creates the chat's canvas the way the pane's Create button does. */
async function createCanvas(harnessed: Harness, requestId = 'req-create-canvas'): Promise<string> {
  assert.equal(
    await harnessed.handle({ type: 'canvas.createCanvas', requestId, appSessionId: APP }),
    true,
  );
  const reply = okReply(harnessed, requestId);
  assert.ok(reply.kind === 'attachment' && reply.canvasId !== null);
  return reply.canvasId;
}

async function createFrame(
  harnessed: Harness,
  canvasId: string,
  requestId = 'req-create-frame',
): Promise<string> {
  await harnessed.handle({
    type: 'canvas.create',
    requestId,
    appSessionId: APP,
    canvasId,
    input: {
      mutationId: 'm-create',
      frames: [{ name: 'Hey', width: 720, height: 720, designSystem }],
    },
  });
  const reply = okReply(harnessed, requestId);
  assert.ok(reply.kind === 'created');
  const [frame] = reply.created.frames;
  assert.ok(frame);
  return frame.designId;
}

function turnScope(canvasId: string, scopeId: string): CanvasScope {
  return {
    origin: 'turn',
    scopeId,
    appSessionId: 'agent-1',
    generation: 1,
    canvasId,
    context: { designs: [], elements: [], designSystem },
    allowedDesignIds: 'canvas',
  };
}

test('a correlated create, write and arrange answer their own requests', async (t) => {
  const canvas = await harness(t);
  const canvasId = await createCanvas(canvas);
  const designId = await createFrame(canvas, canvasId);

  await canvas.handle({
    type: 'canvas.write',
    requestId: 'req-write',
    appSessionId: APP,
    canvasId,
    input: {
      mutationId: 'm-write',
      designId,
      expectedRevisionId: null,
      files: { 'main.tsx': HEY },
      deletedPaths: [],
    },
  });
  const written = okReply(canvas, 'req-write');
  assert.ok(written.kind === 'written');
  assert.equal(written.receipt.designId, designId);

  await canvas.handle({
    type: 'canvas.arrange',
    requestId: 'req-arrange',
    appSessionId: APP,
    canvasId,
    input: {
      mutationId: 'm-arrange',
      frames: [
        { designId, expectedLayoutVersion: 0, rect: { x: 40, y: 40, width: 720, height: 720 } },
      ],
    },
  });
  const arranged = okReply(canvas, 'req-arrange');
  assert.ok(arranged.kind === 'arranged');
  assert.deepEqual(arranged.change.frames[0]?.rect, { x: 40, y: 40, width: 720, height: 720 });

  await canvas.handle({ type: 'canvas.list', requestId: 'req-list' });
  const listed = okReply(canvas, 'req-list');
  assert.ok(listed.kind === 'summaries');
  assert.deepEqual(
    listed.summaries.map((summary) => [summary.canvasId, summary.designCount]),
    [[canvasId, 1]],
  );
  // The pane learns about another window's work from the broadcast, not a reply.
  assert.ok(canvas.events.some((event) => event.type === 'canvas.summaries'));
});

test('an attachment made through the bridge survives a workspace reopen', async (t) => {
  const first = await harness(t);
  const canvasId = await createCanvas(first);
  await first.workspace.close();

  const reopened = await harness(t, first.root);
  await reopened.handle({
    type: 'canvas.attachment',
    requestId: 'req-attachment',
    appSessionId: APP,
  });
  assert.deepEqual(okReply(reopened, 'req-attachment'), { kind: 'attachment', canvasId });

  await reopened.handle({ type: 'canvas.detach', requestId: 'req-detach', appSessionId: APP });
  assert.deepEqual(okReply(reopened, 'req-detach'), { kind: 'attachment', canvasId: null });
  // Detaching only drops the reference; the canvas and its source stay (spec §7).
  await reopened.handle({ type: 'canvas.list', requestId: 'req-list' });
  const listed = okReply(reopened, 'req-list');
  assert.ok(listed.kind === 'summaries' && listed.summaries.length === 1);
});

test('a rejected argument maps to invalid_source_path under files and invalid_input elsewhere', async (t) => {
  const canvas = await harness(t);
  const canvasId = await createCanvas(canvas);
  const designId = await createFrame(canvas, canvasId);

  await canvas.handle({
    type: 'canvas.write',
    requestId: 'req-path',
    appSessionId: APP,
    canvasId,
    input: {
      mutationId: 'm-path',
      designId,
      expectedRevisionId: null,
      files: { '../escape.tsx': HEY },
      deletedPaths: [],
    },
  });
  const path = errorOf(canvas, 'req-path');
  assert.equal(path.code, 'invalid_source_path');
  assert.match(path.message, /relative/);

  await canvas.handle({
    type: 'canvas.create',
    requestId: 'req-count',
    appSessionId: APP,
    canvasId,
    input: {
      mutationId: 'm-count',
      frames: new Array(5).fill({ name: 'Hey', width: 720, height: 720, designSystem }),
    },
  });
  const count = errorOf(canvas, 'req-count');
  assert.equal(count.code, 'invalid_input');
  assert.match(count.message, /1 to 4 frames/);

  await canvas.handle({ type: 'canvas.subscribe', requestId: 'req-unknown', canvasId: 'nope' });
  assert.equal(errorOf(canvas, 'req-unknown').code, 'invalid_input');
});

test('one request identity cannot carry two different requests', async (t) => {
  const canvas = await harness(t);
  await createCanvas(canvas);
  await canvas.handle({ type: 'canvas.attachment', requestId: 'req-same', appSessionId: APP });
  assert.deepEqual(okReply(canvas, 'req-same'), {
    kind: 'attachment',
    canvasId: canvas.workspace.attachedCanvasId(APP),
  });

  canvas.events.length = 0;
  await canvas.handle({ type: 'canvas.attachment', requestId: 'req-same', appSessionId: 'app-2' });
  const reused = errorOf(canvas, 'req-same');
  assert.equal(reused.code, 'invalid_input');
  assert.match(reused.message, /reused with different arguments/);

  // The same request repeated verbatim is answered from the original reply.
  canvas.events.length = 0;
  await canvas.handle({ type: 'canvas.attachment', requestId: 'req-same', appSessionId: APP });
  assert.equal(okReply(canvas, 'req-same').kind, 'attachment');
});

test('a chat that is not attached to the named canvas cannot mutate it', async (t) => {
  const canvas = await harness(t);
  const canvasId = await createCanvas(canvas);
  await canvas.handle({ type: 'canvas.detach', requestId: 'req-detach', appSessionId: APP });

  await canvas.handle({
    type: 'canvas.create',
    requestId: 'req-unattached',
    appSessionId: APP,
    canvasId,
    input: {
      mutationId: 'm-unattached',
      frames: [{ name: 'Hey', width: 720, height: 720, designSystem }],
    },
  });
  assert.equal(errorOf(canvas, 'req-unattached').code, 'scope_expired');
});

test('a pane mutation holds its scope only while its request runs', async (t) => {
  const canvas = await harness(t);
  const canvasId = await createCanvas(canvas);
  // The create itself proves the scope was live: the workspace refuses a
  // mutation whose scope the registry does not hold.
  await createFrame(canvas, canvasId, 'req-scope');
  assert.equal(canvas.scopes.isScopeActive('req-scope'), false);
  assert.equal(canvas.scopes.get('req-scope'), undefined);
});

test('a direct workspace mutation reaches a subscribed client in sequence', async (t) => {
  const canvas = await harness(t);
  const canvasId = await createCanvas(canvas);
  await canvas.handle({ type: 'canvas.subscribe', requestId: 'req-subscribe', canvasId });
  const subscribed = answer(canvas, 'req-subscribe');
  assert.ok(subscribed.type === 'canvas.snapshot');
  const { sequence } = subscribed.snapshot;

  // Exactly what an agent tool does in Task 4: mutate the workspace directly.
  const agent = turnScope(canvasId, 'agent-scope');
  canvas.scopes.register(agent);
  const created = await canvas.workspace.create(agent, {
    mutationId: 'm-agent',
    frames: [{ name: 'Agent', width: 720, height: 720, designSystem }],
  });
  canvas.scopes.revoke(agent.scopeId);

  const changes = canvas.events.filter((event) => event.type === 'canvas.change');
  assert.equal(changes.length, 1);
  const [change] = changes;
  assert.ok(change?.type === 'canvas.change');
  assert.equal(change.change.sequence, sequence + 1);
  assert.deepEqual(
    change.change.frames.map((frame) => frame.designId),
    created.frames.map((frame) => frame.designId),
  );

  // A canvas nobody is watching costs the pane nothing.
  await canvas.handle({ type: 'canvas.unsubscribe', requestId: 'req-unsubscribe', canvasId });
  const quiet = turnScope(canvasId, 'agent-scope-2');
  canvas.scopes.register(quiet);
  await canvas.workspace.create(quiet, {
    mutationId: 'm-agent-2',
    frames: [{ name: 'Quiet', width: 720, height: 720, designSystem }],
  });
  canvas.scopes.revoke(quiet.scopeId);
  assert.equal(canvas.events.filter((event) => event.type === 'canvas.change').length, 1);
});

test('a command that is not Canvas is left to the next handler', async (t) => {
  const canvas = await harness(t);
  assert.equal(await canvas.handle({ type: 'session.close', appSessionId: APP }), false);
  // A Canvas request with no usable requestId can only be reported as an error.
  assert.equal(await canvas.handle({ type: 'canvas.list' }), true);
  const [reported] = canvas.events;
  assert.ok(reported?.type === 'error');
  assert.equal(reported.code, 'canvas.invalid_input');
});
