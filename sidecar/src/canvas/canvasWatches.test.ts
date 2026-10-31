import assert from 'node:assert/strict';
import test from 'node:test';
import {
  APP,
  PAGE,
  activeTurnBuilds,
  answer,
  buildingCanvas,
  createCanvas,
  createFrame,
  designSystem,
  errorOf,
  harness,
  holdArtifactRead,
  okReply,
  pendingWorkspaceHandler,
  readyFrames,
  turnScope,
  watchedArtifact,
  writeFrame,
} from '../testing/canvasBridgeSupport.js';

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

for (const leaving of ['unsubscribe', 'page-gone'] as const) {
  test(`the last pane ${leaving} cancels running and queued builds without stopping another canvas`, async (t) => {
    const canvas = await buildingCanvas(t);
    const { fleet, builds } = canvas;
    const canvasId = await createCanvas(canvas);
    const ids = await Promise.all(
      ['one', 'two', 'three'].map((name) => createFrame(canvas, canvasId, `req-frame-${name}`)),
    );
    await canvas.handle({ type: 'canvas.subscribe', requestId: 'req-watch', canvasId });
    for (const designId of ids) await writeFrame(canvas, canvasId, designId);
    const first = await fleet.compile(1);
    const second = await fleet.compile(2);
    const other = await canvas.workspace.createCanvas('app-2', 'create-other-canvas');
    const otherTurn = canvas.turns.beginTurn('app-2', undefined);
    t.after(() => otherTurn.revoke());
    await canvas.handle(
      { type: 'canvas.subscribe', requestId: 'req-watch-other', canvasId: other.canvasId },
      'page-2',
    );
    const otherDesign = await createFrame(canvas, other.canvasId, 'req-other-frame', 'app-2');
    await writeFrame(canvas, other.canvasId, otherDesign, 'app-2');
    await canvas.handle(
      { type: 'canvas.subscribe', requestId: 'req-watch-shared', canvasId },
      'page-3',
    );
    if (leaving === 'unsubscribe')
      await canvas.handle({ type: 'canvas.unsubscribe', requestId: 'req-unwatch', canvasId });
    else canvas.pageGone(PAGE);
    assert.equal(first.signal.aborted, false, 'the other pane still wants this build');
    assert.equal(second.signal.aborted, false);
    if (leaving === 'unsubscribe')
      await canvas.handle(
        { type: 'canvas.unsubscribe', requestId: 'req-unwatch-last', canvasId },
        'page-3',
      );
    else canvas.pageGone('page-3');

    assert.equal(first.signal.aborted, true);
    assert.equal(second.signal.aborted, true);
    const continuing = await fleet.compile(3);
    assert.equal(continuing.input.designId, otherDesign);
    assert.equal(continuing.signal.aborted, false);
    assert.deepEqual(
      ids.map((id) => builds.stateOf(canvasId, id).status),
      ['cancelled', 'cancelled', 'cancelled'],
    );
    first.ready('late-one');
    second.ready('late-two');
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(fleet.held.length, 3, 'only the other canvas entered compilation');
    assert.equal(
      canvas.events.some(
        (event) =>
          event.type === 'canvas.change' &&
          event.change.frames.some((frame) => frame.build.status === 'ready'),
      ),
      false,
    );
    assert.ok(answer(canvas, 'req-watch-other').type === 'canvas.snapshot');
    await builds.close();
  });

  test(`an active turn keeps running and queued builds after the last pane ${leaving}`, async (t) => {
    const { canvas, canvasId, scope, ids } = await activeTurnBuilds(t);
    const first = await canvas.fleet.compile(1);
    const second = await canvas.fleet.compile(2);
    if (leaving === 'unsubscribe')
      await canvas.handle({ type: 'canvas.unsubscribe', requestId: 'req-unwatch', canvasId });
    else canvas.pageGone(PAGE);

    assert.equal(canvas.scopes.isScopeActive(scope.scopeId), true);
    assert.equal(first.signal.aborted, false);
    assert.equal(second.signal.aborted, false);
    assert.deepEqual(
      ids.map((id) => canvas.builds.stateOf(canvasId, id).status),
      ['building', 'building', 'pending'],
    );
    canvas.events.length = 0;
    const ready = readyFrames(canvas, canvasId, ids);
    first.ready('artifact-one');
    second.ready('artifact-two');
    const third = await canvas.fleet.compile(3);
    assert.equal(third.input.designId, ids[2]);
    assert.equal(third.signal.aborted, false);
    third.ready('artifact-three');
    await ready;
    assert.deepEqual(
      ids.map((id) => canvas.builds.stateOf(canvasId, id).status),
      ['ready', 'ready', 'ready'],
    );
    assert.deepEqual(
      canvas.events.filter((event) => event.type === 'canvas.change'),
      [],
    );
  });
}

