import assert from 'node:assert/strict';
import { readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { isCanvasEvent } from '../../../src/features/canvas/wireValidation.js';
import type { ServerEvent } from '../protocol.js';
import { board } from '../testing/canvasBuildSupport.js';
import {
  canvasRoot,
  deferred,
  observedFileSystem,
  quietBuilds,
} from '../testing/canvasStorageSupport.js';
import { CanvasWorkspace } from './CanvasWorkspace.js';
import { createCanvasCommandHandler } from './canvasBridge.js';
import { CanvasFiles, type CanvasFileSystem } from './canvasFiles.js';
import { restoreRevision } from './canvasRevisionHistory.js';
import { CanvasScopes } from './canvasScopes.js';
import type { CanvasCommand, CanvasScope, SourceFiles } from './protocol.js';
import { CANVAS_LIMITS } from './schema.js';

const designSystem = { id: 'droidex', version: 1, mode: 'light' } as const;

async function harness(t: TestContext, fs?: CanvasFileSystem) {
  const root = await canvasRoot(t);
  const scopes = new CanvasScopes();
  const builds = quietBuilds();
  const deps = {
    isScopeActive: (scopeId: string) => scopes.isScopeActive(scopeId),
    bindScopeCanvas: () => undefined,
    fs,
  };
  const workspace = await CanvasWorkspace.open(root, builds, deps);
  t.after(async () => {
    await builds.close();
    await workspace.close();
  });
  const { canvasId } = await workspace.createCanvas('app-1');
  const scope: CanvasScope = {
    origin: 'user',
    scopeId: 'user-1',
    appSessionId: 'app-1',
    canvasId,
    allowedDesignIds: 'canvas',
  };
  scopes.register(scope);
  const created = await workspace.create(scope, {
    mutationId: 'create',
    frames: [{ name: 'Hey', width: 720, height: 720, designSystem }],
  });
  const designId = created.frames[0]?.designId;
  assert.ok(designId);
  const write = (
    mutationId: string,
    expectedRevisionId: string | null,
    files: SourceFiles,
    deletedPaths: string[] = [],
    author: CanvasScope = scope,
  ) => workspace.write(author, { mutationId, designId, expectedRevisionId, files, deletedPaths });
  return { root, scopes, builds, deps, workspace, canvasId, scope, designId, write };
}

test('history pages committed revisions newest first with safe authors and pinned systems', async (t) => {
  const canvas = await harness(t);
  const { workspace, scope, canvasId, designId } = canvas;
  const first = await canvas.write('one', null, { 'main.tsx': 'one' });
  const agent: CanvasScope = {
    origin: 'turn',
    scopeId: 'private internal scope / never displayed',
    appSessionId: 'agent-1',
    generation: 1,
    canvasId,
    context: { designs: [], elements: [], designSystem },
    allowedDesignIds: 'canvas',
  };
  canvas.scopes.register(agent);
  const second = await canvas.write('two', first.revisionId, { 'main.tsx': 'two' }, [], agent);
  await workspace.arrange(scope, {
    mutationId: 'move',
    frames: [
      { designId, expectedLayoutVersion: 0, rect: { x: 100, y: 0, width: 720, height: 720 } },
    ],
  });
  const third = await workspace.write(scope, {
    mutationId: 'three',
    designId,
    expectedRevisionId: second.revisionId,
    files: { 'main.tsx': 'three' },
    deletedPaths: [],
    designSystem: { ...designSystem, version: 2, mode: 'dark' },
  });
  const page = await workspace.history.listRevisions(canvasId, designId, { limit: 2 });
  assert.deepEqual(
    page.map((revision) => [revision.revisionId, revision.sequence]),
    [
      [third.revisionId, third.sequence],
      [second.revisionId, second.sequence],
    ],
  );
  assert.deepEqual(page[0]?.author, { kind: 'user' });
  assert.deepEqual(page[0]?.designSystem, { ...designSystem, version: 2, mode: 'dark' });
  assert.ok(page[1]?.author.kind === 'agent');
  assert.match(page[1].author.scopeRef, /^scope-[0-9a-f]{64}$/);
  assert.ok(page.every((revision) => revision.createdAt > 0 && revision.mutationKind === 'write'));
  assert.deepEqual(
    (
      await workspace.history.listRevisions(canvasId, designId, {
        limit: 2,
        before: second.sequence,
      })
    ).map((revision) => revision.revisionId),
    [first.revisionId],
  );
  assert.deepEqual(
    await workspace.history.listRevisions(canvasId, designId, { limit: 2, before: first.sequence }),
    [],
  );
  await assert.rejects(
    workspace.history.listRevisions(canvasId, designId, {
      limit: CANVAS_LIMITS.maxRevisionPageSize + 1,
    }),
    { code: 'invalid_input' },
  );
  // Retry receipts may retire without retiring the canonical commit index.
  const files = new CanvasFiles(canvas.root);
  const loaded = await files.loadManifest(canvasId);
  assert.ok(loaded.state === 'loaded');
  loaded.manifest.mutations = [];
  await files.writeManifest(loaded.manifest, () => undefined);
  const reopenedBuilds = quietBuilds();
  const reopened = await CanvasWorkspace.open(canvas.root, reopenedBuilds, canvas.deps);
  t.after(async () => {
    await reopenedBuilds.close();
    await reopened.close();
  });
  assert.deepEqual(
    (await reopened.history.listRevisions(canvasId, designId, { limit: 50 })).map(
      (revision) => revision.revisionId,
    ),
    [third.revisionId, second.revisionId, first.revisionId],
  );
});

test('diff reports canonical added, removed and modified files without moving the head', async (t) => {
  const canvas = await harness(t);
  const first = await canvas.write('one', null, {
    'main.tsx': 'first\nkeep\n',
    'removed.txt': 'remove',
    'same.txt': 'same',
  });
  const second = await canvas.write(
    'two',
    first.revisionId,
    { 'main.tsx': 'second\nkeep\n', 'added.txt': 'add\n' },
    ['removed.txt'],
  );
  const diff = await canvas.workspace.history.diffRevisions(
    canvas.canvasId,
    canvas.designId,
    first.revisionId,
    second.revisionId,
  );
  assert.equal(diff.truncated, false);
  assert.deepEqual(
    diff.files.map((file) => [file.path, file.kind]),
    [
      ['added.txt', 'added'],
      ['main.tsx', 'modified'],
      ['removed.txt', 'removed'],
    ],
  );
  assert.equal(diff.files[0]?.diff, '--- /dev/null\n+++ b/added.txt\n@@ -0,0 +1,1 @@\n+add\n');
  assert.equal(
    diff.files[1]?.diff,
    '--- a/main.tsx\n+++ b/main.tsx\n@@ -1,2 +1,2 @@\n-first\n+second\n keep\n',
  );
  assert.match(diff.files[2]?.diff ?? '', /-remove\n\\ No newline at end of file\n$/);
  assert.equal(
    (
      await canvas.workspace.history.readRevisionFiles(
        canvas.canvasId,
        canvas.designId,
        first.revisionId,
      )
    )['main.tsx'],
    'first\nkeep\n',
  );
  assert.equal(canvas.workspace.snapshot(canvas.canvasId).sequence, second.sequence);
  assert.deepEqual(
    (
      await canvas.workspace.history.diffRevisions(
        canvas.canvasId,
        canvas.designId,
        second.revisionId,
        second.revisionId,
      )
    ).files,
    [],
  );
});

test('diff truncation respects the total UTF-8 cap across files and keeps every changed path', async (t) => {
  const canvas = await harness(t);
  const source = '界'.repeat(100) + '\n';
  const first = await canvas.write('one', null, {
    'a.txt': source.repeat(800),
    'b.txt': source.repeat(800),
  });
  const second = await canvas.write('two', first.revisionId, {
    'a.txt': source.replace('界', '語').repeat(800),
    'b.txt': source.replace('界', '字').repeat(800),
  });
  const diff = await canvas.workspace.history.diffRevisions(
    canvas.canvasId,
    canvas.designId,
    first.revisionId,
    second.revisionId,
  );
  assert.equal(diff.truncated, true);
  assert.deepEqual(
    diff.files.map((file) => [file.path, file.kind]),
    [
      ['a.txt', 'modified'],
      ['b.txt', 'modified'],
    ],
  );
  const bytes = diff.files.reduce((total, file) => total + Buffer.byteLength(file.diff, 'utf8'), 0);
  assert.ok(bytes <= CANVAS_LIMITS.maxRevisionDiffBytes);
  assert.ok(bytes > CANVAS_LIMITS.maxRevisionDiffBytes - 1000);
  assert.ok(diff.files.every((file) => file.diff.endsWith('\n')));
});

test('build status belongs to the exact cached revision, including misses and failed outcomes', async (t) => {
  const canvas = await board(t);
  const [designId] = await canvas.create('Hey');
  assert.ok(designId);
  const first = await canvas.write(designId, null, 'one');
  const history = () =>
    canvas.workspace.history.listRevisions(canvas.canvasId, designId, { limit: 50 });
  assert.equal((await history())[0]?.buildStatus, 'building');
  const ready = canvas.reported(designId, 'ready');
  (await canvas.fleet.compile(1)).ready('artifact-one');
  await ready;
  assert.equal((await history())[0]?.buildStatus, 'ready');
  const second = await canvas.write(designId, first.revisionId, 'two');
  assert.deepEqual(
    (await history()).map((revision) => revision.buildStatus),
    ['building', 'ready'],
  );
  const failed = canvas.reported(designId, 'failed');
  (await canvas.fleet.compile(2)).failed('invalid_source');
  await failed;
  assert.deepEqual(
    (await history()).map((revision) => revision.buildStatus),
    ['failed', 'ready'],
  );
  const builds = join(canvas.store.root, canvas.canvasId, 'builds');
  await rm(join(builds, `${first.revisionId}.json`));
  assert.equal(
    (await history())[1]?.buildStatus,
    'building',
    'a stale artifact alone cannot prove readiness',
  );
  await writeFile(join(builds, `${second.revisionId}.json`), '{ damaged cache');
  assert.equal((await history())[0]?.buildStatus, 'building');
});

test('restore commits a new head and build, retaining later history and its original replay receipt', async (t) => {
  const canvas = await harness(t);
  const first = await canvas.write('one', null, { 'main.tsx': 'one', 'original.txt': 'original' });
  const second = await canvas.workspace.write(canvas.scope, {
    mutationId: 'two',
    designId: canvas.designId,
    expectedRevisionId: first.revisionId,
    files: { 'main.tsx': 'two', 'later.txt': 'later' },
    deletedPaths: ['original.txt'],
    designSystem: { ...designSystem, version: 2 },
  });
  const input = {
    mutationId: 'restore',
    designId: canvas.designId,
    revisionId: first.revisionId,
    expectedRevisionId: second.revisionId,
  };
  const restored = await restoreRevision(canvas.workspace, canvas.scope, input);
  assert.notEqual(restored.revisionId, first.revisionId);
  assert.notEqual(restored.revisionId, second.revisionId);
  assert.equal(restored.sequence, second.sequence + 1);
  assert.deepEqual(
    { ...(await canvas.workspace.readFiles(canvas.canvasId, restored)) },
    { 'main.tsx': 'one', 'original.txt': 'original' },
  );
  const frame = canvas.workspace.snapshot(canvas.canvasId).frames[0];
  assert.deepEqual(frame?.designSystem, designSystem);
  assert.ok(frame?.build.status === 'building' || frame?.build.status === 'cancelled');
  assert.deepEqual(
    (
      await canvas.workspace.history.listRevisions(canvas.canvasId, canvas.designId, { limit: 50 })
    ).map((revision) => [revision.revisionId, revision.mutationKind]),
    [
      [restored.revisionId, 'restore'],
      [second.revisionId, 'write'],
      [first.revisionId, 'write'],
    ],
  );
  assert.equal(
    (
      await canvas.workspace.history.readRevisionFiles(
        canvas.canvasId,
        canvas.designId,
        second.revisionId,
      )
    )['later.txt'],
    'later',
  );
  const later = await canvas.write('three', restored.revisionId, { 'main.tsx': 'three' });
  const reopenedBuilds = quietBuilds();
  const reopened = await CanvasWorkspace.open(canvas.root, reopenedBuilds, canvas.deps);
  t.after(async () => {
    await reopenedBuilds.close();
    await reopened.close();
  });
  assert.deepEqual(await restoreRevision(reopened, canvas.scope, input), restored);
  assert.equal(reopened.snapshot(canvas.canvasId).frames[0]?.revisionId, later.revisionId);
  await assert.rejects(
    restoreRevision(reopened, canvas.scope, { ...input, revisionId: second.revisionId }),
    { code: 'invalid_input' },
  );
});

test('restore CAS rejects a concurrent head change without losing either source or spending its ID', async (t) => {
  const reached = deferred();
  const release = deferred();
  let selectedPath: string | null = null;
  const canvas = await harness(
    t,
    observedFileSystem(async (operation, path) => {
      if (operation !== 'open' || path !== selectedPath) return;
      selectedPath = null;
      reached.resolve();
      await release.promise;
    }),
  );
  const first = await canvas.write('one', null, { 'main.tsx': 'one' });
  const second = await canvas.write('two', first.revisionId, { 'main.tsx': 'two' });
  const input = {
    mutationId: 'restore',
    designId: canvas.designId,
    revisionId: first.revisionId,
    expectedRevisionId: second.revisionId,
  };
  selectedPath = join(canvas.root, canvas.canvasId, 'revisions', first.revisionId, 'revision.json');
  const restoring = restoreRevision(canvas.workspace, canvas.scope, input);
  await reached.promise;
  const third = await canvas.write('three', second.revisionId, { 'main.tsx': 'three' });
  release.resolve();
  await assert.rejects(restoring, { code: 'revision_conflict' });
  assert.equal(canvas.workspace.snapshot(canvas.canvasId).frames[0]?.revisionId, third.revisionId);
  const restored = await restoreRevision(canvas.workspace, canvas.scope, {
    ...input,
    expectedRevisionId: third.revisionId,
  });
  assert.equal((await canvas.workspace.readFiles(canvas.canvasId, restored))['main.tsx'], 'one');
});

test('a removed design refuses restore with not_found while its immutable revisions remain', async (t) => {
  const canvas = await harness(t);
  const revision = await canvas.write('one', null, { 'main.tsx': 'one' });
  const files = new CanvasFiles(canvas.root);
  const loaded = await files.loadManifest(canvas.canvasId);
  assert.ok(loaded.state === 'loaded');
  // 09c will own tombstones; absence from the current board is the history boundary.
  loaded.manifest.designs = [];
  await files.writeManifest(loaded.manifest, () => undefined);
  const builds = quietBuilds();
  const reopened = await CanvasWorkspace.open(canvas.root, builds, canvas.deps);
  t.after(async () => {
    await builds.close();
    await reopened.close();
  });
  await assert.rejects(
    restoreRevision(reopened, canvas.scope, {
      mutationId: 'restore',
      designId: canvas.designId,
      revisionId: revision.revisionId,
      expectedRevisionId: revision.revisionId,
    }),
    { code: 'not_found' },
  );
  assert.equal((await files.readRevision(canvas.canvasId, revision)).get('main.tsx'), 'one');
  assert.deepEqual(await readdir(join(canvas.root, canvas.canvasId, 'revisions')), [
    revision.revisionId,
  ]);
});

test('history excludes orphan revisions left by a refused manifest commit', async (t) => {
  let failing = false;
  const canvas = await harness(
    t,
    observedFileSystem((operation, path) => {
      if (failing && operation === 'rename' && path.endsWith('manifest.json')) {
        failing = false;
        throw new Error('disk full');
      }
    }),
  );
  const first = await canvas.write('one', null, { 'main.tsx': 'one' });
  failing = true;
  await assert.rejects(canvas.write('orphan', first.revisionId, { 'main.tsx': 'orphan' }), {
    code: 'storage_failed',
  });
  const revisions = await readdir(join(canvas.root, canvas.canvasId, 'revisions'));
  assert.equal(revisions.length, 2);
  const orphan = revisions.find((revisionId) => revisionId !== first.revisionId);
  assert.ok(orphan);
  await assert.rejects(
    canvas.workspace.history.readRevisionFiles(canvas.canvasId, canvas.designId, orphan),
    { code: 'not_found' },
  );
  assert.deepEqual(
    (
      await canvas.workspace.history.listRevisions(canvas.canvasId, canvas.designId, { limit: 50 })
    ).map((revision) => revision.revisionId),
    [first.revisionId],
  );
});

test('history bridge validates bounded reads and authorizes restore through the attached chat', async (t) => {
  const canvas = await harness(t);
  const first = await canvas.write('one', null, { 'main.tsx': 'one' });
  const second = await canvas.write('two', first.revisionId, { 'main.tsx': 'two' });
  const events: ServerEvent[] = [];
  const handle = createCanvasCommandHandler(
    Promise.resolve(canvas.workspace),
    canvas.scopes,
    canvas.builds,
    (event) => events.push(event),
    () => () => undefined,
  );
  const request = async (command: CanvasCommand | Record<string, unknown>) => {
    await handle(command, 'page-1');
    const reply = events.find(
      (event) => event.type === 'canvas.result' && event.requestId === command.requestId,
    );
    assert.ok(reply?.type === 'canvas.result');
    assert.ok(isCanvasEvent(reply));
    return reply;
  };
  const target = { canvasId: canvas.canvasId, designId: canvas.designId };
  const listed = await request({
    type: 'canvas.listRevisions',
    requestId: 'list',
    ...target,
    page: { limit: 2 },
  });
  assert.ok(listed.ok && listed.reply.kind === 'revisions' && listed.reply.revisions.length === 2);
  const read = await request({
    type: 'canvas.readRevision',
    requestId: 'read',
    ...target,
    revisionId: first.revisionId,
  });
  assert.ok(
    read.ok && read.reply.kind === 'revisionFiles' && read.reply.files['main.tsx'] === 'one',
  );
  const diff = await request({
    type: 'canvas.diffRevisions',
    requestId: 'diff',
    ...target,
    from: first.revisionId,
    to: second.revisionId,
  });
  assert.ok(diff.ok && diff.reply.kind === 'revisionDiff' && diff.reply.diff.files.length === 1);
  const input = {
    mutationId: 'restore',
    designId: canvas.designId,
    revisionId: first.revisionId,
    expectedRevisionId: second.revisionId,
  };
  const restored = await request({
    type: 'canvas.restoreRevision',
    requestId: 'restore',
    canvasId: canvas.canvasId,
    appSessionId: 'app-1',
    input,
  });
  assert.ok(restored.ok && restored.reply.kind === 'written');
  const invalid = await request({
    type: 'canvas.listRevisions',
    requestId: 'bad-page',
    ...target,
    page: { limit: 51 },
  });
  assert.ok(!invalid.ok && invalid.error.code === 'invalid_input');
  const badPath = await request({
    type: 'canvas.readRevision',
    requestId: 'bad-path',
    ...target,
    revisionId: '../escape',
  });
  assert.ok(!badPath.ok && badPath.error.code === 'invalid_input');
  const detached = await request({
    type: 'canvas.restoreRevision',
    requestId: 'unattached',
    canvasId: canvas.canvasId,
    appSessionId: 'other-app',
    input,
  });
  assert.ok(!detached.ok && detached.error.code === 'scope_expired');
});
