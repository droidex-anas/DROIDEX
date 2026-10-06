import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import {
  board,
  COMPILE_FAILED,
  CompilerFleet,
  failNextManifestWrite,
  fakeDeadlines,
  holdBuildOutput,
  holdOutcomeWrite,
  refuseOutcomeReads,
  standIn,
  storage,
  type Board,
} from '../testing/canvasBuildSupport.js';
import { CanvasBuilds } from './CanvasBuilds.js';
import { CanvasFiles } from './canvasFiles.js';
import type { CanvasManifest } from './canvasManifest.js';
import type { CanvasBuildState } from './protocol.js';

/** A yield to the event loop, so a premature resolution becomes visible. */
function drained(): Promise<void> {
  return new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

/** The manifest as it is saved, which is what a restart would read. */
async function savedManifest(canvas: Board): Promise<CanvasManifest> {
  const load = await new CanvasFiles(canvas.store.root).loadManifest(canvas.canvasId);
  if (load.state !== 'loaded') throw new Error(`the manifest is ${load.state}`);
  return load.manifest;
}

function diagnosticCodes(canvas: Board, designId: string): string[] {
  const build = canvas.frame(designId).build;
  return build.status === 'failed' ? build.diagnostics.map((entry) => entry.code) : [];
}

/** Every build state a published change reported for one frame, in order. */
function reportedStates(canvas: Board, designId: string): CanvasBuildState[] {
  return canvas.changes.flatMap((change) =>
    change.frames.filter((frame) => frame.designId === designId).map((frame) => frame.build),
  );
}

test('an older build that finishes under a newer one publishes nothing', async (t) => {
  const storage = holdBuildOutput();
  const canvas = await board(t, { fs: storage.fs });
  const [designId] = await canvas.create('Hey');
  assert.ok(designId);
  const first = await canvas.write(designId, null, 'one');
  const older = await canvas.fleet.compile(1);
  // The older build compiles and is saving its artifact when the next write
  // arrives, so its publication has to lose the frame it captured.
  storage.arm();
  older.ready('artifact-older');
  await storage.reached;
  const second = await canvas.write(designId, first.revisionId, 'two');
  const newer = await canvas.fleet.compile(2);
  assert.equal(older.signal.aborted, true);
  assert.equal(canvas.deadlines.live(), 1, 'the superseded build released its slot');

  storage.release();
  newer.ready('artifact-newer');
  await canvas.reported(designId, 'ready');

  const ready = {
    status: 'ready',
    revisionId: second.revisionId,
    artifactId: 'artifact-newer',
    generation: 2,
  };
  assert.deepEqual(canvas.frame(designId).build, ready);
  // One settlement for this design, and never the revision that was replaced.
  assert.deepEqual(
    reportedStates(canvas, designId).filter((build) => build.status === 'ready'),
    [ready],
  );
  assert.equal(canvas.deadlines.live(), 0, 'every slot was released once');
});

test('two builds run at a time and the rest wait in arrival order', async (t) => {
  const canvas = await board(t);
  const [one, two, three, four] = await canvas.create('One', 'Two', 'Three', 'Four');
  assert.ok(one && two && three && four);
  for (const designId of [one, two, three, four]) await canvas.write(designId, null, 'v1');
  await canvas.fleet.compile(2);

  assert.equal(canvas.fleet.held.length, 2, 'only two slots are occupied');
  assert.deepEqual(
    [canvas.frame(three).build.status, canvas.frame(four).build.status],
    ['pending', 'pending'],
  );

  (await canvas.fleet.compile(1)).ready('artifact-one');
  assert.equal((await canvas.fleet.compile(3)).input.designId, three, 'the oldest waiting design');
  (await canvas.fleet.compile(2)).ready('artifact-two');
  assert.equal((await canvas.fleet.compile(4)).input.designId, four);
});

test('a newer write replaces the queued build rather than adding one', async (t) => {
  const canvas = await board(t);
  const [one, two, three] = await canvas.create('One', 'Two', 'Three');
  assert.ok(one && two && three);
  await canvas.write(one, null, 'v1');
  await canvas.write(two, null, 'v1');
  const queued = await canvas.write(three, null, 'v1');
  await canvas.fleet.compile(2);
  const superseding = await canvas.write(three, queued.revisionId, 'v2');

  (await canvas.fleet.compile(1)).ready('artifact-one');
  assert.equal((await canvas.fleet.compile(3)).input.revisionId, superseding.revisionId);
  // The superseded revision never reached the compiler at all.
  assert.equal(
    canvas.fleet.held.some((held) => held.input.revisionId === queued.revisionId),
    false,
  );
});

test('an overdue build ends its compiler process and fails the frame', async (t) => {
  const canvas = await board(t);
  const [one, two] = await canvas.create('One', 'Two');
  assert.ok(one && two);
  const receipt = await canvas.write(one, null, 'v1');
  const overdue = await canvas.fleet.compile(1);

  canvas.deadlines.expire();
  assert.equal(overdue.signal.aborted, true);
  await canvas.reported(one, 'failed');

  const build = canvas.frame(one).build;
  assert.equal(build.status, 'failed');
  assert.equal(build.status === 'failed' && build.revisionId, receipt.revisionId);
  assert.deepEqual(diagnosticCodes(canvas, one), ['build_timeout']);
  assert.match(
    build.status === 'failed' ? (build.diagnostics[0]?.message ?? '') : '',
    /longer than 15 seconds/,
  );
  assert.equal(canvas.fleet.terminated, 1, 'the overdue process was ended');
  assert.equal(canvas.deadlines.live(), 0, 'the overdue build released its slot');

  // That slot forks a fresh process, so one bad design cannot end previews.
  await canvas.write(two, null, 'v1');
  (await canvas.fleet.compile(2)).ready('artifact-two');
  await canvas.reported(two, 'ready');
  assert.equal(canvas.fleet.clients.length, 2);
});

test('a compiler process that dies fails only the build it was running', async (t) => {
  const canvas = await board(t);
  const [one, two] = await canvas.create('One', 'Two');
  assert.ok(one && two);
  await canvas.write(one, null, 'v1');
  (await canvas.fleet.compile(1)).unavailable();
  await canvas.reported(one, 'failed');

  assert.deepEqual(diagnosticCodes(canvas, one), ['compiler_unavailable']);
  // The client forks a fresh process itself, so the slot keeps the one it has.
  assert.equal(canvas.fleet.terminated, 0);
  await canvas.write(two, null, 'v1');
  const next = await canvas.fleet.compile(2);
  assert.equal(canvas.fleet.clients.length, 1, 'the slot reused its own client');
  next.ready('artifact-two');
  await canvas.reported(two, 'ready');
});

test('an overdue build takes down only its own slot', async (t) => {
  const canvas = await board(t);
  const [one, two] = await canvas.create('One', 'Two');
  assert.ok(one && two);
  const overdue = await canvas.write(one, null, 'v1');
  const first = await canvas.fleet.compile(1);
  const healthy = await canvas.write(two, null, 'v1');
  const second = await canvas.fleet.compile(2);
  // Two builds overlap, so the second slot forked the only other process.
  assert.equal(canvas.fleet.clients.length, 2);
  assert.notEqual(first.client, second.client);
  assert.notEqual(overdue.revisionId, healthy.revisionId);

  // The oldest deadline in flight is the first build's.
  canvas.deadlines.expire();
  await canvas.reported(one, 'failed');
  second.ready('artifact-two');
  await canvas.reported(two, 'ready');

  assert.deepEqual(diagnosticCodes(canvas, one), ['build_timeout']);
  assert.deepEqual(canvas.frame(two).build, {
    status: 'ready',
    revisionId: healthy.revisionId,
    artifactId: 'artifact-two',
    generation: 1,
  });
  assert.equal(second.signal.aborted, false, 'the healthy build was never cancelled');
  assert.equal(canvas.fleet.terminated, 1, "only the overdue slot's process was ended");
  assert.equal(canvas.deadlines.live(), 0, 'both slots were released once');
});

test('a build whose commit fails leaves memory and disk agreeing', async (t) => {
  const storage = failNextManifestWrite();
  const canvas = await board(t, { fs: storage.fs });
  const [designId] = await canvas.create('Hey');
  assert.ok(designId);
  const receipt = await canvas.write(designId, null, 'v1');
  const compile = await canvas.fleet.compile(1);
  const before = await savedManifest(canvas);

  storage.arm();
  compile.ready('artifact-one');
  await storage.failed;
  // The build state is derived, so the frame keeps it and the pane reads it on
  // its next snapshot. The artifact is cached too: it was written before the
  // commit that would have published the frame.
  assert.equal(canvas.frame(designId).build.status, 'ready');
  const cached = await canvas.builds.readArtifact(canvas.canvasId, designId, receipt.revisionId);
  assert.equal(cached?.artifactId, 'artifact-one');
  assert.match(cached?.html ?? '', /<html>/);
  // Closing waits for the refused commit to reconcile the head from disk.
  await canvas.workspace.close();

  const after = await savedManifest(canvas);
  assert.equal(after.designs[0]?.lastWorkingRevisionId, null);
  assert.equal(after.sequence, before.sequence, 'the refused commit took no sequence with it');
  assert.deepEqual(
    after.mutations.map((entry) => entry.kind),
    before.mutations.map((entry) => entry.kind),
  );
  // Memory followed disk rather than the commit it could not make.
  const head = canvas.workspace.snapshot(canvas.canvasId);
  assert.equal(head.sequence, after.sequence);
  assert.equal(head.frames[0]?.revisionId, receipt.revisionId);
  assert.deepEqual(canvas.workspace.damagedCanvasIds(), []);
});

test('a lost artifact for the current revision is rebuilt, not just reported', async (t) => {
  const canvas = await board(t);
  const [designId] = await canvas.create('Hey');
  assert.ok(designId);
  const head = await canvas.write(designId, null, 'v1');
  (await canvas.fleet.compile(1)).ready('artifact-one');
  await canvas.reported(designId, 'ready');

  // The derived cache loses a document the manifest still vouches for. Nothing
  // else would ask for this design again: the sweep only takes `pending` and
  // `cancelled` frames, and this frame is `ready`.
  await rm(join(canvas.store.root, canvas.canvasId, 'builds', 'artifact-one.html'));
  assert.equal(await canvas.builds.readArtifact(canvas.canvasId, designId, head.revisionId), null);

  // Queued by the read itself, so the frame is already building for the same
  // revision under a later generation.
  assert.deepEqual(canvas.frame(designId).build, {
    status: 'building',
    revisionId: head.revisionId,
    generation: 2,
  });
  (await canvas.fleet.compile(2)).ready('artifact-two');
  await canvas.reported(designId, 'ready');
  assert.deepEqual(canvas.frame(designId).build, {
    status: 'ready',
    revisionId: head.revisionId,
    artifactId: 'artifact-two',
    // The rebuild is a second attempt on the same revision, and that is the move
    // a mounted preview reads: the document's own ID is unchanged.
    generation: 2,
  });
  // The replacement carries a new artifact ID, which is the change a mounted
  // preview needs in order to mount the document that now exists.
  const rebuilt = await canvas.builds.readArtifact(canvas.canvasId, designId, head.revisionId);
  assert.equal(rebuilt?.artifactId, 'artifact-two');
});

test('a lost fallback revision is a placeholder, never a rebuild', async (t) => {
  const canvas = await board(t);
  const [designId] = await canvas.create('Hey');
  assert.ok(designId);
  const working = await canvas.write(designId, null, 'v1');
  (await canvas.fleet.compile(1)).ready('artifact-working');
  await canvas.reported(designId, 'ready');
  const broken = await canvas.write(designId, working.revisionId, 'v2');
  (await canvas.fleet.compile(2)).failed('syntax_error');
  await canvas.reported(designId, 'failed');
  const failed = canvas.frame(designId).build;

  // The frame has moved past this revision, so asking for its lost artifact
  // queues nothing: rebuilding a revision that is not the head is Task 5's.
  await rm(join(canvas.store.root, canvas.canvasId, 'builds', 'artifact-working.html'));
  assert.equal(
    await canvas.builds.readArtifact(canvas.canvasId, designId, working.revisionId),
    null,
  );

  assert.deepEqual(canvas.frame(designId).build, failed);
  assert.equal(canvas.fleet.held.length, 2, 'no third compile was queued');
  assert.equal(broken.revisionId, canvas.frame(designId).revisionId);
});

test('a failed revision keeps the last working artifact and its revision', async (t) => {
  const canvas = await board(t);
  const [designId] = await canvas.create('Hey');
  assert.ok(designId);
  const working = await canvas.write(designId, null, 'v1');
  (await canvas.fleet.compile(1)).ready('artifact-working');
  await canvas.reported(designId, 'ready');
  const broken = await canvas.write(designId, working.revisionId, 'v2');
  (await canvas.fleet.compile(2)).failed('syntax_error');
  await canvas.reported(designId, 'failed');

  const failed = {
    status: 'failed',
    revisionId: broken.revisionId,
    diagnostics: [{ code: 'syntax_error', message: COMPILE_FAILED }],
    lastWorkingRevisionId: working.revisionId,
    generation: 2,
  };
  assert.deepEqual(canvas.frame(designId).build, failed);
  // The fallback the frame names is the one the manifest committed.
  assert.equal((await savedManifest(canvas)).designs[0]?.lastWorkingRevisionId, working.revisionId);
  // The working artifact is still there to show beside the diagnostics, and the
  // revision that failed has none of its own to offer.
  const fallback = await canvas.builds.readArtifact(canvas.canvasId, designId, working.revisionId);
  assert.equal(fallback?.artifactId, 'artifact-working');
  assert.match(fallback?.html ?? '', /<html>/);
  assert.equal(
    await canvas.builds.readArtifact(canvas.canvasId, designId, broken.revisionId),
    null,
  );

  const reopened = await board(t, { store: canvas.store });
  // The same outcome, restored on attempt zero: this session has built nothing.
  assert.deepEqual(reopened.frame(designId).build, { ...failed, generation: 0 });
});

test('a restart serves a cached artifact and rebuilds one that is gone', async (t) => {
  const canvas = await board(t);
  const [designId] = await canvas.create('Hey');
  assert.ok(designId);
  const receipt = await canvas.write(designId, null, 'v1');
  (await canvas.fleet.compile(1)).ready('artifact-one');
  await canvas.reported(designId, 'ready');

  // The transition persisted the pointer and nothing else: a build is not a
  // mutation, so it records no receipt and never touches the retry ledger.
  const saved = await savedManifest(canvas);
  assert.equal(saved.designs[0]?.lastWorkingRevisionId, receipt.revisionId);
  assert.deepEqual(
    saved.mutations.map((entry) => entry.kind),
    ['create', 'write'],
  );

  const reopened = await board(t, { store: canvas.store });
  assert.deepEqual(reopened.frame(designId).build, {
    status: 'ready',
    revisionId: receipt.revisionId,
    artifactId: 'artifact-one',
    // A restored outcome is attempt zero: nothing was built in this session.
    generation: 0,
  });
  // Nothing is rebuilt, because the cache can still serve this revision.
  reopened.builds.requestRebuilds(reopened.workspace.snapshot(reopened.canvasId));
  assert.equal(reopened.fleet.held.length, 0);

  await rm(join(canvas.store.root, canvas.canvasId, 'builds', 'artifact-one.html'));
  const recovered = await board(t, { store: canvas.store });
  assert.deepEqual(recovered.frame(designId).build, { status: 'pending', generation: 0 });
  // On demand, when a reader first asks for the canvas, and not before.
  assert.equal(recovered.fleet.held.length, 0);
  recovered.builds.requestRebuilds(recovered.workspace.snapshot(recovered.canvasId));
  const rebuild = await recovered.fleet.compile(1);
  assert.equal(rebuild.input.revisionId, receipt.revisionId);
  rebuild.ready('artifact-again');
  await recovered.reported(designId, 'ready');
});

test('cancelling a canvas releases its slots and reports its frames', async (t) => {
  const canvas = await board(t);
  const [one, two] = await canvas.create('One', 'Two');
  assert.ok(one && two);
  const first = await canvas.write(one, null, 'v1');
  const second = await canvas.write(two, null, 'v1');
  const running = await canvas.fleet.compile(1);
  await canvas.fleet.compile(2);

  canvas.builds.cancelCanvas(canvas.canvasId);
  assert.equal(running.signal.aborted, true);
  await canvas.reported(one, 'cancelled');
  assert.equal(canvas.deadlines.live(), 0, 'both slots were released');
  assert.deepEqual(canvas.frame(one).build, {
    status: 'cancelled',
    revisionId: first.revisionId,
    generation: 1,
  });
  assert.deepEqual(canvas.frame(two).build, {
    status: 'cancelled',
    revisionId: second.revisionId,
    generation: 1,
  });

  // The pane asking for the canvas again is what starts the work over: the
  // reserved frame, the write, the cancellation, then building once more.
  canvas.builds.requestRebuilds(canvas.workspace.snapshot(canvas.canvasId));
  await canvas.fleet.compile(4);
  assert.deepEqual(
    canvas.fleet.held
      .slice(2)
      .map((held) => held.input.revisionId)
      .sort(),
    [first.revisionId, second.revisionId].sort(),
  );
  assert.deepEqual(
    reportedStates(canvas, one)
      .map((build) => build.status)
      .slice(0, 3),
    ['pending', 'building', 'cancelled'],
  );
});

test('closing releases every slot and settles every waiter once', async (t) => {
  const canvas = await board(t);
  const [one, two] = await canvas.create('One', 'Two');
  assert.ok(one && two);
  await canvas.write(one, null, 'v1');
  await canvas.write(two, null, 'v1');
  const first = await canvas.fleet.compile(1);
  const second = await canvas.fleet.compile(2);

  await canvas.builds.close();
  assert.equal(first.signal.aborted, true);
  assert.equal(second.signal.aborted, true);

  assert.equal(canvas.deadlines.live(), 0);
  assert.equal(canvas.fleet.clients.length, 2, 'the two overlapping builds hold a slot each');
  assert.equal(canvas.fleet.terminated, 2, "every slot's process was ended once");
  // Nothing a closing registry was holding reaches the canvas: the frame was
  // reserved, the write reported it building, and that is all.
  assert.deepEqual(
    reportedStates(canvas, one).map((build) => build.status),
    ['pending', 'building'],
  );
  // Closing twice is the same close.
  await canvas.builds.close();
});

test('an artifact that lands after a newer attempt failed is not resurrected', async (t) => {
  const storage = holdBuildOutput();
  const canvas = await board(t, { fs: storage.fs });
  const [designId] = await canvas.create('Hey');
  assert.ok(designId);
  const receipt = await canvas.write(designId, null, 'v1');
  const stale = await canvas.fleet.compile(1);

  // The first attempt is saving its artifact when it loses the frame.
  storage.arm();
  stale.ready('artifact-stale');
  await storage.reached;
  canvas.builds.cancelCanvas(canvas.canvasId);
  await canvas.reported(designId, 'cancelled');
  canvas.builds.requestRebuilds(canvas.workspace.snapshot(canvas.canvasId));
  const current = await canvas.fleet.compile(2);
  assert.equal(current.input.revisionId, receipt.revisionId);
  current.failed('syntax_error');
  await canvas.reported(designId, 'failed');

  assert.equal(canvas.frame(designId).build.status, 'failed');

  // Only now does the first attempt finish writing, under the newer outcome.
  // Closing drains it, which is what a restart would wait for too.
  storage.release();
  await canvas.builds.close();

  const reopened = await board(t, { store: canvas.store });
  assert.equal(reopened.frame(designId).build.status, 'failed', 'the cache kept the newer outcome');
});

test('an outcome that loses its frame while it writes takes its file back', async (t) => {
  const storage = holdOutcomeWrite();
  const canvas = await board(t, { fs: storage.fs });
  const [designId] = await canvas.create('Hey');
  assert.ok(designId);
  const receipt = await canvas.write(designId, null, 'v1');
  const first = await canvas.fleet.compile(1);

  storage.arm();
  first.ready('artifact-one');
  await storage.reached;

  // The frame is cancelled and rebuilt while that outcome is being placed, and
  // the replacement fails. Its commit queues behind the one that is paused, so
  // the paused one has to find its frame gone and leave nothing behind.
  canvas.builds.cancelCanvas(canvas.canvasId);
  canvas.builds.requestRebuilds(canvas.workspace.snapshot(canvas.canvasId));
  const replacement = await canvas.fleet.compile(2);
  assert.equal(replacement.input.revisionId, receipt.revisionId);
  replacement.failed('syntax_error');

  storage.release();
  await canvas.reported(designId, 'failed');

  assert.deepEqual(canvas.frame(designId).build, {
    status: 'failed',
    revisionId: receipt.revisionId,
    diagnostics: [{ code: 'syntax_error', message: COMPILE_FAILED }],
    lastWorkingRevisionId: null,
    generation: 2,
  });
  assert.equal(
    reportedStates(canvas, designId).some((build) => build.status === 'ready'),
    false,
    'the abandoned success was never published',
  );
  const saved = await savedManifest(canvas);
  assert.equal(saved.designs[0]?.lastWorkingRevisionId, null);
  const outcome = await new CanvasFiles(canvas.store.root).readBuildOutput(
    canvas.canvasId,
    `${receipt.revisionId}.json`,
  );
  assert.match(outcome ?? '', /"status":"failed"/);

  await canvas.builds.close();
  const reopened = await board(t, { store: canvas.store });
  assert.equal(reopened.frame(designId).build.status, 'failed');
});

test('an outcome that finishes writing after close publishes nothing', async (t) => {
  const storage = holdOutcomeWrite();
  const canvas = await board(t, { fs: storage.fs });
  const [designId] = await canvas.create('Hey');
  assert.ok(designId);
  await canvas.write(designId, null, 'v1');
  const first = await canvas.fleet.compile(1);

  storage.arm();
  first.ready('artifact-one');
  await storage.reached;

  // Closing runs outside the commit queue, so the paused outcome has to find
  // the registry shut before it records anything.
  const closing = canvas.builds.close();
  storage.release();
  await closing;

  assert.equal(
    reportedStates(canvas, designId).some((build) => build.status === 'ready'),
    false,
  );
  assert.equal((await savedManifest(canvas)).designs[0]?.lastWorkingRevisionId, null);
  // The artifact is content-addressed and harmless; the outcome went back.
  assert.deepEqual(
    [...(await new CanvasFiles(canvas.store.root).listBuildOutputs(canvas.canvasId))],
    ['artifact-one.html'],
  );
});

test('an outcome the manifest never vouched for is not restored', async (t) => {
  const storage = holdOutcomeWrite({ refuseRemoval: true });
  const canvas = await board(t, { fs: storage.fs });
  const [designId] = await canvas.create('Hey');
  assert.ok(designId);
  const receipt = await canvas.write(designId, null, 'v1');
  const first = await canvas.fleet.compile(1);

  storage.arm();
  first.ready('artifact-one');
  await storage.reached;
  const closing = canvas.builds.close();
  storage.release();
  await closing;

  // Nothing published, and the removal that would have taken the file back was
  // refused, so the cache is left holding an outcome for an unpublished build.
  assert.equal((await savedManifest(canvas)).designs[0]?.lastWorkingRevisionId, null);
  const files = new CanvasFiles(canvas.store.root);
  assert.deepEqual(
    [...(await files.listBuildOutputs(canvas.canvasId))].sort(),
    ['artifact-one.html', `${receipt.revisionId}.json`].sort(),
  );

  // The manifest decides, so no pointer means no preview, whatever is on disk.
  const reopened = await board(t, { store: canvas.store });
  assert.deepEqual(reopened.frame(designId).build, { status: 'pending', generation: 0 });
  reopened.builds.requestRebuilds(reopened.workspace.snapshot(reopened.canvasId));
  assert.equal((await reopened.fleet.compile(1)).input.revisionId, receipt.revisionId);
});

test('an outcome that cannot be read is a cache miss, not a failed open', async (t) => {
  const canvas = await board(t);
  const [designId] = await canvas.create('Hey');
  assert.ok(designId);
  const receipt = await canvas.write(designId, null, 'v1');
  (await canvas.fleet.compile(1)).ready('artifact-one');
  await canvas.reported(designId, 'ready');
  await canvas.builds.close();

  // The outcome is saved and vouched for, and unreadable when it is wanted.
  const reopened = await board(t, { store: canvas.store, fs: refuseOutcomeReads() });
  assert.deepEqual(reopened.frame(designId).build, { status: 'pending', generation: 0 });
  reopened.builds.requestRebuilds(reopened.workspace.snapshot(reopened.canvasId));
  assert.equal((await reopened.fleet.compile(1)).input.revisionId, receipt.revisionId);
});

test('a failure of the attempt rather than the design is retried on restart', async (t) => {
  const canvas = await board(t);
  const [designId] = await canvas.create('Hey');
  assert.ok(designId);
  const receipt = await canvas.write(designId, null, 'v1');
  await canvas.fleet.compile(1);
  canvas.deadlines.expire();
  await canvas.reported(designId, 'failed');
  assert.deepEqual(diagnosticCodes(canvas, designId), ['build_timeout']);
  await canvas.builds.close();

  // A timeout is this attempt's, not the source's, so the cache keeps nothing
  // and the advice it gave ("restart DROIDEX") is not still there afterwards.
  const files = new CanvasFiles(canvas.store.root);
  assert.deepEqual([...(await files.listBuildOutputs(canvas.canvasId))], []);
  const reopened = await board(t, { store: canvas.store });
  assert.deepEqual(reopened.frame(designId).build, { status: 'pending', generation: 0 });
  reopened.builds.requestRebuilds(reopened.workspace.snapshot(reopened.canvasId));
  assert.equal((await reopened.fleet.compile(1)).input.revisionId, receipt.revisionId);
});

test('an outcome for a revision the frame has moved past is ignored', async (t) => {
  const canvas = await board(t);
  const [designId] = await canvas.create('Hey');
  assert.ok(designId);
  const first = await canvas.write(designId, null, 'v1');
  (await canvas.fleet.compile(1)).failed('syntax_error');
  await canvas.reported(designId, 'failed');
  // The next revision is never built, so only the one before it is cached.
  const second = await canvas.write(designId, first.revisionId, 'v2');
  await canvas.fleet.compile(2);
  await canvas.builds.close();
  const files = new CanvasFiles(canvas.store.root);
  assert.deepEqual(
    [...(await files.listBuildOutputs(canvas.canvasId))],
    [`${first.revisionId}.json`],
  );

  const reopened = await board(t, { store: canvas.store });
  assert.deepEqual(reopened.frame(designId).build, { status: 'pending', generation: 0 });
  assert.equal(reopened.frame(designId).revisionId, second.revisionId);
});

test('the deadline is released the moment a compile settles', async (t) => {
  const storage = holdBuildOutput();
  const canvas = await board(t, { fs: storage.fs });
  const [one, two, three] = await canvas.create('One', 'Two', 'Three');
  assert.ok(one && two && three);
  for (const designId of [one, two, three]) await canvas.write(designId, null, 'v1');
  const first = await canvas.fleet.compile(1);
  await canvas.fleet.compile(2);
  assert.equal(canvas.deadlines.live(), 2, 'one deadline per compiling build');

  storage.arm();
  first.ready('artifact-one');
  await storage.reached;
  // Saving is bounded by storage, not by the build deadline, so nothing can
  // declare this build overdue while it writes.
  assert.equal(canvas.deadlines.live(), 1, 'the settled compile released its deadline');

  storage.release();
  await canvas.reported(one, 'ready');
  // One settlement, and the slot it held went to the design that was waiting.
  assert.deepEqual(
    reportedStates(canvas, one).filter((build) => build.status === 'ready').length,
    1,
  );
  assert.equal((await canvas.fleet.compile(3)).input.designId, three);
  assert.equal(canvas.fleet.terminated, 0, 'no process was ended for a build that finished');
});

test('closing waits for a termination it has already started', async (t) => {
  const canvas = await board(t);
  const [designId] = await canvas.create('Hey');
  assert.ok(designId);
  await canvas.write(designId, null, 'v1');
  await canvas.fleet.compile(1);

  canvas.fleet.holdTerminations();
  canvas.deadlines.expire();
  const closing = canvas.builds.close().then(() => canvas.fleet.ended.push('closed'));
  // A yield past every pending microtask: a close that did not wait for the
  // termination it started would already have finished here.
  await drained();
  assert.deepEqual(canvas.fleet.ended, []);

  canvas.fleet.releaseTerminations();
  await closing;
  assert.deepEqual(canvas.fleet.ended, ['client-1', 'closed']);
});

test('a frame seeded from a saved revision is built like a write', async (t) => {
  const canvas = await board(t);
  const [source] = await canvas.create('Source');
  assert.ok(source);
  const receipt = await canvas.write(source, null, 'v1');
  (await canvas.fleet.compile(1)).ready('artifact-source');
  await canvas.reported(source, 'ready');

  const seeded = await canvas.createSeeded('Copy', source, receipt.revisionId);
  const copy = await canvas.fleet.compile(2);
  assert.equal(copy.input.designId, seeded);
  assert.notEqual(copy.input.revisionId, receipt.revisionId, 'the copy owns its own revision');
  copy.ready('artifact-copy');
  await canvas.reported(seeded, 'ready');
  assert.deepEqual(canvas.frame(seeded).build, {
    status: 'ready',
    revisionId: copy.input.revisionId,
    artifactId: 'artifact-copy',
    generation: 1,
  });
});

test('a rebuild sweep from an old projection leaves the current state alone', async (t) => {
  const canvas = await board(t);
  const [one, two, three] = await canvas.create('One', 'Two', 'Three');
  assert.ok(one && two && three);
  // Both slots are busy, so the third frame is published as pending.
  await canvas.write(one, null, 'v1');
  await canvas.write(two, null, 'v1');
  const queued = await canvas.write(three, null, 'v1');
  const stale = canvas.workspace.snapshot(canvas.canvasId);
  assert.deepEqual(canvas.frame(three).build, { status: 'pending', generation: 0 });

  // Let it build, then move it on to a revision that projection never saw.
  (await canvas.fleet.compile(1)).ready('artifact-one');
  (await canvas.fleet.compile(3)).ready('artifact-three');
  await canvas.reported(three, 'ready');
  const current = await canvas.write(three, queued.revisionId, 'v2');
  (await canvas.fleet.compile(4)).ready('artifact-current');
  await canvas.reported(three, 'ready');
  // A frame publishes its outcome before it releases its slot, so the sweep
  // below has to meet a frame that is only holding its revision.
  await drained();

  canvas.builds.requestRebuilds(stale);
  assert.deepEqual(canvas.frame(three).build, {
    status: 'ready',
    revisionId: current.revisionId,
    artifactId: 'artifact-current',
    generation: 2,
  });
  assert.equal(canvas.fleet.held.length, 4, 'nothing was rebuilt for a revision that is gone');
});

test('a design that leaves its canvas mid-build publishes nothing', async (t) => {
  const fleet = new CompilerFleet();
  const deadlines = fakeDeadlines();
  const builds = new CanvasBuilds({ compiler: fleet.client, deadline: deadlines.deadline });
  t.after(() => builds.close());
  const files = new CanvasFiles((await storage(t)).root);
  await files.createRoot();
  const canvas = standIn(builds);
  for (const designId of ['one', 'two', 'three'])
    canvas.revisions.set(`cv_01/${designId}`, `rev_${designId}`);
  await builds.load(canvas.host, files, []);

  for (const designId of ['one', 'two', 'three'])
    builds.enqueue('cv_01', designId, `rev_${designId}`);
  const held = await fleet.compile(1);
  // Task 6's delete removes the frame while its build is still running.
  canvas.revisions.delete('cv_01/one');
  held.ready('artifact-orphan');
  // The slot it held is the one the waiting design starts on, and the registry
  // is still open: only deletion decided this build's outcome.
  const next = await fleet.compile(3);
  assert.equal(next.input.designId, 'three');

  assert.equal(
    canvas.committed.some((entry) => entry.startsWith('cv_01/one:')),
    false,
    'nothing was published for the design that left',
  );
  assert.deepEqual(builds.stateOf('cv_01', 'one'), { status: 'pending', generation: 0 });
  assert.deepEqual([...(await files.listBuildOutputs('cv_01'))], []);
  assert.equal(deadlines.live(), 2, 'the orphaned build released its slot and its deadline');
});

test('one design ID on two canvases keeps two build states', async (t) => {
  const fleet = new CompilerFleet();
  const deadlines = fakeDeadlines();
  const builds = new CanvasBuilds({ compiler: fleet.client, deadline: deadlines.deadline });
  t.after(() => builds.close());
  const files = new CanvasFiles((await storage(t)).root);
  await files.createRoot();
  const canvas = standIn(builds);
  canvas.revisions.set('cv_01/dsg_hey', 'rev_01');
  canvas.revisions.set('cv_02/dsg_hey', 'rev_02');
  await builds.load(canvas.host, files, []);

  builds.enqueue('cv_01', 'dsg_hey', 'rev_01');
  builds.enqueue('cv_02', 'dsg_hey', 'rev_02');
  (await fleet.compile(1)).ready('artifact-one');
  (await fleet.compile(2)).failed('syntax_error');
  await canvas.settled('cv_01/dsg_hey:ready');
  await canvas.settled('cv_02/dsg_hey:failed');

  // Each canvas kept its own state and its own outcome.
  assert.deepEqual(builds.stateOf('cv_01', 'dsg_hey'), {
    status: 'ready',
    revisionId: 'rev_01',
    artifactId: 'artifact-one',
    generation: 1,
  });
  assert.equal(builds.stateOf('cv_02', 'dsg_hey').status, 'failed');
  assert.deepEqual([...(await files.listBuildOutputs('cv_01'))].sort(), [
    'artifact-one.html',
    'rev_01.json',
  ]);
  assert.match((await files.readBuildOutput('cv_02', 'rev_02.json')) ?? '', /"status":"failed"/);
});