for (const owner of [
  'live pane',
  'unsubscribe',
  'page-gone',
  'other pane',
  'active turn',
  'revoked turn',
  'replacement turn',
  'replacement pane',
  'turn for another design',
] as const) {
  test(`artifact cache recovery rechecks ${owner} authority after reading`, async (t) => {
    const held = holdArtifactRead();
    const { canvas, canvasId, designId, before } = await watchedArtifact(t, held.fs);
    if (owner === 'other pane')
      await canvas.handle(
        { type: 'canvas.subscribe', requestId: 'req-other-watch', canvasId },
        'other-page',
      );
    const context =
      owner === 'turn for another design'
        ? {
            designs: [
              {
                designId: await createFrame(canvas, canvasId, 'req-other-frame'),
                revisionId: null,
              },
            ],
            elements: [],
            designSystem,
          }
        : undefined;
    const turn = owner.includes('turn') ? canvas.turns.beginTurn(APP, context) : undefined;
    t.after(() => turn?.revoke());
    held.arm();
    const reading = canvas.handle({
      type: 'canvas.readArtifact',
      requestId: 'req-artifact',
      canvasId,
      designId,
      revisionId: before.revisionId,
    });
    await held.reached;
    try {
      if (owner === 'page-gone') canvas.pageGone(PAGE);
      else if (owner !== 'live pane')
        await canvas.handle({ type: 'canvas.unsubscribe', requestId: 'req-unwatch', canvasId });
      if (owner === 'revoked turn') turn?.revoke();
      if (owner === 'replacement turn') {
        canvas.turns.endSession(APP);
        const replacement = canvas.turns.beginTurn(APP, undefined);
        t.after(() => replacement.revoke());
      }
      if (owner === 'replacement pane')
        await canvas.handle({
          type: 'canvas.subscribe',
          requestId: 'req-replacement-watch',
          canvasId,
        });
    } finally {
      held.release();
      await reading;
    }

    assert.deepEqual(okReply(canvas, 'req-artifact'), { kind: 'artifact', artifact: null });
    if (!['live pane', 'other pane', 'active turn'].includes(owner)) {
      assert.deepEqual(canvas.builds.stateOf(canvasId, designId), before);
      assert.equal(canvas.fleet.held.length, 1, 'the abandoned read admitted no rebuild');
      return;
    }
    assert.equal(canvas.builds.stateOf(canvasId, designId).status, 'building');
    const rebuilding = await canvas.fleet.compile(2);
    assert.equal(rebuilding.signal.aborted, false);
    assert.equal(rebuilding.input.generation, before.generation + 1);
    const recovered = readyFrames(canvas, canvasId, [designId]);
    rebuilding.ready('artifact-rebuilt');
    await recovered;
    assert.deepEqual(canvas.builds.stateOf(canvasId, designId), {
      status: 'ready',
      revisionId: before.revisionId,
      artifactId: 'artifact-rebuilt',
      elements: [],
      diagnostics: [],
      generation: before.generation + 1,
    });
  });
}

for (const leaving of ['page-gone', 'unsubscribe'] as const) {
  test(
    leaving === 'page-gone'
      ? 'a page that goes away while the workspace opens installs no watch'
      : 'a pending subscribe cancelled by unsubscribe installs no watch or rebuild',
    async (t) => {
      const { builds, canvas, canvasId, designId, events, listeners, handle, opening } =
        await pendingWorkspaceHandler(t);
      assert.equal(builds.stateOf(canvasId, designId).status, 'cancelled');
      const subscribing = handle(
        { type: 'canvas.subscribe', requestId: 'req-late', canvasId },
        PAGE,
      );
      // The pane leaves before Canvas storage finishes opening.
      if (leaving === 'page-gone') for (const listener of listeners) listener(PAGE);
      else await handle({ type: 'canvas.unsubscribe', requestId: 'req-unwatch', canvasId }, PAGE);
      opening.resolve();
      await subscribing;

      const answer = events.find(
        (event) => event.type === 'canvas.result' && event.requestId === 'req-late',
      );
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
    },
  );
}
