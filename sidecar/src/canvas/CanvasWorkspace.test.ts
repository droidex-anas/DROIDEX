import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import {
  canvasRoot,
  deferred,
  holdManifestWrite,
  observedFileSystem,
  openWorkspace,
  quietBuilds,
  reopenWorkspace,
  createInput,
  workspaceAtReceiptCapacity,
  scopeFor,
  stopFlushingAfterManifestRename,
  terminateAtManifestRename,
  withFrame,
  writeInput,
} from '../testing/canvasStorageSupport.js';
import { CanvasFiles } from './canvasFiles.js';
import { CanvasWorkspace } from './CanvasWorkspace.js';
import type { CreateFramesInput } from './protocol.js';

const designSystem = { id: 'droidex', version: 1, mode: 'light' } as const;
const HEY = 'export default function Hey(){return <h1>Hey</h1>}';

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
  await workspace.close();
  const reopened = await reopenWorkspace(t, root, { ...deps, fs: undefined });
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

test('linked profile roots refuse a second writer before sweeping or accepting stale CAS', async (t) => {
  const hold = holdManifestWrite('prepared');
  const { root, deps, workspace, scope, canvasId, designId } = await withFrame(t, {
    fs: hold.fs,
  });
  const linked = await canvasRoot(t);
  await mkdir(dirname(linked), { recursive: true });
  await symlink(root, linked);
  const temporary = join(root, canvasId, '.manifest-in-flight.tmp');
  await writeFile(temporary, 'the active writer owns this');
  hold.arm();
  const arranging = workspace.arrange(scope, {
    mutationId: 'arrange-owner',
    frames: [
      { designId, expectedLayoutVersion: 0, rect: { x: 40, y: 0, width: 720, height: 720 } },
    ],
  });
  await hold.reached;
  try {
    await assert.rejects(
      async () => {
        const second = await CanvasWorkspace.open(linked, quietBuilds(), deps);
        await second.close();
      },
      { code: 'storage_failed', message: /already open in another workspace/ },
    );
    assert.equal(await readFile(temporary, 'utf8'), 'the active writer owns this');
  } finally {
    hold.release();
    await arranging;
    await workspace.close();
  }
  const reopened = await reopenWorkspace(t, linked, deps);
  assert.equal(reopened.snapshot(canvasId).frames[0]?.layoutVersion, 1);
  await assert.rejects(
    reopened.arrange(scope, {
      mutationId: 'arrange-stale',
      frames: [
        { designId, expectedLayoutVersion: 0, rect: { x: 80, y: 0, width: 720, height: 720 } },
      ],
    }),
    { code: 'revision_conflict' },
  );
});

test('a crashed Canvas writer leaves a lease that a new workspace can safely reclaim', async (t) => {
  const root = await canvasRoot(t);
  const child = spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '-e',
      `import { CanvasWorkspace } from './src/canvas/CanvasWorkspace.ts';
       import { quietBuilds } from './src/testing/canvasStorageSupport.ts';
       const workspace = await CanvasWorkspace.open(process.argv[1], quietBuilds(), {
         isScopeActive: () => true, bindScopeCanvas: () => {}
       });
       const snapshot = await workspace.createCanvas('crashed-chat');
       process.on('message', () => {});
       process.send(snapshot.canvasId);`,
      root,
    ],
    { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] },
  );
  const exited = once(child, 'exit');
  t.after(() => child.kill('SIGKILL'));
  const [canvasId] = await once(child, 'message');
  assert.equal(typeof canvasId, 'string');
  await assert.rejects(
    CanvasWorkspace.open(root, quietBuilds(), {
      isScopeActive: () => true,
      bindScopeCanvas: () => undefined,
    }),
    { code: 'storage_failed', message: /already open in another workspace/ },
  );
  child.kill('SIGKILL');
  await exited;
  const reopened = await reopenWorkspace(t, root, {
    isScopeActive: () => true,
    bindScopeCanvas: () => undefined,
  });
  try {
    assert.equal(reopened.attachedCanvasId('crashed-chat'), canvasId);
    await reopened.createCanvas('replacement-chat');
  } finally {
    await reopened.close();
  }
});

