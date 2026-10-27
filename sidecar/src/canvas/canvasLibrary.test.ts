import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import {
  APP,
  createCanvas,
  designSystem,
  errorOf,
  harness,
  okReply,
  type Harness,
} from '../testing/canvasBridgeSupport.js';
import { CANVAS_PNG, CANVAS_PNG_ASSET_ID, writeInput } from '../testing/canvasStorageSupport.js';
import { readLibraryCopy } from './canvasLibrary.js';
import type { LibraryItem, RevisionRef } from './protocol.js';

const SOURCE = `export default function Hero(){return <img src="canvas-asset:${CANVAS_PNG_ASSET_ID}" alt="Hero"/>}`;
const THUMBNAIL = CANVAS_PNG.toString('base64');

/** A profile of its own, so each test sees only the library it saved. */
async function libraryProfile(t: TestContext): Promise<string> {
  const profile = await mkdtemp(join(tmpdir(), 'droidex-library-'));
  const previous = process.env.DROIDEX_USER_DATA_DIR;
  process.env.DROIDEX_USER_DATA_DIR = profile;
  t.after(async () => {
    if (previous === undefined) delete process.env.DROIDEX_USER_DATA_DIR;
    else process.env.DROIDEX_USER_DATA_DIR = previous;
    await rm(profile, { recursive: true, force: true });
  });
  return profile;
}

/** A 640 × 400 frame whose committed source shows an owned image. */
async function heroCanvas(t: TestContext, profile: string) {
  const canvas = await harness(t);
  const canvasId = await createCanvas(canvas);
  await canvas.handle({
    type: 'canvas.create',
    requestId: 'req-create-hero',
    appSessionId: APP,
    canvasId,
    input: {
      mutationId: 'create-hero',
      frames: [{ name: 'Hero', width: 640, height: 400, designSystem }],
    },
  });
  const reserved = okReply(canvas, 'req-create-hero');
  assert.ok(reserved.kind === 'created');
  const designId = reserved.created.frames[0]?.designId;
  assert.ok(designId);
  const image = join(profile, 'hero.png');
  await writeFile(image, CANVAS_PNG);
  await canvas.workspace.importCanvasImage({
    canvasId,
    filePath: image,
    digest: CANVAS_PNG_ASSET_ID,
    width: 1,
    height: 1,
  });
  await canvas.handle({
    type: 'canvas.write',
    requestId: 'req-write-hero',
    appSessionId: APP,
    canvasId,
    input: writeInput('write-hero', designId, null, { 'main.tsx': SOURCE }),
  });
  const written = okReply(canvas, 'req-write-hero');
  assert.ok(written.kind === 'written');
  const revision = { designId, revisionId: written.receipt.revisionId };
  return { canvas, canvasId, revision };
}

async function save(
  canvas: Harness,
  requestId: string,
  fields: {
    mutationId: string;
    canvasId: string;
    revision: RevisionRef;
    name: string;
    thumbnail?: string;
  },
) {
  await canvas.handle({ type: 'canvas.saveLibraryItem', requestId, ...fields });
}

async function thumbnail(canvas: Harness, requestId: string, itemId: string) {
  await canvas.handle({ type: 'canvas.readLibraryThumbnail', requestId, itemId });
  const reply = okReply(canvas, requestId);
  assert.ok(reply.kind === 'libraryThumbnail');
  return reply.png;
}

async function list(canvas: Harness, requestId: string, query: string): Promise<LibraryItem[]> {
  await canvas.handle({ type: 'canvas.listLibraryItems', requestId, query });
  const reply = okReply(canvas, requestId);
  assert.ok(reply.kind === 'libraryItems');
  return reply.items;
}

