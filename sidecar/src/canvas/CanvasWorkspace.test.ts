import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { canvasRoot, observedFileSystem } from '../testing/canvasStorageSupport.js';
import type { CanvasFileSystem } from './canvasFiles.js';
import { CanvasWorkspace, type CanvasWorkspaceDeps } from './CanvasWorkspace.js';
import type { CanvasScope, WriteFilesInput } from './protocol.js';

const designSystem = { id: 'droidex', version: 1, mode: 'light' } as const;
const HEY = 'export default function Hey(){return <h1>Hey</h1>}';

function scopeFor(
  canvasId: string | null,
  allowedDesignIds: string[] | 'canvas' = 'canvas',
): CanvasScope {
  return {
    scopeId: 'scope-1',
    appSessionId: 'app-1',
    generation: 1,
    canvasId,
    context: { designs: [], elements: [], designSystem },
    allowedDesignIds,
  };
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
 * A filesystem that stops working once armed, either just before the manifest
 * rename or on the durability flush that follows it.
 */
function terminateAtManifestRename(side: 'before' | 'after') {
  let armed = false;
  let renamed = false;
  const fs = observedFileSystem((operation, path) => {
    if (!armed) return;
    if (operation === 'rename' && path.endsWith('manifest.json')) {
      if (side === 'before') throw new Error('power lost');
      renamed = true;
      return;
    }
    if (side === 'after' && renamed && operation === 'open') throw new Error('power lost');
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
  isScopeActive?: () => boolean;
}

async function openWorkspace(t: TestContext, options: Options = {}) {
  const root = await canvasRoot(t);
  const boundCanvasIds: string[] = [];
  const deps: CanvasWorkspaceDeps = {
    isScopeActive: options.isScopeActive ?? (() => true),
    bindScopeCanvas: (_scopeId, canvasId) => boundCanvasIds.push(canvasId),
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
  const created = await context.workspace.create(scope, {
    mutationId: 'create-hey',
    frames: [{ name: 'Hey', width: 720, height: 720, designSystem }],
  });
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
  // The retry neither committed again nor moved the projection forward.
  assert.equal(workspace.snapshot(canvasId).sequence, first.sequence);
  assert.equal(workspace.snapshot(canvasId).frames[0]?.revisionId, first.revisionId);
});

test('a reopen on either side of the manifest rename finds one complete head', async (t) => {
  const before = terminateAtManifestRename('before');
  const old = await withFrame(t, { fs: before.fs });
  before.arm();
  await assert.rejects(
    old.workspace.write(
      old.scope,
      writeInput('write-hey', old.designId, null, { 'main.tsx': HEY }),
    ),
    { code: 'storage_failed' },
  );
  const oldHead = await CanvasWorkspace.open(old.root, { ...old.deps, fs: undefined });
  assert.equal(oldHead.snapshot(old.canvasId).frames[0]?.revisionId, null);

  // Terminated after the rename landed but before the directory flush returned:
  // the caller saw a failure, and the new head is nonetheless complete.
  const after = terminateAtManifestRename('after');
  const fresh = await withFrame(t, { fs: after.fs });
  after.arm();
  await assert.rejects(
    fresh.workspace.write(
      fresh.scope,
      writeInput('write-hey', fresh.designId, null, { 'main.tsx': HEY }),
    ),
    { code: 'storage_failed' },
  );
  const newHead = await CanvasWorkspace.open(fresh.root, { ...fresh.deps, fs: undefined });
  const revisionId = newHead.snapshot(fresh.canvasId).frames[0]?.revisionId;
  assert.ok(revisionId);
  const source = await newHead.readFiles(fresh.canvasId, { designId: fresh.designId, revisionId });
  assert.equal(source['main.tsx'], HEY);
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

test('a layout change and a source write on one frame both land', async (t) => {
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
  // A retry of the arrange answers the positions it accepted, not later ones.
  assert.deepEqual(
    await workspace.arrange(scope, {
      mutationId: 'arrange-hey',
      frames: [{ designId, expectedLayoutVersion: 0, rect: { ...rect, x: 0 } }],
    }),
    change,
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

test('the source limits hold against the whole revision, not one write', async (t) => {
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
});

test('an unattached chat’s first create commits the canvas, attachment and lease binding', async (t) => {
  const { root, deps, workspace, boundCanvasIds } = await openWorkspace(t);
  const scope = scopeFor(null);
  const input = {
    mutationId: 'create-hey',
    frames: [{ name: 'Hey', width: 720, height: 720, designSystem }],
  };
  const created = await workspace.create(scope, input);
  assert.deepEqual(boundCanvasIds, [created.canvasId]);
  assert.equal(workspace.attachedCanvasId('app-1'), created.canvasId);

  // The lease is still unbound from this workspace's view, so a retry has to
  // answer the original canvas and frames rather than mint a second canvas.
  assert.deepEqual(await workspace.create(scope, input), created);
  assert.deepEqual(boundCanvasIds, [created.canvasId]);
  await assert.rejects(workspace.create(scope, { ...input, mutationId: 'create-again' }), {
    code: 'scope_expired',
  });
  assert.equal(workspace.listCanvases().length, 1);

  const reopened = await CanvasWorkspace.open(root, deps);
  assert.equal(reopened.attachedCanvasId('app-1'), created.canvasId);
  assert.deepEqual(reopened.snapshot(created.canvasId).frames, created.frames);
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
  const { workspace, scope, canvasId, designId } = await withFrame(t);
  const receipt = await workspace.write(
    scope,
    writeInput('write-hey', designId, null, { 'main.tsx': HEY }),
  );
  const copied = await workspace.create(scope, {
    mutationId: 'create-variant',
    frames: [
      {
        name: 'Hey variant',
        width: 720,
        height: 720,
        designSystem,
        seed: { kind: 'revision', canvasId, revision: receipt },
      },
    ],
  });
  const variant = copied.frames[0];
  assert.ok(variant?.revisionId);
  assert.notEqual(variant.revisionId, receipt.revisionId);
  assert.deepEqual(variant.rect, { x: 800, y: 0, width: 720, height: 720 });
  const source = await workspace.readFiles(canvasId, {
    designId: variant.designId,
    revisionId: variant.revisionId,
  });
  assert.equal(source['main.tsx'], HEY);

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
