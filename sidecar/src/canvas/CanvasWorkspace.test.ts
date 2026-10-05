import assert from 'node:assert/strict';
import { readdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import test, { type TestContext } from 'node:test';
import {
  canvasRoot,
  ledgerAtCapacity,
  observedFileSystem,
} from '../testing/canvasStorageSupport.js';
import { CanvasFiles, type CanvasFileSystem } from './canvasFiles.js';
import { mutationFingerprint } from './canvasManifest.js';
import { CanvasWorkspace, type CanvasWorkspaceDeps } from './CanvasWorkspace.js';
import type { CanvasScope, CreateFramesInput, WriteFilesInput } from './protocol.js';

const designSystem = { id: 'droidex', version: 1, mode: 'light' } as const;
const HEY = 'export default function Hey(){return <h1>Hey</h1>}';

function scopeFor(
  canvasId: string | null,
  allowedDesignIds: string[] | 'canvas' = 'canvas',
  scopeId = 'scope-1',
): CanvasScope {
  return {
    scopeId,
    appSessionId: 'app-1',
    generation: 1,
    canvasId,
    context: { designs: [], elements: [], designSystem },
    allowedDesignIds,
  };
}

/** The one 720x720 frame named Hey that most create cases reserve. */
function createInput(mutationId: string): CreateFramesInput {
  return { mutationId, frames: [{ name: 'Hey', width: 720, height: 720, designSystem }] };
}

function writeInput(
  mutationId: string,
  designId: string,
  expectedRevisionId: string | null,
  files: Record<string, string>,
  deletedPaths: string[] = [],
): WriteFilesInput {
  return { mutationId, designId, expectedRevisionId, files, deletedPaths };
}

/** A promise a test resolves itself, to hold or release an awaited filesystem call. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/**
 * A filesystem that fails once when armed, either just before the next manifest
 * rename or on the durability flush that follows it. It disarms as it fires, so
 * a test can keep using the workspace afterwards.
 */
function terminateAtManifestRename(side: 'before' | 'after') {
  let armed = false;
  let renamed = false;
  const fs = observedFileSystem((operation, path) => {
    if (!armed) return;
    if (operation === 'rename' && path.endsWith('manifest.json')) {
      if (side === 'before') {
        armed = false;
        throw new Error('power lost');
      }
      renamed = true;
      return;
    }
    if (side === 'after' && renamed && operation === 'open') {
      armed = false;
      renamed = false;
      throw new Error('power lost');
    }
  });
  return {
    fs,
    arm: () => {
      armed = true;
    },
  };
}

/**
 * Holds the next manifest write open until the test releases it: `prepared` is
 * the window with a durable replacement and nothing published, `published` is
 * the window after the rename and before its directory entry is flushed.
 */
function holdManifestWrite(stage: 'prepared' | 'published') {
  let armed = false;
  let renamed = false;
  const reached = deferred();
  const released = deferred();
  const hold = async (): Promise<void> => {
    armed = false;
    reached.resolve();
    await released.promise;
  };
  const fs = observedFileSystem(async (operation, path) => {
    if (!armed) return;
    if (operation === 'rename' && path.endsWith('manifest.json')) {
      renamed = true;
      return;
    }
    if (operation !== 'open') return;
    if (stage === 'prepared' && path.endsWith('.tmp')) await hold();
    if (stage === 'published' && renamed) await hold();
  });
  return {
    fs,
    arm: () => {
      armed = true;
    },
    reached: reached.promise,
    release: released.resolve,
  };
}

/**
 * A filesystem that renames the next manifest into place and then stops
 * flushing directories, so that save becomes visible but never durable.
 */
function stopFlushingAfterManifestRename() {
  let armed = false;
  let renamed = false;
  const fs = observedFileSystem((operation, path) => {
    if (!armed) return;
    if (operation === 'rename' && path.endsWith('manifest.json')) {
      renamed = true;
      return;
    }
    if (renamed && operation === 'open' && !basename(path).includes('.'))
      throw new Error('the volume stopped flushing');
  });
  return {
    fs,
    arm: () => {
      armed = true;
    },
  };
}

interface Options {
  fs?: CanvasFileSystem;
  isScopeActive?: (scopeId: string) => boolean;
  bindScopeCanvas?: (scopeId: string, canvasId: string) => void;
}

async function openWorkspace(t: TestContext, options: Options = {}) {
  const root = await canvasRoot(t);
  const boundCanvasIds: string[] = [];
  const deps: CanvasWorkspaceDeps = {
    isScopeActive: options.isScopeActive ?? (() => true),
    bindScopeCanvas: (scopeId, canvasId) => {
      if (options.bindScopeCanvas) options.bindScopeCanvas(scopeId, canvasId);
      boundCanvasIds.push(canvasId);
    },
    fs: options.fs,
  };
  const workspace = await CanvasWorkspace.open(root, deps);
  t.after(() => workspace.close());
  return { root, deps, workspace, boundCanvasIds };
}

/** One canvas holding one reserved 720×720 frame named Hey. */
async function withFrame(t: TestContext, options: Options = {}) {
  const context = await openWorkspace(t, options);
  const { canvasId } = await context.workspace.createCanvas();
  const scope = scopeFor(canvasId);
  const created = await context.workspace.create(scope, createInput('create-hey'));
  const frame = created.frames[0];
  assert.ok(frame);
  assert.deepEqual(frame.rect, { x: 0, y: 0, width: 720, height: 720 });
  assert.equal(frame.layoutVersion, 0);
  assert.equal(frame.revisionId, null);
  return { ...context, canvasId, scope, designId: frame.designId };
}

test('a write checkpoints source once per mutation ID and refuses a stale revision', async (t) => {
  const { workspace, scope, canvasId, designId } = await withFrame(t);
  const input = writeInput('write-hey', designId, null, { 'main.tsx': HEY });
  const first = await workspace.write(scope, input);
  assert.deepEqual(await workspace.write(scope, input), first);
  await assert.rejects(workspace.write(scope, { ...input, mutationId: 'stale-write' }), {
    code: 'revision_conflict',
  });
  assert.equal((await workspace.readFiles(canvasId, first))['main.tsx'], HEY);
  await assert.rejects(workspace.readFiles(canvasId, { designId, revisionId: 'rev_missing' }), {
    code: 'invalid_input',
  });
  // That ID is spent on this request: it cannot carry a different one.
  await assert.rejects(workspace.write(scope, { ...input, files: { 'main.tsx': 'other' } }), {
    code: 'invalid_input',
  });
  // The retry neither committed again nor moved the projection forward.
  assert.equal(workspace.snapshot(canvasId).sequence, first.sequence);
  assert.equal(workspace.snapshot(canvasId).frames[0]?.revisionId, first.revisionId);
});

test('a reopen after termination before the manifest rename finds the old head', async (t) => {
  const fault = terminateAtManifestRename('before');
  const { root, deps, workspace, scope, canvasId, designId } = await withFrame(t, { fs: fault.fs });
  fault.arm();
  await assert.rejects(
    workspace.write(scope, writeInput('write-hey', designId, null, { 'main.tsx': HEY })),
    { code: 'storage_failed' },
  );
  const reopened = await CanvasWorkspace.open(root, { ...deps, fs: undefined });
  assert.equal(reopened.snapshot(canvasId).frames[0]?.revisionId, null);
});

test('a refused write keeps the current head and does not spend its mutation ID', async (t) => {
  let failRevisionRename = true;
  const { workspace, scope, canvasId, designId } = await withFrame(t, {
    fs: observedFileSystem((operation, path) => {
      if (failRevisionRename && operation === 'rename' && path.includes('revisions'))
        throw new Error('disk full');
    }),
  });
  const input = writeInput('write-hey', designId, null, { 'main.tsx': HEY });
  await assert.rejects(workspace.write(scope, input), { code: 'storage_failed' });
  await assert.rejects(workspace.write(scope, writeInput('cas-miss', designId, 'rev_gone', {})), {
    code: 'revision_conflict',
  });
  assert.equal(workspace.snapshot(canvasId).frames[0]?.revisionId, null);

  failRevisionRename = false;
  const receipt = await workspace.write(scope, input);
  assert.equal(workspace.snapshot(canvasId).frames[0]?.revisionId, receipt.revisionId);
  const retried = await workspace.write(
    scope,
    writeInput('cas-miss', designId, receipt.revisionId, {}),
  );
  assert.notEqual(retried.revisionId, receipt.revisionId);
});

test('two writers against one expected revision accept exactly one source head', async (t) => {
  const { workspace, scope, canvasId, designId } = await withFrame(t);
  const [first, second] = await Promise.allSettled([
    workspace.write(scope, writeInput('write-a', designId, null, { 'main.tsx': HEY })),
    workspace.write(
      scope,
      writeInput('write-b', designId, null, { 'main.tsx': 'export default () => null' }),
    ),
  ]);
  assert.ok(first && second);
  const accepted = [first, second].filter((result) => result.status === 'fulfilled');
  const refused = [first, second].filter((result) => result.status === 'rejected');
  assert.equal(accepted.length, 1);
  assert.equal(refused.length, 1);
  assert.equal(refused[0]?.status === 'rejected' && refused[0].reason.code, 'revision_conflict');
  assert.equal(
    workspace.snapshot(canvasId).frames[0]?.revisionId,
    accepted[0]?.status === 'fulfilled' ? accepted[0].value.revisionId : null,
  );
});

test('a layout change and a source write both land, and an arrange retry answers its own layout', async (t) => {
  const staged = deferred();
  const gate = deferred();
  const { workspace, scope, canvasId, designId } = await withFrame(t, {
    fs: observedFileSystem(async (operation, path) => {
      if (operation !== 'rename' || !path.includes('revisions')) return;
      staged.resolve();
      await gate.promise;
    }),
  });
  const writing = workspace.write(
    scope,
    writeInput('write-hey', designId, null, { 'main.tsx': HEY }),
  );
  await staged.promise;

  const rect = { x: 900, y: 40, width: 720, height: 720 };
  const change = await workspace.arrange(scope, {
    mutationId: 'arrange-hey',
    frames: [{ designId, expectedLayoutVersion: 0, rect }],
  });
  assert.deepEqual(change.frames[0]?.rect, rect);
  assert.equal(change.frames[0]?.layoutVersion, 1);

  gate.resolve();
  const receipt = await writing;
  const frame = workspace.snapshot(canvasId).frames[0];
  assert.deepEqual(frame?.rect, rect);
  assert.equal(frame.layoutVersion, 1);
  assert.equal(frame.revisionId, receipt.revisionId);
  // A second arrange moves the frame on, so the retry below can only answer
  // the first layout from what that commit recorded.
  const movedAgain = { x: 60, y: 0, width: 720, height: 720 };
  await workspace.arrange(scope, {
    mutationId: 'arrange-again',
    frames: [{ designId, expectedLayoutVersion: 1, rect: movedAgain }],
  });
  const retried = await workspace.arrange(scope, {
    mutationId: 'arrange-hey',
    frames: [{ designId, expectedLayoutVersion: 0, rect }],
  });
  assert.equal(retried.sequence, change.sequence);
  assert.deepEqual(retried.frames[0]?.rect, rect);
  assert.equal(retried.frames[0]?.layoutVersion, 1);
  assert.deepEqual(workspace.snapshot(canvasId).frames[0]?.rect, movedAgain);
  // Fields the retry does not own show the current head, which is why the
  // renderer discards a change older than its projection.
  assert.equal(retried.frames[0]?.revisionId, receipt.revisionId);
  await assert.rejects(
    workspace.arrange(scope, {
      mutationId: 'arrange-hey',
      frames: [{ designId, expectedLayoutVersion: 0, rect: { ...rect, x: 0 } }],
    }),
    { code: 'invalid_input' },
  );
});

test('a lease revoked while the revision is being written publishes nothing', async (t) => {
  let active = true;
  const staged = deferred();
  const gate = deferred();
  const { root, deps, workspace, scope, canvasId, designId } = await withFrame(t, {
    isScopeActive: () => active,
    fs: observedFileSystem(async (operation, path) => {
      if (operation !== 'rename' || !path.includes('revisions')) return;
      staged.resolve();
      await gate.promise;
    }),
  });
  const writing = workspace.write(
    scope,
    writeInput('write-hey', designId, null, { 'main.tsx': HEY }),
  );
  await staged.promise;
  active = false;
  gate.resolve();

  await assert.rejects(writing, { code: 'scope_expired' });
  assert.equal(workspace.snapshot(canvasId).frames[0]?.revisionId, null);
  // The orphan revision is allowed on disk; nothing may ever reference it.
  assert.equal((await readdir(join(root, canvasId, 'revisions'))).length, 1);
  const reopened = await CanvasWorkspace.open(root, { ...deps, fs: undefined });
  assert.equal(reopened.snapshot(canvasId).frames[0]?.revisionId, null);
});

test('a mutation needs a live lease that names this canvas and this frame', async (t) => {
  let active = true;
  const { workspace, canvasId, scope, designId } = await withFrame(t, {
    isScopeActive: () => active,
  });
  const frames = [
    { designId, expectedLayoutVersion: 0, rect: { x: 0, y: 0, width: 720, height: 720 } },
  ];
  const newFrames = [{ name: 'Cards', width: 720, height: 720, designSystem }];

  const otherCanvas = scopeFor('cv_elsewhere');
  await assert.rejects(workspace.write(otherCanvas, writeInput('m1', designId, null, {})), {
    code: 'scope_expired',
  });
  await assert.rejects(workspace.arrange(otherCanvas, { mutationId: 'm2', frames }), {
    code: 'scope_expired',
  });

  const narrow = scopeFor(canvasId, ['dsg_elsewhere']);
  await assert.rejects(workspace.write(narrow, writeInput('m3', designId, null, {})), {
    code: 'scope_expired',
  });
  // A lease bound to named frames may change those, never add more.
  await assert.rejects(workspace.create(narrow, { mutationId: 'm4', frames: newFrames }), {
    code: 'scope_expired',
  });

  active = false;
  await assert.rejects(workspace.write(scope, writeInput('m5', designId, null, {})), {
    code: 'scope_expired',
  });
  await assert.rejects(workspace.create(scope, { mutationId: 'm6', frames: newFrames }), {
    code: 'scope_expired',
  });
  assert.equal(workspace.snapshot(canvasId).frames.length, 1);
});

test('the source limits and path rules hold against the whole revision', async (t) => {
  const { workspace, scope, canvasId, designId } = await withFrame(t);
  const quarter = 'x'.repeat(256 * 1024);
  const full = await workspace.write(
    scope,
    writeInput('bulk', designId, null, {
      'a.txt': quarter,
      'b.txt': quarter,
      'c.txt': quarter,
      'd.txt': quarter,
    }),
  );
  await assert.rejects(
    workspace.write(
      scope,
      writeInput('one-byte-more', designId, full.revisionId, { 'e.txt': 'x' }),
    ),
    { code: 'invalid_input' },
  );
  // Deleting as much as it adds keeps the revision inside the byte limit.
  const swapped = await workspace.write(
    scope,
    writeInput('swap', designId, full.revisionId, { 'e.txt': 'x' }, ['d.txt']),
  );
  assert.deepEqual(Object.keys(await workspace.readFiles(canvasId, swapped)), [
    'a.txt',
    'b.txt',
    'c.txt',
    'e.txt',
  ]);

  const second = await workspace.create(scope, {
    mutationId: 'create-cards',
    frames: [{ name: 'Cards', width: 720, height: 720, designSystem }],
  });
  const cards = second.frames[0]?.designId;
  assert.ok(cards);
  const sixtyFour = Object.fromEntries(
    Array.from({ length: 64 }, (_, index) => [
      `f${String(index)}.tsx`,
      'export default () => null',
    ]),
  );
  const packed = await workspace.write(scope, writeInput('many', cards, null, sixtyFour));
  await assert.rejects(
    workspace.write(
      scope,
      writeInput('one-file-more', cards, packed.revisionId, { 'extra.tsx': 'x' }),
    ),
    { code: 'invalid_input' },
  );
  // A folder the merged revision would address twice is refused here, not left
  // to fail halfway through writing the tree.
  const folder = await workspace.write(
    scope,
    writeInput('folder', designId, swapped.revisionId, { 'ui/A.tsx': 'a' }),
  );
  await assert.rejects(
    workspace.write(
      scope,
      writeInput('other-case', designId, folder.revisionId, { 'UI/B.tsx': 'b' }),
    ),
    { code: 'invalid_input' },
  );
});

test('an unattached chat’s first create commits the canvas, attachment and lease binding', async (t) => {
  const { root, deps, workspace, boundCanvasIds } = await openWorkspace(t);
  const scope = scopeFor(null);
  const input = createInput('create-hey');
  const created = await workspace.create(scope, input);
  assert.deepEqual(boundCanvasIds, [created.canvasId]);
  assert.equal(workspace.attachedCanvasId('app-1'), created.canvasId);

  // The lease still carries no canvas of its own, so a retry has to answer the
  // original canvas and frames rather than mint a second canvas.
  assert.deepEqual(await workspace.create(scope, input), created);
  assert.deepEqual(boundCanvasIds, [created.canvasId]);
  // A second create under that lease extends the canvas it made.
  const second = await workspace.create(scope, { ...input, mutationId: 'create-again' });
  assert.equal(second.canvasId, created.canvasId);
  assert.equal(workspace.listCanvases().length, 1);
  assert.equal(workspace.snapshot(created.canvasId).frames.length, 2);

  const reopened = await CanvasWorkspace.open(root, deps);
  assert.equal(reopened.attachedCanvasId('app-1'), created.canvasId);
  assert.deepEqual(reopened.snapshot(created.canvasId).frames[0], created.frames[0]);
});

test('an attachment survives a reopen, and detaching keeps the canvas and its source', async (t) => {
  const { root, deps, workspace, canvasId, scope, designId } = await withFrame(t);
  const receipt = await workspace.write(
    scope,
    writeInput('write-hey', designId, null, { 'main.tsx': HEY }),
  );
  await workspace.attach('app-1', canvasId);
  assert.equal(workspace.attachedCanvasId('app-1'), canvasId);
  await workspace.close();

  const reopened = await CanvasWorkspace.open(root, deps);
  assert.equal(reopened.attachedCanvasId('app-1'), canvasId);
  await reopened.detach('app-1');
  assert.equal(reopened.attachedCanvasId('app-1'), null);
  assert.deepEqual(
    reopened.listCanvases().map((summary) => summary.canvasId),
    [canvasId],
  );
  assert.equal((await reopened.readFiles(canvasId, receipt))['main.tsx'], HEY);

  // Attaching the chat elsewhere moves it; one chat is never on two canvases.
  const other = await reopened.createCanvas();
  await reopened.attach('app-1', canvasId);
  await reopened.attach('app-1', other.canvasId);
  assert.equal(reopened.attachedCanvasId('app-1'), other.canvasId);
  await reopened.close();
  const again = await CanvasWorkspace.open(root, deps);
  assert.equal(again.attachedCanvasId('app-1'), other.canvasId);
});

test('a revision seed copies the source it names, and a library seed is refused', async (t) => {
  const { root, workspace, scope, canvasId, designId } = await withFrame(t);
  const receipt = await workspace.write(
    scope,
    writeInput('write-hey', designId, null, { 'main.tsx': HEY }),
  );
  const seeded = {
    mutationId: 'create-variant',
    frames: [
      {
        name: 'Hey variant',
        width: 720,
        height: 720,
        designSystem,
        seed: { kind: 'revision' as const, canvasId, revision: receipt },
      },
    ],
  };
  const copied = await workspace.create(scope, seeded);
  const variant = copied.frames[0];
  assert.ok(variant?.revisionId);
  assert.notEqual(variant.revisionId, receipt.revisionId);
  assert.deepEqual(variant.rect, { x: 800, y: 0, width: 720, height: 720 });
  const source = await workspace.readFiles(canvasId, {
    designId: variant.designId,
    revisionId: variant.revisionId,
  });
  assert.equal(source['main.tsx'], HEY);
  // A retry answers the receipt without copying the seed a second time.
  const revisions = join(root, canvasId, 'revisions');
  const stored = await readdir(revisions);
  assert.deepEqual(await workspace.create(scope, seeded), copied);
  assert.deepEqual(await readdir(revisions), stored);

  const frame = { name: 'Rejected', width: 720, height: 720, designSystem };
  await assert.rejects(
    workspace.create(scope, {
      mutationId: 'create-library',
      frames: [{ ...frame, seed: { kind: 'library', itemId: 'item_01' } }],
    }),
    { code: 'invalid_input' },
  );
  await assert.rejects(
    workspace.create(scope, {
      mutationId: 'create-foreign',
      frames: [
        { ...frame, seed: { kind: 'revision', canvasId: 'cv_elsewhere', revision: receipt } },
      ],
    }),
    { code: 'invalid_input' },
  );
  assert.equal(workspace.snapshot(canvasId).frames.length, 2);
});

test('a save that failed after its rename is reconciled, not treated as absent', async (t) => {
  const fault = terminateAtManifestRename('after');
  const { workspace, scope, canvasId, designId } = await withFrame(t, { fs: fault.fs });
  const input = writeInput('write-hey', designId, null, { 'main.tsx': HEY });
  fault.arm();
  await assert.rejects(workspace.write(scope, input), { code: 'storage_failed' });

  // The head moved on disk, so memory caught up with it: a writer that still
  // expects no revision is refused, and the lost receipt is still recoverable.
  await assert.rejects(
    workspace.write(scope, writeInput('second', designId, null, { 'main.tsx': 'other' })),
    { code: 'revision_conflict' },
  );
  const receipt = await workspace.write(scope, input);
  assert.equal(workspace.snapshot(canvasId).frames[0]?.revisionId, receipt.revisionId);
  assert.equal((await workspace.readFiles(canvasId, receipt))['main.tsx'], HEY);
});

test('a canvas whose head cannot be reread is held damaged until reopen', async (t) => {
  t.mock.method(console, 'error', () => undefined);
  let unreadable = false;
  const { root, deps, workspace, scope, canvasId, designId } = await withFrame(t, {
    fs: observedFileSystem((operation, path) => {
      if (!unreadable || !path.endsWith('manifest.json')) return;
      if (operation === 'rename' || operation === 'open') throw new Error('the volume went away');
    }),
  });
  unreadable = true;
  await assert.rejects(
    workspace.write(scope, writeInput('write-hey', designId, null, { 'main.tsx': HEY })),
    { code: 'storage_failed' },
  );
  // Neither head is served, because choosing one of them would be a guess.
  assert.deepEqual(workspace.damagedCanvasIds(), [canvasId]);
  assert.deepEqual(workspace.listCanvases(), []);
  assert.throws(() => workspace.snapshot(canvasId), { code: 'storage_failed' });
  await assert.rejects(workspace.write(scope, writeInput('later', designId, null, {})), {
    code: 'storage_failed',
  });

  // A manifest already damaged on disk is reported the same way at open.
  await writeFile(join(root, canvasId, 'manifest.json'), '{ not json');
  const reopened = await CanvasWorkspace.open(root, { ...deps, fs: undefined });
  assert.deepEqual(reopened.damagedCanvasIds(), [canvasId]);
  assert.deepEqual(reopened.listCanvases(), []);
});

test('a lease revoked with the replacement manifest ready publishes and binds nothing', async (t) => {
  let active = true;
  const hold = holdManifestWrite('prepared');
  const { root, deps, workspace, scope, canvasId, designId } = await withFrame(t, {
    isScopeActive: () => active,
    fs: hold.fs,
  });
  hold.arm();
  const writing = workspace.write(
    scope,
    writeInput('write-hey', designId, null, { 'main.tsx': HEY }),
  );
  await hold.reached;
  active = false;
  hold.release();
  await assert.rejects(writing, { code: 'scope_expired' });
  assert.equal(workspace.snapshot(canvasId).frames[0]?.revisionId, null);
  const reopened = await CanvasWorkspace.open(root, { ...deps, fs: undefined });
  assert.equal(reopened.snapshot(canvasId).frames[0]?.revisionId, null);

  // An unattached create is the same window: no canvas, no attachment, no binding.
  let unattachedActive = true;
  const unattached = holdManifestWrite('prepared');
  const second = await openWorkspace(t, {
    isScopeActive: () => unattachedActive,
    fs: unattached.fs,
  });
  unattached.arm();
  const creating = second.workspace.create(scopeFor(null), createInput('create-hey'));
  await unattached.reached;
  unattachedActive = false;
  unattached.release();
  await assert.rejects(creating, { code: 'scope_expired' });
  assert.deepEqual(second.boundCanvasIds, []);
  assert.deepEqual(second.workspace.listCanvases(), []);
  assert.equal(second.workspace.attachedCanvasId('app-1'), null);
});

test('concurrent creates read the manifest the commit they run in extends', async (t) => {
  const unattached = await openWorkspace(t);
  const input = createInput('create-hey');
  const [left, right] = await Promise.all([
    unattached.workspace.create(scopeFor(null), input),
    unattached.workspace.create(scopeFor(null), input),
  ]);
  assert.deepEqual(left, right);
  assert.deepEqual(unattached.boundCanvasIds, [left?.canvasId]);
  assert.equal(unattached.workspace.listCanvases().length, 1);

  // Two distinct creates on one canvas are placed side by side, never stacked.
  const attached = await withFrame(t);
  const frames = [{ name: 'Cards', width: 400, height: 300, designSystem }];
  await Promise.all([
    attached.workspace.create(attached.scope, { mutationId: 'create-a', frames }),
    attached.workspace.create(attached.scope, { mutationId: 'create-b', frames }),
  ]);
  assert.deepEqual(
    attached.workspace.snapshot(attached.canvasId).frames.map((frame) => frame.rect.x),
    [0, 800, 1280],
  );
});

test('a head recovered after a failed flush is not served until it is durable', async (t) => {
  t.mock.method(console, 'error', () => undefined);
  const fault = stopFlushingAfterManifestRename();
  const { workspace, scope, canvasId, designId } = await withFrame(t, { fs: fault.fs });
  const input = writeInput('write-hey', designId, null, { 'main.tsx': HEY });
  fault.arm();
  await assert.rejects(workspace.write(scope, input), { code: 'storage_failed' });

  // Reading the head back only proves it is visible. Its directory entry never
  // flushed, so the canvas is held back rather than answering the retry as
  // though the save had completed.
  assert.deepEqual(workspace.damagedCanvasIds(), [canvasId]);
  assert.throws(() => workspace.snapshot(canvasId), { code: 'storage_failed' });
  await assert.rejects(workspace.write(scope, input), { code: 'storage_failed' });
});

test('an unattached create binds its lease exactly once, after it is published', async (t) => {
  const fault = terminateAtManifestRename('after');
  const { workspace, boundCanvasIds } = await openWorkspace(t, { fs: fault.fs });
  const scope = scopeFor(null);
  const input = createInput('create-hey');
  fault.arm();
  await assert.rejects(workspace.create(scope, input), { code: 'storage_failed' });
  assert.deepEqual(boundCanvasIds, []);

  // The canvas landed, so the retry has to answer it and bind the lease that
  // created it, or every later write under that lease targets nothing.
  const recovered = await workspace.create(scope, input);
  assert.deepEqual(boundCanvasIds, [recovered.canvasId]);
  assert.deepEqual(await workspace.create(scope, input), recovered);
  assert.deepEqual(boundCanvasIds, [recovered.canvasId]);
  const written = await workspace.write(
    scopeFor(recovered.canvasId),
    writeInput('write-hey', recovered.frames[0]?.designId ?? '', null, { 'main.tsx': HEY }),
  );
  assert.equal((await workspace.readFiles(recovered.canvasId, written))['main.tsx'], HEY);
});

test('a lease revoked after its canvas was published is never bound', async (t) => {
  const live = new Set(['scope-1']);
  const hold = holdManifestWrite('published');
  const { workspace, boundCanvasIds } = await openWorkspace(t, {
    isScopeActive: (scopeId) => live.has(scopeId),
    fs: hold.fs,
  });
  hold.arm();
  const creating = workspace.create(scopeFor(null), createInput('create-hey'));
  await hold.reached;
  live.clear();
  hold.release();

  // The commit was already published, so the canvas and its attachment stand.
  const created = await creating;
  assert.equal(workspace.attachedCanvasId('app-1'), created.canvasId);
  // Nothing that lease could still authorize is left, so it is not bound.
  assert.deepEqual(boundCanvasIds, []);
});

test('a chat on a damaged canvas waits for recovery instead of getting another', async (t) => {
  t.mock.method(console, 'error', () => undefined);
  const fault = stopFlushingAfterManifestRename();
  const { root, workspace, boundCanvasIds } = await openWorkspace(t, { fs: fault.fs });
  const scope = scopeFor(null);
  const input = createInput('create-hey');
  fault.arm();
  await assert.rejects(workspace.create(scope, input), { code: 'storage_failed' });

  // The canvas is attached on disk and unreadable here, so the chat keeps its
  // reservation: a retry must not bootstrap a second canvas to attach to.
  const [damaged] = workspace.damagedCanvasIds();
  assert.ok(damaged);
  assert.equal(workspace.attachedCanvasId('app-1'), damaged);
  await assert.rejects(workspace.create(scope, input), { code: 'storage_failed' });
  await assert.rejects(workspace.create(scope, { ...input, mutationId: 'again' }), {
    code: 'storage_failed',
  });
  assert.deepEqual(boundCanvasIds, []);
  // Nor can the chat be moved off a canvas whose manifest cannot be rewritten.
  await assert.rejects(workspace.detach('app-1'), { code: 'storage_failed' });
  assert.deepEqual(await readdir(root), [damaged]);

  // Reopening finds one manifest, attaching this chat exactly once.
  const reopened = await CanvasWorkspace.open(root, {
    isScopeActive: () => true,
    bindScopeCanvas: () => undefined,
  });
  t.after(() => reopened.close());
  assert.deepEqual(
    reopened.listCanvases().map((summary) => summary.canvasId),
    [damaged],
  );
  assert.equal(reopened.attachedCanvasId('app-1'), damaged);
});

test('a canvas full of unsettled receipts refuses a mutation and keeps the old ones', async (t) => {
  const root = await canvasRoot(t);
  const canvasId = 'cv_full';
  const design = {
    designId: 'dsg_hey',
    name: 'Hey',
    rect: { x: 0, y: 0, width: 720, height: 720 },
    layoutVersion: 0,
    revisionId: null,
    designSystem,
  };
  const input = createInput('create-hey');
  const files = new CanvasFiles(root);
  await files.createRoot();
  await files.writeManifest(
    ledgerAtCapacity(canvasId, 'app-1', design, {
      kind: 'create',
      mutationId: input.mutationId,
      scopeId: 'scope-1',
      fingerprint: mutationFingerprint(input),
      designs: [design],
    }),
    () => undefined,
  );
  const workspace = await CanvasWorkspace.open(root, {
    isScopeActive: () => true,
    bindScopeCanvas: () => undefined,
  });
  t.after(() => workspace.close());
  const scope = scopeFor(canvasId);

  // Every receipt belongs to a live lease, so the ledger refuses rather than
  // retiring one whose retry would then run a second time.
  await assert.rejects(
    workspace.arrange(scope, {
      mutationId: 'one-more',
      frames: [{ designId: design.designId, expectedLayoutVersion: 0, rect: design.rect }],
    }),
    { code: 'storage_failed' },
  );
  assert.equal(workspace.snapshot(canvasId).sequence, 1);
  const retried = await workspace.create(scope, input);
  assert.equal(retried.canvasId, canvasId);
  assert.equal(retried.frames[0]?.designId, design.designId);
});

test('a binding the registry refused is attempted again by the retry', async (t) => {
  const attempts: string[] = [];
  const { workspace } = await openWorkspace(t, {
    bindScopeCanvas: (_scopeId, canvasId) => {
      attempts.push(canvasId);
      if (attempts.length === 1) throw new Error('the lease registry refused it');
    },
  });
  const scope = scopeFor(null);
  const input = createInput('create-hey');
  await assert.rejects(workspace.create(scope, input), /lease registry/);

  // The canvas is published and attached and only the binding failed, so the
  // retry has to attempt it again instead of reporting a bound lease.
  const created = await workspace.create(scope, input);
  assert.equal(workspace.attachedCanvasId('app-1'), created.canvasId);
  assert.deepEqual(attempts, [created.canvasId, created.canvasId]);
  // Once it has happened it is not attempted a third time.
  assert.deepEqual(await workspace.create(scope, input), created);
  assert.deepEqual(attempts, [created.canvasId, created.canvasId]);
});

test('a lease keeps the canvas it created and cannot bootstrap another', async (t) => {
  const { workspace } = await openWorkspace(t);
  const scope = scopeFor(null);
  const input = createInput('create-hey');
  const created = await workspace.create(scope, input);
  await workspace.detach('app-1');

  // The lease is still pinned to the canvas it made, so it cannot start a
  // second one for a chat that has left.
  await assert.rejects(workspace.create(scope, { ...input, mutationId: 'again' }), {
    code: 'scope_expired',
  });
  assert.deepEqual(
    workspace.listCanvases().map((summary) => summary.canvasId),
    [created.canvasId],
  );
  // Back on that canvas, the same lease extends it.
  await workspace.attach('app-1', created.canvasId);
  const more = await workspace.create(scope, { ...input, mutationId: 'more' });
  assert.equal(more.canvasId, created.canvasId);
  assert.equal(workspace.listCanvases().length, 1);
});

test('close waits for a mutation that is still staging its source', async (t) => {
  const staged = deferred();
  const released = deferred();
  let armed = false;
  const { workspace, scope, designId } = await withFrame(t, {
    fs: observedFileSystem(async (operation, path) => {
      if (!armed || operation !== 'rename' || !path.includes('revisions')) return;
      armed = false;
      staged.resolve();
      await released.promise;
    }),
  });
  armed = true;
  const writing = workspace.write(
    scope,
    writeInput('write-hey', designId, null, { 'main.tsx': HEY }),
  );
  await staged.promise;

  let settled = false;
  const mark = (): void => {
    settled = true;
  };
  void writing.then(mark, mark);
  const closing = workspace.close();
  released.resolve();
  await closing;
  // The staged write had settled before close resolved, so nothing was left
  // writing into storage the workspace had already given up.
  assert.equal(settled, true);
  await assert.rejects(writing, { code: 'storage_failed' });
});

test('a closed workspace refuses further commits', async (t) => {
  const { workspace, scope, designId } = await withFrame(t);
  await workspace.close();
  await assert.rejects(
    workspace.write(scope, writeInput('late', designId, null, { 'main.tsx': HEY })),
    {
      code: 'storage_failed',
    },
  );
  await workspace.close();
});