test('a library item is an immutable copy that inserts as an independent design', async (t) => {
  const profile = await libraryProfile(t);
  const { canvas, canvasId, revision } = await heroCanvas(t, profile);
  await save(canvas, 'req-save', {
    mutationId: 'save-hero',
    canvasId,
    revision,
    name: 'Hero Card',
  });
  const saved = okReply(canvas, 'req-save');
  assert.ok(saved.kind === 'libraryItem');
  // The size is the frame's on its canvas, never the caller's word.
  assert.deepEqual(saved.item, {
    itemId: 'save-hero',
    name: 'Hero Card',
    sourceCanvasId: canvasId,
    source: revision,
    width: 640,
    height: 400,
    designSystem,
  });
  assert.deepEqual(await list(canvas, 'req-list-hero', '  hERO '), [saved.item]);
  assert.deepEqual(await list(canvas, 'req-list-none', 'footer'), []);
  assert.equal(await thumbnail(canvas, 'req-no-thumbnail', 'save-hero'), null);
  await save(canvas, 'req-save-text', {
    mutationId: 'save-text',
    canvasId,
    revision,
    name: 'Hero',
    thumbnail: Buffer.from('not a png').toString('base64'),
  });
  assert.equal(errorOf(canvas, 'req-save-text').code, 'invalid_input');

  // Another chat's canvas takes the item through an ordinary create.
  const other = await canvas.workspace.createCanvas('app-2', 'create-other');
  await canvas.handle({
    type: 'canvas.create',
    requestId: 'req-insert',
    appSessionId: 'app-2',
    canvasId: other.canvasId,
    input: {
      mutationId: 'insert-hero',
      frames: [
        {
          name: 'Hero',
          width: 720,
          height: 720,
          designSystem,
          seed: { kind: 'library', itemId: 'save-hero' },
        },
      ],
    },
  });
  const created = okReply(canvas, 'req-insert');
  assert.ok(created.kind === 'created');
  const [inserted] = created.created.frames;
  assert.ok(inserted?.revisionId);
  const insertedRef = { designId: inserted.designId, revisionId: inserted.revisionId };
  assert.deepEqual(
    { ...(await canvas.workspace.readFiles(other.canvasId, insertedRef)) },
    {
      'main.tsx': SOURCE,
    },
  );
  await canvas.handle({
    type: 'canvas.listAssets',
    requestId: 'req-assets',
    canvasId: other.canvasId,
  });
  const assets = okReply(canvas, 'req-assets');
  assert.ok(assets.kind === 'assets');
  assert.deepEqual(
    assets.assets.map((asset) => asset.assetId),
    [CANVAS_PNG_ASSET_ID],
  );

  // Changing the inserted copy changes neither the item nor the original.
  await canvas.handle({
    type: 'canvas.write',
    requestId: 'req-edit-copy',
    appSessionId: 'app-2',
    canvasId: other.canvasId,
    input: writeInput('edit-copy', inserted.designId, inserted.revisionId, {
      'main.tsx': 'export default () => null;',
    }),
  });
  assert.equal(okReply(canvas, 'req-edit-copy').kind, 'written');
  const library = await readLibraryCopy('save-hero');
  assert.deepEqual([...library.files], [['main.tsx', SOURCE]]);
  assert.deepEqual(library.images[0]?.bytes, CANVAS_PNG);
  assert.deepEqual(
    { ...(await canvas.workspace.readFiles(canvasId, revision)) },
    { 'main.tsx': SOURCE },
  );
});

test('an item outlives its source canvas, answering retries and inserting elsewhere', async (t) => {
  const profile = await libraryProfile(t);
  const { canvas, canvasId, revision } = await heroCanvas(t, profile);
  const fields = { mutationId: 'save-once', canvasId, revision, name: 'Hero' };
  await save(canvas, 'req-first', { ...fields, thumbnail: THUMBNAIL });
  await canvas.handle({
    type: 'canvas.removeCanvas',
    requestId: 'req-remove',
    canvasId,
    expectedSequence: canvas.workspace.snapshot(canvasId).sequence,
    expectedAttachedAppSessionIds: [APP],
  });
  assert.equal(okReply(canvas, 'req-remove').kind, 'ok');

  await save(canvas, 'req-retry', fields);
  assert.deepEqual(okReply(canvas, 'req-retry'), okReply(canvas, 'req-first'));
  assert.deepEqual(await readdir(join(profile, 'canvas-library')), ['save-once']);
  // The item owns its picture, so it survives the canvas whose capture it copied.
  assert.equal(await thumbnail(canvas, 'req-thumbnail', 'save-once'), THUMBNAIL);
  await save(canvas, 'req-renamed', { ...fields, name: 'Another hero' });
  assert.equal(errorOf(canvas, 'req-renamed').code, 'invalid_input');

  const other = await createCanvas(canvas, 'req-other-canvas');
  const insert = async (requestId: string, itemId: string) => {
    await canvas.handle({
      type: 'canvas.create',
      requestId,
      appSessionId: APP,
      canvasId: other,
      input: {
        mutationId: requestId,
        frames: [
          {
            name: 'Hero',
            width: 720,
            height: 720,
            designSystem,
            seed: { kind: 'library', itemId },
          },
        ],
      },
    });
  };
  await insert('req-insert', 'save-once');
  const created = okReply(canvas, 'req-insert');
  assert.ok(created.kind === 'created');
  const [inserted] = created.created.frames;
  assert.ok(inserted?.revisionId);
  const ref = { designId: inserted.designId, revisionId: inserted.revisionId };
  assert.deepEqual({ ...(await canvas.workspace.readFiles(other, ref)) }, { 'main.tsx': SOURCE });
  await insert('req-missing-item', 'never-saved');
  assert.equal(errorOf(canvas, 'req-missing-item').code, 'not_found');
  await canvas.handle({
    type: 'canvas.readLibraryThumbnail',
    requestId: 'req-missing-thumbnail',
    itemId: 'never-saved',
  });
  assert.equal(errorOf(canvas, 'req-missing-thumbnail').code, 'not_found');
  assert.equal(canvas.workspace.snapshot(other).frames.length, 1);
});
