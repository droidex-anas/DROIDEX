import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import type { ServerEvent } from '../protocol.js';
import { canvasRoot, observedFileSystem, quietBuilds } from '../testing/canvasStorageSupport.js';
import { CanvasBuilds } from './CanvasBuilds.js';
import { importCanvasImage, listCanvasAssets } from './canvasAssets.js';
import { createCanvasCommandHandler } from './canvasBridge.js';
import type { CanvasFileSystem } from './canvasFiles.js';
import { CanvasScopes } from './canvasScopes.js';
import { CompileCancelledError } from './compiler.js';
import { CanvasWorkspace } from './CanvasWorkspace.js';
import type { CanvasEvent, CanvasReply, CanvasScope } from './protocol.js';

const designSystem = { id: 'droidex', version: 1, mode: 'light' } as const;
const APP = 'app-1';
const PAGE = 'page-1';
const HEY = 'export default function Hey(){return <h1>Hey</h1>}';

interface Harness {
  root: string;
  workspace: CanvasWorkspace;
  scopes: CanvasScopes;
  builds: CanvasBuilds;
  events: ServerEvent[];
  handle: (command: unknown, pageId?: string | null) => Promise<boolean>;
  /** Reports a renderer page's socket closing, the way the bridge server does. */
  pageGone: (pageId: string) => void;
}

async function harness(
  t: TestContext,
  options: { root?: string; fs?: CanvasFileSystem; builds?: CanvasBuilds } = {},
): Promise<Harness> {
  const directory = options.root ?? (await canvasRoot(t));
  const scopes = new CanvasScopes();
  const events: ServerEvent[] = [];
  const builds = options.builds ?? quietBuilds();
  const workspace = await CanvasWorkspace.open(directory, builds, {
    isScopeActive: (scopeId) => scopes.isScopeActive(scopeId),
    bindScopeCanvas: (scopeId, canvasId) => {
      scopes.bindScopeCanvas(scopeId, canvasId);
    },
    ...(options.fs ? { fs: options.fs } : {}),
  });
  t.after(() => workspace.close());
  const listeners = new Set<(pageId: string) => void>();
  const handle = createCanvasCommandHandler(
    Promise.resolve(workspace),
    scopes,
    builds,
    { secret: 'test-canvas-secret', list: (canvasId) => listCanvasAssets(directory, canvasId) },
    (event) => {
      events.push(event);
    },
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  );
  return {
    root: directory,
    workspace,
    scopes,
    builds,
    events,
    handle: (command, pageId = PAGE) => handle(command, pageId),
    pageGone: (pageId) => {
      for (const listener of listeners) listener(pageId);
    },
  };
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

test('a lost image import reply is recovered by listing that canvas after the source is gone', async (t) => {
  const canvas = await harness(t);
  const canvasId = await createCanvas(canvas);
  const chosen = join(canvas.root, 'chosen.png');
  const bytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
    'base64',
  );
  await writeFile(chosen, bytes);
  const assetId = createHash('sha256').update(bytes).digest('hex');
  await importCanvasImage(canvas.root, {
    canvasId,
    filePath: chosen,
    digest: assetId,
    width: 1,
    height: 1,
  });
  await unlink(chosen);

  assert.equal(
    await canvas.handle({ type: 'canvas.listAssets', requestId: 'assets', canvasId }),
    true,
  );
  assert.deepEqual(okReply(canvas, 'assets'), {
    kind: 'assets',
    assets: [{ assetId, mediaType: 'image/png', byteLength: bytes.length, width: 1, height: 1 }],
  });
});

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

  const reopened = await harness(t, { root: first.root });
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

  // A correlation ID the renderer's validator would throw the reply away for is
  // refused here instead, so one bound holds on both sides of the wire.
  const tooLong = 'r'.repeat(129);
  await canvas.handle({ type: 'canvas.list', requestId: tooLong });
  assert.equal(errorOf(canvas, tooLong).code, 'invalid_input');
  await canvas.handle({ type: 'canvas.list', requestId: 'r'.repeat(128) });
  assert.equal(okReply(canvas, 'r'.repeat(128)).kind, 'summaries');
});

