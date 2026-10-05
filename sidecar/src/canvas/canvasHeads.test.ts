import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { canvasRoot, observedFileSystem } from '../testing/canvasStorageSupport.js';
import { CanvasFiles, type CanvasFileSystem } from './canvasFiles.js';
import { CanvasHeads } from './canvasHeads.js';
import { emptyCanvasManifest, type CanvasManifest } from './canvasManifest.js';

const keepGoing = (): void => undefined;

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
