import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { CompilerFleet, fakeDeadlines } from '../testing/canvasBuildSupport.js';
import { canvasRoot, observedFileSystem, quietBuilds } from '../testing/canvasStorageSupport.js';
import { CanvasBuilds } from './CanvasBuilds.js';
import type { CanvasFileSystem } from './canvasFiles.js';
import { CanvasWorkspace, type CanvasWorkspaceDeps } from './CanvasWorkspace.js';
import type { CanvasScope } from './protocol.js';

const designSystem = { id: 'droidex', version: 1, mode: 'light' } as const;
const SOURCE = 'export default function Hey(){return <h1>Hey</h1>}';

async function opened(t: TestContext, builds = quietBuilds(), fs?: CanvasFileSystem) {
  const root = await canvasRoot(t);
  const deps: CanvasWorkspaceDeps = {
    isScopeActive: () => true,
    bindScopeCanvas: () => undefined,
    fs,
  };
  const workspace = await CanvasWorkspace.open(root, builds, deps);
  t.after(async () => {
    await builds.close();
    await workspace.close();
  });
  const canvasId = (await workspace.createCanvas('app-1')).canvasId;
  const scope: CanvasScope = {
    origin: 'user',
    scopeId: 'user-1',
    appSessionId: 'app-1',
    canvasId,
    allowedDesignIds: 'canvas',
  };
  return { root, deps, workspace, builds, canvasId, scope };
}

async function frame(workspace: CanvasWorkspace, scope: CanvasScope, mutationId: string) {
  const created = await workspace.create(scope, {
    mutationId,
    frames: [{ name: 'Hey', width: 720, height: 720, designSystem }],
  });
  const design = created.frames[0];
  assert.ok(design);
  return design;
}

test('remove and retry publish once; Undo restores source, name and location', async (t) => {
  const { workspace, canvasId, scope } = await opened(t);
  const original = await frame(workspace, scope, 'create-hey');
  const written = await workspace.write(scope, {
    mutationId: 'write-hey',
    designId: original.designId,
    expectedRevisionId: null,
    files: { 'main.tsx': SOURCE },
    deletedPaths: [],
  });
  const rect = { x: 120, y: 80, width: 700, height: 600 };
  await workspace.arrange(scope, {
    mutationId: 'move-hey',
    frames: [{ designId: original.designId, expectedLayoutVersion: 0, rect }],
  });
  const before = workspace.snapshot(canvasId).sequence;
  const removed = await workspace.removeFrames(scope, 'remove-hey', [original.designId]);
  assert.deepEqual(workspace.snapshot(canvasId).frames, []);
  assert.equal(workspace.snapshot(canvasId).sequence, before + 1);
  assert.deepEqual(await workspace.removeFrames(scope, 'remove-hey', [original.designId]), removed);
  assert.equal(workspace.snapshot(canvasId).sequence, before + 1);
  await assert.rejects(workspace.readFiles(canvasId, written), {
    code: 'not_found',
    message: /Undo/,
  });

  const restored = await workspace.undoRemoval(scope, 'undo-hey', removed.undoId);
  assert.equal(restored.frames[0]?.name, 'Hey');
  assert.deepEqual(restored.frames[0]?.rect, rect);
  assert.equal(restored.frames[0]?.revisionId, written.revisionId);
  assert.equal((await workspace.readFiles(canvasId, written))['main.tsx'], SOURCE);
  assert.deepEqual(await workspace.undoRemoval(scope, 'undo-hey', removed.undoId), restored);
  await assert.rejects(workspace.undoRemoval(scope, 'undo-again', removed.undoId), {
    code: 'invalid_input',
  });
});