test('a failed workspace open releases its writer lease', async (t) => {
  const root = await canvasRoot(t);
  const deps = { isScopeActive: () => true, bindScopeCanvas: () => undefined };
  await assert.rejects(
    CanvasWorkspace.open(root, quietBuilds(), {
      ...deps,
      fs: observedFileSystem((operation) => {
        if (operation === 'readdir') throw new Error('storage disappeared during open');
      }),
    }),
    { code: 'storage_failed' },
  );
  const reopened = await CanvasWorkspace.open(root, quietBuilds(), deps);
  await reopened.close();
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
  await workspace.close();
  const reopened = await CanvasWorkspace.open(root, quietBuilds(), { ...deps, fs: undefined });
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
  const { workspace, boundCanvasIds } = await openWorkspace(t);
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
  assert.equal(workspace.snapshot(created.canvasId).frames.length, 2);
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

  const reopened = await reopenWorkspace(t, root, deps);
  assert.equal(reopened.attachedCanvasId('app-1'), canvasId);
  await reopened.detach('app-1');
  assert.equal(reopened.attachedCanvasId('app-1'), null);
  assert.deepEqual(
    reopened.listCanvases().map((summary) => summary.canvasId),
    [canvasId],
  );
  assert.equal((await reopened.readFiles(canvasId, receipt))['main.tsx'], HEY);

  // Attaching the chat elsewhere moves it; one chat is never on two canvases.
  const other = await reopened.createCanvas('app-2');
  await reopened.attach('app-1', canvasId);
  await reopened.attach('app-1', other.canvasId);
  assert.equal(reopened.attachedCanvasId('app-1'), other.canvasId);
  await reopened.close();
  const again = await reopenWorkspace(t, root, deps);
  assert.equal(again.attachedCanvasId('app-1'), other.canvasId);
});

test('two seeded variants own independent source and placement, once per mutation', async (t) => {
  const { root, workspace, scope, canvasId, designId } = await withFrame(t);
  const sourceRef = await workspace.write(
    scope,
    writeInput('write-hey', designId, null, { 'main.tsx': HEY, 'style.css': '/* café */\r\n' }),
  );
  const original = await workspace.readFiles(canvasId, sourceRef);
  const seed = {
    kind: 'revision' as const,
    canvasId,
    revision: { designId, revisionId: sourceRef.revisionId },
  };
  const seeded: CreateFramesInput = {
    mutationId: 'two-variants',
    placeBeside: { designId },
    frames: ['Hey · layout', 'Hey · color'].map((name) => ({
      name,
      width: 720,
      height: 720,
      designSystem,
      seed,
    })),
  };
  const copied = await workspace.create(scope, seeded);
  assert.equal(new Set(copied.frames.map((frame) => frame.designId)).size, 2);
  const refs = copied.frames.map((frame) => {
    assert.ok(frame.revisionId);
    assert.notEqual(frame.revisionId, sourceRef.revisionId);
    return { designId: frame.designId, revisionId: frame.revisionId };
  });
  for (const ref of refs) assert.deepEqual(await workspace.readFiles(canvasId, ref), original);
  assert.deepEqual(
    copied.frames.map((frame) => frame.rect),
    [
      { x: 0, y: 800, width: 720, height: 720 },
      { x: 800, y: 800, width: 720, height: 720 },
    ],
  );
  const [first, second] = refs;
  const changed = await workspace.write(
    scope,
    writeInput('change-layout', first.designId, first.revisionId, {
      'main.tsx': 'export default () => null;',
    }),
  );
  assert.equal(
    (await workspace.readFiles(canvasId, changed))['main.tsx'],
    'export default () => null;',
  );
  assert.deepEqual(await workspace.readFiles(canvasId, second), original);
  assert.deepEqual(await workspace.readFiles(canvasId, sourceRef), original);
  // A retry answers the receipt without copying the seed a second time.
  const revisions = join(root, canvasId, 'revisions');
  const stored = await readdir(revisions);
  const retried = await workspace.create(scope, seeded);
  assert.deepEqual(
    retried.frames.map(({ designId, revisionId }) => ({ designId, revisionId })),
    refs,
  );
  assert.deepEqual(await readdir(revisions), stored);

  assert.equal(workspace.snapshot(canvasId).frames.length, 3);
  const saved = await new CanvasFiles(root).loadManifest(canvasId);
  assert.ok(saved.state === 'loaded');
  assert.deepEqual(
    saved.manifest.designs.slice(1).map((design) => design.seed),
    [seed, seed],
  );
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
  await workspace.close();
  const reopened = await reopenWorkspace(t, root, { ...deps, fs: undefined });
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
  assert.deepEqual(
    (await readdir(root)).filter((name) => !name.startsWith('.')),
    [damaged],
  );

  // Reopening finds one manifest, attaching this chat exactly once.
  await workspace.close();
  const reopened = await reopenWorkspace(t, root, {
    isScopeActive: () => true,
    bindScopeCanvas: () => undefined,
  });
  assert.deepEqual(
    reopened.listCanvases().map((summary) => summary.canvasId),
    [damaged],
  );
  assert.equal(reopened.attachedCanvasId('app-1'), damaged);
});

