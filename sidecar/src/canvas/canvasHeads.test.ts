import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import {
  canvasRoot,
  observedFileSystem,
  stopFlushingAfterManifestRename,
  terminateAtManifestRename,
  withFrame,
} from '../testing/canvasStorageSupport.js';
import { CanvasFiles, type CanvasFileSystem } from './canvasFiles.js';
import { CanvasHeads } from './canvasHeads.js';
import { emptyCanvasManifest, type CanvasManifest } from './canvasManifest.js';

const keepGoing = (): void => undefined;
const HEY = 'export default function Hey(){return <h1>Hey</h1>}';

function manifest(canvasId: string, appSessionId: string): CanvasManifest {
  const value = emptyCanvasManifest(canvasId, 'Components', 1_767_225_600_000);
  value.attachedAppSessionIds.push(appSessionId);
  return value;
}

async function saved(t: TestContext): Promise<string> {
  const root = await canvasRoot(t);
  const files = new CanvasFiles(root);
  await files.createRoot();
  await files.writeManifest(manifest('cv_01', 'app-1'), keepGoing);
  return root;
}

function reopen(root: string, fs?: CanvasFileSystem): Promise<CanvasHeads> {
  return CanvasHeads.load(new CanvasFiles(root, fs));
}

test('a head whose storage cannot be cleaned is unserved but keeps its chat', async (t) => {
  t.mock.method(console, 'error', () => undefined);
  const root = await saved(t);
  const heads = await reopen(
    root,
    observedFileSystem((operation, path) => {
      if (operation === 'readdir' && path !== root)
        throw new Error('the directory could not be listed');
    }),
  );

  // The manifest validated, so the attachment is known and has to hold: a chat
  // that looked unattached here would be handed a second canvas to attach to.
  assert.deepEqual(heads.damagedIds(), ['cv_01']);
  assert.deepEqual(heads.all(), []);
  assert.equal(heads.find('cv_01'), undefined);
  assert.equal(heads.attachedCanvasId('app-1'), 'cv_01');
});

test('a readable head is served with exactly the attachments it records', async (t) => {
  const root = await saved(t);
  const heads = await reopen(root);
  assert.deepEqual(heads.damagedIds(), []);
  assert.equal(heads.attachedCanvasId('app-1'), 'cv_01');
  assert.equal(heads.attachedCanvasId('app-2'), null);

  // Installing a head that no longer lists the chat releases the reservation.
  await heads.install(emptyCanvasManifest('cv_01', 'Components', 1_767_225_600_001), keepGoing);
  assert.equal(heads.attachedCanvasId('app-1'), null);
});

test('a save that failed after its rename is reconciled, not treated as absent', async (t) => {
  const fault = terminateAtManifestRename('after');
  const { workspace, canvasId, scope, designId } = await withFrame(t, { fs: fault.fs });
  const input = {
    mutationId: 'write-hey',
    designId,
    expectedRevisionId: null,
    files: { 'main.tsx': HEY },
    deletedPaths: [],
  };
  fault.arm();
  await assert.rejects(workspace.write(scope, input), { code: 'storage_failed' });
  await assert.rejects(
    workspace.write(scope, { ...input, mutationId: 'second', files: { 'main.tsx': 'other' } }),
    { code: 'revision_conflict' },
  );
  const receipt = await workspace.write(scope, input);
  assert.equal(workspace.snapshot(canvasId).frames[0]?.revisionId, receipt.revisionId);
  assert.equal(receipt.designId, designId);
  assert.equal((await workspace.readFiles(canvasId, receipt))['main.tsx'], HEY);
});

test('a head recovered after a failed flush is not served until it is durable', async (t) => {
  t.mock.method(console, 'error', () => undefined);
  const fault = stopFlushingAfterManifestRename();
  const { workspace, canvasId, scope, designId } = await withFrame(t, { fs: fault.fs });
  const input = {
    mutationId: 'write-hey',
    designId,
    expectedRevisionId: null,
    files: { 'main.tsx': HEY },
    deletedPaths: [],
  };
  fault.arm();
  await assert.rejects(workspace.write(scope, input), { code: 'storage_failed' });
  assert.deepEqual(workspace.damagedCanvasIds(), [canvasId]);
  assert.throws(() => workspace.snapshot(canvasId), { code: 'storage_failed' });
  await assert.rejects(workspace.write(scope, input), { code: 'storage_failed' });
});