test('Undo survives closing and reopening the workspace', async (t) => {
  const { root, deps, workspace, builds, canvasId, scope } = await opened(t);
  const original = await frame(workspace, scope, 'create-hey');
  const written = await workspace.write(scope, {
    mutationId: 'write-hey',
    designId: original.designId,
    expectedRevisionId: null,
    files: { 'main.tsx': SOURCE },
    deletedPaths: [],
  });
  const removed = await workspace.removeFrames(scope, 'remove-hey', [original.designId]);
  await builds.close();
  await workspace.close();
  const reopenedBuilds = quietBuilds();
  const reopened = await CanvasWorkspace.open(root, reopenedBuilds, deps);
  t.after(async () => {
    await reopenedBuilds.close();
    await reopened.close();
  });
  assert.deepEqual(reopened.snapshot(canvasId).frames, []);
  const change = await reopened.undoRemoval(scope, 'undo-hey', removed.undoId);
  assert.equal(change.frames[0]?.revisionId, written.revisionId);
  assert.equal((await reopened.readFiles(canvasId, written))['main.tsx'], SOURCE);
});

test('Undo refuses a changed occupant and returns its current rect', async (t) => {
  const { workspace, canvasId, scope } = await opened(t);
  const original = await frame(workspace, scope, 'create-original');
  const other = await frame(workspace, scope, 'create-other');
  const removed = await workspace.removeFrames(scope, 'remove-original', [original.designId]);
  const occupied = { ...original.rect };
  await workspace.arrange(scope, {
    mutationId: 'occupy-space',
    frames: [{ designId: other.designId, expectedLayoutVersion: 0, rect: occupied }],
  });
  await assert.rejects(workspace.undoRemoval(scope, 'undo-original', removed.undoId), {
    code: 'layout_conflict',
    currentRect: occupied,
  });
  assert.deepEqual(
    workspace.snapshot(canvasId).frames.map((entry) => entry.designId),
    [other.designId],
  );
});

test('rename validates names and compares the design manifest version', async (t) => {
  const { workspace, canvasId, scope } = await opened(t);
  const original = await frame(workspace, scope, 'create-hey');
  await assert.rejects(
    workspace.renameFrame(scope, 'bad-name', original.designId, 'bad\u0000name', 0),
    {
      code: 'invalid_input',
    },
  );
  const renamed = await workspace.renameFrame(
    scope,
    'rename-hey',
    original.designId,
    '  Better  ',
    0,
  );
  assert.equal(renamed.frames[0]?.name, 'Better');
  assert.equal(workspace.snapshot(canvasId).frames[0]?.manifestVersion, 1);
  assert.deepEqual(
    await workspace.renameFrame(scope, 'rename-hey', original.designId, '  Better  ', 0),
    renamed,
  );
  await assert.rejects(workspace.renameFrame(scope, 'stale-name', original.designId, 'Older', 0), {
    code: 'revision_conflict',
  });
});

test('removing a frame aborts its running build and keeps it off the board', async (t) => {
  const fleet = new CompilerFleet();
  const deadlines = fakeDeadlines();
  const builds = new CanvasBuilds({ compiler: fleet.client, deadline: deadlines.deadline });
  const { workspace, canvasId, scope } = await opened(t, builds);
  const original = await frame(workspace, scope, 'create-hey');
  await workspace.write(scope, {
    mutationId: 'write-hey',
    designId: original.designId,
    expectedRevisionId: null,
    files: { 'main.tsx': SOURCE },
    deletedPaths: [],
  });
  const running = await fleet.compile(1);
  await workspace.removeFrames(scope, 'remove-hey', [original.designId]);
  assert.equal(running.signal.aborted, true);
  running.ready('late-artifact');
  assert.deepEqual(workspace.snapshot(canvasId).frames, []);
});

