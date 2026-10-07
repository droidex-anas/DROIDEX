import assert from 'node:assert/strict';
import { unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import type { ServerEvent } from '../protocol.js';
import {
  answer,
  canvasCommandHandler,
  CANVAS_PNG,
  CANVAS_PNG_ASSET_ID,
  createCanvas,
  createFrame,
  deferred,
  errorOf,
  frameHarness,
  harness,
  observedFileSystem,
  okReply,
  quietBuilds,
  TEST_APP_SESSION as APP,
  TEST_DESIGN_SOURCE as HEY,
  TEST_DESIGN_SYSTEM as designSystem,
  TEST_PAGE as PAGE,
  writeInput,
} from '../testing/canvasStorageSupport.js';
import { CanvasBuilds } from './CanvasBuilds.js';
import { importCanvasImage } from './canvasAssets.js';
import { CanvasScopes } from './canvasScopes.js';
import { CompileCancelledError } from './compiler.js';
import type { CanvasScope } from './protocol.js';

test('a lost image import reply is recovered by listing that canvas after the source is gone', async (t) => {
  const canvas = await harness(t);
  const canvasId = await createCanvas(canvas);
  const chosen = join(canvas.root, 'chosen.png');
  await writeFile(chosen, CANVAS_PNG);
  await importCanvasImage(canvas.root, {
    canvasId,
    filePath: chosen,
    digest: CANVAS_PNG_ASSET_ID,
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
    assets: [
      {
        assetId: CANVAS_PNG_ASSET_ID,
        mediaType: 'image/png',
        byteLength: CANVAS_PNG.length,
        width: 1,
        height: 1,
      },
    ],
  });
});

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
  const { canvas, canvasId, designId } = await frameHarness(t);

  await canvas.handle({
    type: 'canvas.write',
    requestId: 'req-write',
    appSessionId: APP,
    canvasId,
    input: writeInput('m-write', designId, null, { 'main.tsx': HEY }),
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

test('pane rename, remove and Undo route through one attached canvas', async (t) => {
  const { canvas, canvasId, designId } = await frameHarness(t);
  const version = canvas.workspace.snapshot(canvasId).frames[0]?.manifestVersion;
  assert.equal(version, 0);
  await canvas.handle({
    type: 'canvas.renameFrame',
    requestId: 'req-rename',
    appSessionId: APP,
    canvasId,
    input: { mutationId: 'm-rename', designId, name: 'Better', expectedManifestVersion: version },
  });
  const renamed = okReply(canvas, 'req-rename');
  assert.ok(renamed.kind === 'renamed');
  assert.equal(renamed.change.frames[0]?.name, 'Better');

  await canvas.handle({
    type: 'canvas.remove',
    requestId: 'req-remove',
    appSessionId: APP,
    canvasId,
    input: { mutationId: 'm-remove', designIds: [designId] },
  });
  const removed = okReply(canvas, 'req-remove');
  assert.ok(removed.kind === 'removed');
  assert.equal(canvas.workspace.snapshot(canvasId).frames.length, 0);
  await canvas.handle({
    type: 'canvas.undoRemoval',
    requestId: 'req-undo',
    appSessionId: APP,
    canvasId,
    input: { mutationId: 'm-undo', undoId: removed.undoId },
  });
  const undone = okReply(canvas, 'req-undo');
  assert.ok(undone.kind === 'undone');
  assert.equal(undone.change.frames[0]?.name, 'Better');
});

test('an Undo layout conflict carries the current occupant rect through the bridge', async (t) => {
  const canvas = await harness(t);
  const canvasId = await createCanvas(canvas);
  const originalId = await createFrame(canvas, canvasId);
  await canvas.handle({
    type: 'canvas.create',
    requestId: 'req-other',
    appSessionId: APP,
    canvasId,
    input: {
      mutationId: 'm-other',
      frames: [{ name: 'Other', width: 720, height: 720, designSystem }],
    },
  });
  const other = okReply(canvas, 'req-other');
  assert.ok(other.kind === 'created');
  const otherId = other.created.frames[0]?.designId;
  assert.ok(otherId);
  const occupied = canvas.workspace.snapshot(canvasId).frames[0]?.rect;
  assert.ok(occupied);
  await canvas.handle({
    type: 'canvas.remove',
    requestId: 'req-remove',
    appSessionId: APP,
    canvasId,
    input: { mutationId: 'm-remove', designIds: [originalId] },
  });
  const removed = okReply(canvas, 'req-remove');
  assert.ok(removed.kind === 'removed');
  await canvas.handle({
    type: 'canvas.arrange',
    requestId: 'req-occupy',
    appSessionId: APP,
    canvasId,
    input: {
      mutationId: 'm-occupy',
      frames: [{ designId: otherId, expectedLayoutVersion: 0, rect: occupied }],
    },
  });
  await canvas.handle({
    type: 'canvas.undoRemoval',
    requestId: 'req-undo',
    appSessionId: APP,
    canvasId,
    input: { mutationId: 'm-undo', undoId: removed.undoId },
  });
  assert.deepEqual(errorOf(canvas, 'req-undo').currentRect, occupied);
  assert.equal(errorOf(canvas, 'req-undo').code, 'layout_conflict');
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
  const { canvas, canvasId, designId } = await frameHarness(t);

  await canvas.handle({
    type: 'canvas.write',
    requestId: 'req-path',
    appSessionId: APP,
    canvasId,
    input: writeInput('m-path', designId, null, { '../escape.tsx': HEY }),
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

  for (const [field, value] of [
    ['placeBeside', { designId: '../outside' }],
    ['seed', { kind: 'revision', canvasId, revision: { designId, revisionId: '../outside' } }],
  ] as const) {
    await canvas.handle({
      type: 'canvas.create',
      requestId: `req-${field}`,
      appSessionId: APP,
      canvasId,
      input: {
        mutationId: `m-${field}`,
        ...(field === 'placeBeside' ? { placeBeside: value } : {}),
        frames: [
          {
            name: 'Variant',
            width: 720,
            height: 720,
            designSystem,
            ...(field === 'seed' ? { seed: value } : {}),
          },
        ],
      },
    });
    assert.equal(errorOf(canvas, `req-${field}`).code, 'invalid_input');
    assert.match(errorOf(canvas, `req-${field}`).message, /1 to 128 characters/);
  }

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

test('the bridge creates a seeded adjacent frame and refuses a seed outside its canvas lease', async (t) => {
  const canvas = await harness(t);
  const sourceCanvasId = await createCanvas(canvas);
  const designId = await createFrame(canvas, sourceCanvasId);
  await canvas.handle({
    type: 'canvas.write',
    requestId: 'req-seed-source',
    appSessionId: APP,
    canvasId: sourceCanvasId,
    input: writeInput('seed-source', designId, null, { 'main.tsx': HEY }),
  });
  const written = okReply(canvas, 'req-seed-source');
  assert.ok(written.kind === 'written');
  const input = {
    mutationId: 'seeded-variant',
    placeBeside: { designId },
    frames: [
      {
        name: 'Variant',
        width: 720,
        height: 720,
        designSystem,
        seed: {
          kind: 'revision',
          canvasId: sourceCanvasId,
          revision: { designId, revisionId: written.receipt.revisionId },
        },
      },
    ],
  };
  await canvas.handle({
    type: 'canvas.create',
    requestId: 'req-seeded',
    appSessionId: APP,
    canvasId: sourceCanvasId,
    input,
  });
  const created = okReply(canvas, 'req-seeded');
  assert.ok(created.kind === 'created');
  assert.deepEqual(created.created.frames[0]?.rect, { x: 0, y: 800, width: 720, height: 720 });
  const canvasId = (await canvas.workspace.createCanvas(APP)).canvasId;
  await canvas.handle({
    type: 'canvas.create',
    requestId: 'req-foreign-seed',
    appSessionId: APP,
    canvasId,
    input: { mutationId: 'foreign-seed', frames: input.frames },
  });
  assert.deepEqual(errorOf(canvas, 'req-foreign-seed'), {
    code: 'invalid_input',
    message: 'A seed revision must come from this canvas.',
  });
  assert.equal(canvas.workspace.snapshot(canvasId).frames.length, 0);
  assert.equal(canvas.workspace.snapshot(sourceCanvasId).frames.length, 2);
});

test('reading an artifact is a derived read with no cache miss to report', async (t) => {
  const { canvas, canvasId, designId } = await frameHarness(t);

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
  const { canvas, canvasId, designId } = await frameHarness(t, { fs: paused.fs });

  const writing = canvas.handle({
    type: 'canvas.write',
    requestId: 'req-paused-write',
    appSessionId: APP,
    canvasId,
    input: writeInput('m-paused', designId, null, { 'main.tsx': HEY }),
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
  const { canvas, canvasId, designId } = await frameHarness(t, { fs });

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
  const { handle } = canvasCommandHandler({
    ready: Promise.reject(new Error('canvases directory is read-only')),
    scopes: new CanvasScopes(),
    builds: quietBuilds(),
    events,
  });
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
  const { canvas, canvasId, designId } = await frameHarness(t, { builds });
  await canvas.handle({
    type: 'canvas.write',
    requestId: 'req-write-source',
    appSessionId: APP,
    canvasId,
    input: writeInput('m-write-source', designId, null, { 'main.tsx': HEY }),
  });
  // Cancelled leaves saved source with nothing built for it, which is what a
  // subscription's rebuild sweep picks up.
  builds.cancelCanvas(canvasId);
  assert.equal(builds.stateOf(canvasId, designId).status, 'cancelled');
  const opening = deferred();
  const events: ServerEvent[] = [];
  const { handle, pageGone } = canvasCommandHandler({
    ready: opening.promise.then(() => canvas.workspace),
    scopes: canvas.scopes,
    builds: canvas.builds,
    events,
  });

  const subscribing = handle({ type: 'canvas.subscribe', requestId: 'req-late', canvasId }, PAGE);
  // The page closes its socket before Canvas storage finishes opening.
  pageGone(PAGE);
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
