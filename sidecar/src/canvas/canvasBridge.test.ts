import assert from 'node:assert/strict';
import { readdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import type { ServerEvent } from '../protocol.js';
import {
  frameHarness,
  turnScope,
  pauseAtSource,
  canvasCommandHandler,
  APP,
  PAGE,
  HEY,
  designSystem,
  harness,
  answer,
  okReply,
  errorOf,
  createCanvas,
  createFrame,
} from '../testing/canvasBridgeSupport.js';
import {
  deferred,
  CANVAS_PNG,
  CANVAS_PNG_ASSET_ID,
  canvasRoot,
  observedFileSystem,
  quietBuilds,
  writeInput,
} from '../testing/canvasStorageSupport.js';
import { importCanvasImage } from './canvasAssets.js';
import { CanvasScopes } from './canvasScopes.js';

test('a lost Create reply replays its durable canvas while the first commit is in flight', async (t) => {
  const reached = deferred();
  const release = deferred();
  let hold = true;
  const fs = observedFileSystem(async (operation, path) => {
    if (!hold || operation !== 'rename' || !path.endsWith('manifest.json')) return;
    hold = false;
    reached.resolve();
    await release.promise;
  });
  const canvas = await harness(t, { fs });
  const first = canvas.handle({
    type: 'canvas.createCanvas',
    requestId: 'first',
    appSessionId: APP,
    mutationId: 'same-create',
  });
  await reached.promise;
  const retry = canvas.handle({
    type: 'canvas.createCanvas',
    requestId: 'retry',
    appSessionId: APP,
    mutationId: 'same-create',
  });
  release.resolve();
  await Promise.all([first, retry]);

  const firstReply = okReply(canvas, 'first');
  const replay = okReply(canvas, 'retry');
  assert.deepEqual(replay, firstReply);
  assert.ok(firstReply.kind === 'canvasCreated');
  assert.deepEqual(
    canvas.workspace.listCanvases().map((item) => item.canvasId),
    [firstReply.canvasId],
  );
  assert.equal(canvas.workspace.attachedCanvasId(APP), firstReply.canvasId);
  // One canvas directory, beside the workspace's own writer-lease file.
  assert.deepEqual(
    (await readdir(canvas.root)).filter((name) => !name.startsWith('.')),
    [firstReply.canvasId],
  );
});

test('a replayed Create reports its canvas and the chat’s current attachment separately', async (t) => {
  const canvas = await harness(t);
  const ids: string[] = [];
  for (const mutationId of ['create-A', 'create-B']) {
    await canvas.handle({
      type: 'canvas.createCanvas',
      requestId: mutationId,
      appSessionId: APP,
      mutationId,
    });
    const created = okReply(canvas, mutationId);
    assert.ok('canvasId' in created && created.canvasId !== null);
    ids.push(created.canvasId);
  }
  const [firstCanvasId, currentCanvasId] = ids;
  assert.ok(firstCanvasId && currentCanvasId);

  await canvas.handle({
    type: 'canvas.createCanvas',
    requestId: 'replay-A',
    appSessionId: APP,
    mutationId: 'create-A',
  });

  assert.deepEqual(okReply(canvas, 'replay-A'), {
    kind: 'canvasCreated',
    canvasId: firstCanvasId,
    attachedCanvasId: currentCanvasId,
  });
  assert.equal(canvas.workspace.attachedCanvasId(APP), currentCanvasId);
  assert.equal(canvas.workspace.listCanvases().length, 2);
});

test('a replayed Create reports a detached chat without creating or reattaching a canvas', async (t) => {
  const canvas = await harness(t);
  await canvas.handle({
    type: 'canvas.createCanvas',
    requestId: 'first-create',
    appSessionId: APP,
    mutationId: 'detached-create',
  });
  const created = okReply(canvas, 'first-create');
  assert.ok('canvasId' in created && created.canvasId !== null);
  await canvas.handle({ type: 'canvas.detach', requestId: 'detach', appSessionId: APP });
  assert.deepEqual(okReply(canvas, 'detach'), { kind: 'attachment', canvasId: null });

  for (const requestId of ['retry-create', 'first-create']) {
    canvas.events.length = 0;
    await canvas.handle({
      type: 'canvas.createCanvas',
      requestId,
      appSessionId: APP,
      mutationId: 'detached-create',
    });
    const replay = okReply(canvas, requestId);
    assert.ok('canvasId' in replay);
    const attachedCanvasId =
      'attachedCanvasId' in replay ? replay.attachedCanvasId : replay.canvasId;
    assert.equal(attachedCanvasId, null);
    assert.deepEqual(replay, {
      kind: 'canvasCreated',
      canvasId: created.canvasId,
      attachedCanvasId: null,
    });
  }
  assert.equal(canvas.workspace.attachedCanvasId(APP), null);
  assert.equal(canvas.workspace.listCanvases().length, 1);
});

test('attachment mutations refuse a chat the sidecar does not know', async (t) => {
  const canvas = await harness(t);
  const canvasId = await createCanvas(canvas);
  const commands = [
    {
      type: 'canvas.createCanvas',
      requestId: 'unknown-create',
      appSessionId: 'missing',
      mutationId: 'missing-create',
    },
    { type: 'canvas.attach', requestId: 'unknown-attach', appSessionId: 'missing', canvasId },
    { type: 'canvas.detach', requestId: 'unknown-detach', appSessionId: 'missing' },
  ];
  for (const command of commands) {
    await canvas.handle(command);
    assert.equal(errorOf(canvas, command.requestId).code, 'unknown_chat');
  }
  assert.equal(canvas.workspace.attachedCanvasId('missing'), null);
  assert.equal(canvas.workspace.listCanvases().length, 1);
});

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
  const canvasId = (await canvas.workspace.createCanvas(APP, 'create-foreign-canvas')).canvasId;
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

test('reading source answers one revision’s tree and refuses another design’s', async (t) => {
  const canvas = await harness(t);
  const canvasId = await createCanvas(canvas);
  const designId = await createFrame(canvas, canvasId);
  await canvas.handle({
    type: 'canvas.create',
    requestId: 'req-other-frame',
    appSessionId: APP,
    canvasId,
    input: {
      mutationId: 'm-create-other',
      frames: [{ name: 'Cards', width: 720, height: 720, designSystem }],
    },
  });
  const created = okReply(canvas, 'req-other-frame');
  assert.ok(created.kind === 'created');
  const other = created.created.frames[0]?.designId ?? '';

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
  const written = okReply(canvas, 'req-write-source');
  assert.ok(written.kind === 'written');
  const { revisionId } = written.receipt;

  // The source drawer's read: the complete tree, with the head left alone.
  await canvas.handle({
    type: 'canvas.readSource',
    requestId: 'req-source',
    canvasId,
    designId,
    revisionId,
  });
  const read = okReply(canvas, 'req-source');
  assert.ok(read.kind === 'source');
  // A null-prototype tree, so a source path can never reach an inherited member.
  assert.deepEqual(Object.entries(read.files), [['main.tsx', HEY]]);

  // A revision named with another design cannot be read through it.
  await canvas.handle({
    type: 'canvas.readSource',
    requestId: 'req-source-wrong',
    canvasId,
    designId: other,
    revisionId,
  });
  assert.equal(errorOf(canvas, 'req-source-wrong').code, 'invalid_input');

  await canvas.handle({
    type: 'canvas.readSource',
    requestId: 'req-source-missing',
    canvasId,
    designId,
    revisionId: 'rev_missing',
  });
  assert.equal(errorOf(canvas, 'req-source-missing').code, 'invalid_input');
});

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

  const root = await canvasRoot(t);
  const events: ServerEvent[] = [];
  const { handle } = canvasCommandHandler({
    ready: Promise.reject(new Error('canvases directory is read-only')),
    scopes: new CanvasScopes(),
    builds: quietBuilds(),
    events,
    root,
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