test('a failed post-rename flush still cancels the removed frame build', async (t) => {
  t.mock.method(console, 'error', () => undefined);
  const fleet = new CompilerFleet();
  const builds = new CanvasBuilds({ compiler: fleet.client, deadline: fakeDeadlines().deadline });
  let armed = false;
  let renamed = false;
  const fs = observedFileSystem((operation, path) => {
    if (!armed) return;
    if (operation === 'rename' && path.endsWith('manifest.json')) renamed = true;
    if (renamed && operation === 'open' && !path.split('/').at(-1)?.includes('.'))
      throw new Error('flush failed');
  });
  const { workspace, scope } = await opened(t, builds, fs);
  const original = await frame(workspace, scope, 'create-hey');
  await workspace.write(scope, {
    mutationId: 'write-hey',
    designId: original.designId,
    expectedRevisionId: null,
    files: { 'main.tsx': SOURCE },
    deletedPaths: [],
  });
  const running = await fleet.compile(1);
  armed = true;
  await assert.rejects(workspace.removeFrames(scope, 'remove-hey', [original.designId]), {
    code: 'storage_failed',
  });
  assert.equal(running.signal.aborted, true);
});

test('retiring the oldest Undo retains every source revision across reopen', async (t) => {
  const { root, deps, workspace, builds, canvasId, scope } = await opened(t);
  const first = await frame(workspace, scope, 'create-0');
  const written = await workspace.write(scope, {
    mutationId: 'write-0',
    designId: first.designId,
    expectedRevisionId: null,
    files: { 'main.tsx': SOURCE },
    deletedPaths: [],
  });
  const revisionIds = [written.revisionId];
  const removed = await workspace.removeFrames(scope, 'remove-0', [first.designId]);
  for (let index = 1; index <= 50; index += 1) {
    const design = await frame(workspace, scope, `create-${String(index)}`);
    const revision = await workspace.write(scope, {
      mutationId: `write-${String(index)}`,
      designId: design.designId,
      expectedRevisionId: null,
      files: { 'main.tsx': SOURCE },
      deletedPaths: [],
    });
    revisionIds.push(revision.revisionId);
    await workspace.removeFrames(scope, `remove-${String(index)}`, [design.designId]);
  }
  await assert.rejects(workspace.undoRemoval(scope, 'undo-oldest', removed.undoId), {
    code: 'invalid_input',
  });
  const revisionsDirectory = join(root, canvasId, 'revisions');
  assert.deepEqual((await readdir(revisionsDirectory)).sort(), revisionIds.sort());
  await assert.rejects(workspace.readFiles(canvasId, written), { code: 'not_found' });
  await builds.close();
  await workspace.close();
  const reopenedBuilds = quietBuilds();
  const reopened = await CanvasWorkspace.open(root, reopenedBuilds, deps);
  t.after(async () => {
    await reopenedBuilds.close();
    await reopened.close();
  });
  assert.deepEqual((await readdir(revisionsDirectory)).sort(), revisionIds);
  await assert.rejects(reopened.undoRemoval(scope, 'undo-oldest-reopened', removed.undoId), {
    code: 'invalid_input',
  });
});

test('retiring Undo keeps source a surviving frame references', async (t) => {
  const { root, workspace, canvasId, scope } = await opened(t);
  const original = await frame(workspace, scope, 'create-source');
  const written = await workspace.write(scope, {
    mutationId: 'write-source',
    designId: original.designId,
    expectedRevisionId: null,
    files: { 'main.tsx': SOURCE },
    deletedPaths: [],
  });
  const copied = await workspace.create(scope, {
    mutationId: 'create-copy',
    frames: [
      {
        name: 'Copy',
        width: 720,
        height: 720,
        designSystem,
        seed: { kind: 'revision', canvasId, revision: written },
      },
    ],
  });
  await workspace.removeFrames(scope, 'remove-source', [original.designId]);
  for (let index = 0; index < 50; index += 1) {
    const design = await frame(workspace, scope, `create-extra-${String(index)}`);
    await workspace.removeFrames(scope, `remove-extra-${String(index)}`, [design.designId]);
  }
  const saved = await readdir(join(root, canvasId, 'revisions'));
  assert.ok(saved.includes(written.revisionId));
  const copy = copied.frames[0];
  assert.ok(copy?.revisionId);
  assert.equal(
    (
      await workspace.readFiles(canvasId, {
        designId: copy.designId,
        revisionId: copy.revisionId,
      })
    )['main.tsx'],
    SOURCE,
  );
});