test('a canvas full of unsettled receipts refuses a mutation and keeps the old ones', async (t) => {
  const { workspace, canvasId, design, input, scope } = await workspaceAtReceiptCapacity(t);

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

test('a lease pinned by its own commit never follows its chat, however the save ended', async (t) => {
  t.mock.method(console, 'error', () => undefined);
  const scope = scopeFor(null);
  const input = createInput('create-hey');

  // The registry refused the binding. The commit pinned the lease anyway, so a
  // chat that moves makes the lease stale instead of letting the retry follow.
  const attempts: string[] = [];
  const refused = await openWorkspace(t, {
    bindScopeCanvas: (_scopeId, canvasId) => {
      attempts.push(canvasId);
      if (attempts.length === 1) throw new Error('the lease registry refused it');
    },
  });
  await assert.rejects(refused.workspace.create(scope, input), /lease registry/);
  const mine = attempts[0];
  assert.ok(mine);
  const elsewhere = await refused.workspace.createCanvas('app-2');
  await refused.workspace.attach('app-1', elsewhere.canvasId);
  await assert.rejects(refused.workspace.create(scope, input), { code: 'scope_expired' });

  // Back on its own canvas the retry answers for it and, because the refused
  // notification never happened, attempts it once more and no further.
  await refused.workspace.attach('app-1', mine);
  const created = await refused.workspace.create(scope, input);
  assert.equal(created.canvasId, mine);
  assert.deepEqual(attempts, [mine, mine]);
  assert.deepEqual(await refused.workspace.create(scope, input), created);
  assert.deepEqual(attempts, [mine, mine]);

  // A save that reported a failure but landed pins the lease the same way.
  const fault = terminateAtManifestRename('after');
  const landed = await openWorkspace(t, { fs: fault.fs });
  fault.arm();
  await assert.rejects(landed.workspace.create(scope, input), { code: 'storage_failed' });
  const other = await landed.workspace.createCanvas('app-2');
  await landed.workspace.attach('app-1', other.canvasId);
  await assert.rejects(landed.workspace.create(scope, input), { code: 'scope_expired' });
  assert.equal(landed.workspace.snapshot(other.canvasId).frames.length, 0);
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

test('a lease acts only where its chat still is, and keeps one canvas', async (t) => {
  const { workspace, boundCanvasIds } = await openWorkspace(t);
  const scope = scopeFor(null);
  const mine = await workspace.create(scope, createInput('create-hey'));
  const receipt = await workspace.write(
    scopeFor(mine.canvasId),
    writeInput('write-hey', mine.frames[0]?.designId ?? '', null, { 'main.tsx': HEY }),
  );
  const other = await workspace.createCanvas('app-2');

  // The chat moves while a seeded create is copying its source, so the commit
  // has nowhere to land: the lease is pinned to the canvas it made.
  const staging = workspace.create(scope, {
    mutationId: 'create-copy',
    frames: [
      {
        name: 'Copy',
        width: 720,
        height: 720,
        designSystem,
        seed: { kind: 'revision' as const, canvasId: mine.canvasId, revision: receipt },
      },
    ],
  });
  await workspace.attach('app-1', other.canvasId);
  await assert.rejects(staging, { code: 'scope_expired' });
  assert.equal(workspace.snapshot(mine.canvasId).frames.length, 1);

  // The chat's current canvas holds a receipt for the same request. The lease
  // must neither replay it nor be bound a second time.
  await workspace.create(scopeFor(other.canvasId, 'canvas', 'scope-b'), createInput('elsewhere'));
  await assert.rejects(workspace.create(scope, createInput('elsewhere')), {
    code: 'scope_expired',
  });
  assert.deepEqual(boundCanvasIds, [mine.canvasId]);
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

test('close rejects queued and new mutations before an admitted durable write settles', async (t) => {
  const hold = holdManifestWrite('published');
  const { root, deps, workspace } = await openWorkspace(t, { fs: hold.fs });
  hold.arm();
  const active = workspace.createCanvas('active-chat');
  await hold.reached;
  const rejected: string[] = [];
  const queued = workspace.createCanvas('queued-chat');
  void queued.catch(() => rejected.push('queued'));
  let closed = false;
  const closing = workspace.close().then(() => {
    closed = true;
  });
  const late = workspace.createCanvas('late-chat');
  void late.catch(() => rejected.push('new'));
  try {
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual([...rejected].sort(), ['new', 'queued']);
    assert.equal(closed, false, 'close still owns the admitted durable write');
  } finally {
    hold.release();
    await Promise.allSettled([active, queued, late]);
    await closing;
  }
  await assert.rejects(queued, {
    code: 'storage_failed',
    message: 'The Canvas workspace is closing.',
  });
  await assert.rejects(late, {
    code: 'storage_failed',
    message: 'The Canvas workspace is closing.',
  });
  const saved = await active;
  const reopened = await CanvasWorkspace.open(root, quietBuilds(), deps);
  try {
    assert.deepEqual(
      reopened.listCanvases().map((canvas) => canvas.canvasId),
      [saved.canvasId],
    );
    assert.equal(reopened.attachedCanvasId('active-chat'), saved.canvasId);
    assert.equal(reopened.attachedCanvasId('queued-chat'), null);
    assert.equal(reopened.attachedCanvasId('late-chat'), null);
  } finally {
    await reopened.close();
  }
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