test('reading an artifact is a derived read with no cache miss to report', async (t) => {
  const canvas = await harness(t);
  const canvasId = await createCanvas(canvas);
  const designId = await createFrame(canvas, canvasId);

  // Nothing has built this frame, so the derived cache has nothing to serve and
  // the pane is told so rather than being handed an error.
  await canvas.handle({
    type: 'canvas.readArtifact',
    requestId: 'req-artifact',
    canvasId,
    designId,
    revisionId: 'rev_missing',
  });
  assert.deepEqual(okReply(canvas, 'req-artifact'), { kind: 'artifact', artifact: null });

  // A derived read needs no attachment, and an incomplete one never reaches it.
  await canvas.handle(
    { type: 'canvas.readArtifact', requestId: 'req-no-page', canvasId, designId, revisionId: 'r1' },
    null,
  );
  assert.deepEqual(okReply(canvas, 'req-no-page'), { kind: 'artifact', artifact: null });
  await canvas.handle({ type: 'canvas.readArtifact', requestId: 'req-bad', canvasId, designId });
  assert.equal(errorOf(canvas, 'req-bad').code, 'invalid_input');
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

/** A promise a test resolves itself, to hold an awaited filesystem call open. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/** A filesystem that holds the next write of one source file open until released. */
function pauseAtSource(path: string) {
  const reached = deferred();
  const release = deferred();
  let armed = true;
  return {
    reached: reached.promise,
    release: release.resolve,
    fs: observedFileSystem(async (operation, target) => {
      if (!armed || operation !== 'open' || !target.endsWith(path)) return;
      armed = false;
      reached.resolve();
      await release.promise;
    }),
  };
}

test('a chat that detaches while its write is staging does not commit it', async (t) => {
  const paused = pauseAtSource('main.tsx');
  const canvas = await harness(t, { fs: paused.fs });
  const canvasId = await createCanvas(canvas);
  const designId = await createFrame(canvas, canvasId);

  const writing = canvas.handle({
    type: 'canvas.write',
    requestId: 'req-paused-write',
    appSessionId: APP,
    canvasId,
    input: {
      mutationId: 'm-paused',
      designId,
      expectedRevisionId: null,
      files: { 'main.tsx': HEY },
      deletedPaths: [],
    },
  });
  await paused.reached;
  // The pane's authority is the attachment, and this chat has just given it up.
  await canvas.workspace.detach(APP);
  paused.release();
  await writing;

  assert.equal(errorOf(canvas, 'req-paused-write').code, 'scope_expired');
  assert.equal(canvas.workspace.snapshot(canvasId).frames[0]?.revisionId, null);
});

test('a request identity cannot revive a revoked turn lease', async (t) => {
  const stolen = 'turn-1';
  // Runs inside a commit, which is exactly when a stale turn's own write would
  // check its lease one last time.
  let insideCommit: (() => void) | null = null;
  const fs = observedFileSystem((operation, target) => {
    if (operation === 'rename' && target.endsWith('manifest.json')) insideCommit?.();
  });
  const canvas = await harness(t, { fs });
  const canvasId = await createCanvas(canvas);
  const designId = await createFrame(canvas, canvasId);

  const agent = turnScope(canvasId, stolen);
  canvas.scopes.register(agent);
  canvas.scopes.revoke(agent.scopeId);
  let revivedMidRequest: boolean | null = null;
  insideCommit = () => {
    revivedMidRequest ??= canvas.scopes.isScopeActive(stolen);
  };

  // The renderer names the revoked lease as its own request ID.
  await canvas.handle({
    type: 'canvas.arrange',
    requestId: stolen,
    appSessionId: APP,
    canvasId,
    input: {
      mutationId: 'm-pane-arrange',
      frames: [
        { designId, expectedLayoutVersion: 0, rect: { x: 10, y: 10, width: 720, height: 720 } },
      ],
    },
  });
  insideCommit = null;
  assert.equal(okReply(canvas, stolen).kind, 'arranged');
  // `false`, not null: the sample has to have been taken inside the commit, or
  // the assertion proves nothing.
  assert.equal(revivedMidRequest, false);
  assert.equal(canvas.scopes.isScopeActive(stolen), false);
});

test('a workspace that failed to open answers every command the same way', async (t) => {
  const unhandled: unknown[] = [];
  const capture = (reason: unknown): void => {
    unhandled.push(reason);
  };
  process.on('unhandledRejection', capture);
  t.after(() => void process.off('unhandledRejection', capture));

  const events: ServerEvent[] = [];
  const handle = createCanvasCommandHandler(
    Promise.reject(new Error('canvases directory is read-only')),
    new CanvasScopes(),
    quietBuilds(),
    { secret: 'test-canvas-secret', list: async () => [] },
    (event) => {
      events.push(event);
    },
    () => () => undefined,
  );
  // Two event-loop turns: an unhandled rejection is reported after the
  // microtask queue drains, so a missing handler would already have fired.
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(unhandled, []);

  assert.equal(await handle({ type: 'canvas.list', requestId: 'req-list' }, PAGE), true);
  const [reply] = events;
  assert.ok(reply?.type === 'canvas.result' && !reply.ok);
  assert.equal(reply.error.code, 'storage_failed');
  assert.match(reply.error.message, /Canvas storage is unavailable/);
  assert.deepEqual(unhandled, []);
});

test('one page unsubscribing leaves another page watching the same canvas', async (t) => {
  const canvas = await harness(t);
  const canvasId = await createCanvas(canvas);
  await canvas.handle({ type: 'canvas.subscribe', requestId: 'req-watch-1', canvasId }, 'page-1');
  await canvas.handle({ type: 'canvas.subscribe', requestId: 'req-watch-2', canvasId }, 'page-2');
  await canvas.handle(
    { type: 'canvas.unsubscribe', requestId: 'req-unwatch-1', canvasId },
    'page-1',
  );

  const changed = async (mutationId: string, name: string): Promise<number> => {
    const agent = turnScope(canvasId, `turn-${mutationId}`);
    canvas.scopes.register(agent);
    await canvas.workspace.create(agent, {
      mutationId,
      frames: [{ name, width: 720, height: 720, designSystem }],
    });
    canvas.scopes.revoke(agent.scopeId);
    return canvas.events.filter((event) => event.type === 'canvas.change').length;
  };

  assert.equal(await changed('m-one', 'One'), 1);
  // The page that is gone holds nothing, and the last watcher ends the broadcast.
  canvas.pageGone('page-2');
  assert.equal(await changed('m-two', 'Two'), 1);

  await canvas.handle({ type: 'canvas.subscribe', requestId: 'req-watch-3', canvasId }, null);
  assert.equal(errorOf(canvas, 'req-watch-3').code, 'invalid_input');
});

test('a change listener that throws loses its change, not the commit', async (t) => {
  const canvas = await harness(t);
  const canvasId = await createCanvas(canvas);
  await canvas.handle({ type: 'canvas.subscribe', requestId: 'req-subscribe', canvasId });
  const seen: number[] = [];
  canvas.workspace.changes.subscribe(() => {
    throw new Error('listener failed');
  });
  canvas.workspace.changes.subscribe((change) => seen.push(change.sequence));

  const designId = await createFrame(canvas, canvasId, 'req-create-after-throw');
  assert.ok(designId);
  assert.equal(seen.length, 1);
  assert.equal(canvas.events.filter((event) => event.type === 'canvas.change').length, 1);
});

test('a page that goes away while the workspace opens installs no watch', async (t) => {
  // A compiler that only answers an abort, so a started build stays started.
  const builds = new CanvasBuilds({
    compiler: () => ({
      compile: (_input, signal) =>
        new Promise<never>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new CompileCancelledError()), {
            once: true,
          });
        }),
      terminate: () => Promise.resolve(),
    }),
    deadline: () => () => undefined,
  });
  const canvas = await harness(t, { builds });
  const canvasId = await createCanvas(canvas);
  const designId = await createFrame(canvas, canvasId);
  await canvas.handle({
    type: 'canvas.write',
    requestId: 'req-write-source',
    appSessionId: APP,
    canvasId,
    input: {
      mutationId: 'm-write-source',
      designId,
      expectedRevisionId: null,
      files: { 'main.tsx': HEY },
      deletedPaths: [],
    },
  });
  // Cancelled leaves saved source with nothing built for it, which is what a
  // subscription's rebuild sweep picks up.
  builds.cancelCanvas(canvasId);
  assert.equal(builds.stateOf(canvasId, designId).status, 'cancelled');
  const opening = deferred();
  const events: ServerEvent[] = [];
  const listeners = new Set<(pageId: string) => void>();
  const handle = createCanvasCommandHandler(
    opening.promise.then(() => canvas.workspace),
    canvas.scopes,
    canvas.builds,
    { secret: 'test-canvas-secret', list: async () => [] },
    (event) => {
      events.push(event);
    },
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  );

  const subscribing = handle({ type: 'canvas.subscribe', requestId: 'req-late', canvasId }, PAGE);
  // The page closes its socket before Canvas storage finishes opening.
  for (const listener of listeners) listener(PAGE);
  opening.resolve();
  await subscribing;

  const [answer] = events;
  assert.ok(answer?.type === 'canvas.result' && !answer.ok);
  assert.equal(answer.error.code, 'scope_expired');
  assert.equal(
    builds.stateOf(canvasId, designId).status,
    'cancelled',
    'a refused subscription scheduled no build',
  );

  // Nothing is watching, so a later change is not broadcast to anyone.
  const agent = turnScope(canvasId, 'turn-after-page-gone');
  canvas.scopes.register(agent);
  await canvas.workspace.create(agent, {
    mutationId: 'm-after-page-gone',
    frames: [{ name: 'Quiet', width: 720, height: 720, designSystem }],
  });
  canvas.scopes.revoke(agent.scopeId);
  assert.deepEqual(
    events.filter((event) => event.type === 'canvas.change'),
    [],
  );
});
