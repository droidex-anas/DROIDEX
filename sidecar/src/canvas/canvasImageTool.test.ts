import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { harness, toolContent } from '../testing/canvasMcpSupport.js';
import { CANVAS_PNG, pinScratchProfile } from '../testing/canvasStorageSupport.js';
import type { CanvasCapture } from './canvasCaptures.js';
import { canvasError } from './canvasError.js';
import { SANITISED_SVG_PREFIX } from './canvasSvg.js';
import type { ImportProjectImage } from './desktopImageChannel.js';
import type { CaptureImage } from './protocol.js';

pinScratchProfile();

const PNG = CANVAS_PNG.toString('base64');
const ASSET = {
  assetId: 'b'.repeat(64),
  mediaType: 'image/png',
  byteLength: CANVAS_PNG.length,
  width: 1,
  height: 1,
} as const;

async function temporaryFolder(t: TestContext, prefix: string): Promise<string> {
  const folder = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  t.after(() => rm(folder, { recursive: true, force: true }));
  return folder;
}

/** A turn in a chat whose project folder is a fresh directory, with one frame that built. */
async function imageTurn(t: TestContext, capture: CanvasCapture, importImage?: ImportProjectImage) {
  const project = await temporaryFolder(t, 'canvas-image-project-');
  const h = await harness(t, undefined, capture, () => project, importImage);
  h.turns.beginTurn('chat-one', undefined);
  const scopeId = (await h.call('canvas_read', {})).scopeId;
  const designSystem = { id: 'droidex', version: 1, mode: 'dark' };
  const frame = { name: 'Poster', width: 794, height: 1123, designSystem };
  const created = await h.call('canvas_create', { scopeId, mutationId: 'create', frames: [frame] });
  assert.ok(created.created);
  const { canvasId } = created.created;
  const { designId } = created.created.frames[0];
  const written = await h.call('canvas_write', {
    scopeId,
    mutationId: 'write',
    designId,
    expectedRevisionId: null,
    files: { 'main.tsx': 'export default () => <p>Poster</p>' },
    deletedPaths: [],
  });
  assert.ok(written.receipt);
  const image = (input: Record<string, unknown>) => h.call('canvas_image', { scopeId, ...input });
  const { revisionId } = written.receipt;
  return { h, project, scopeId, canvasId, designId, revisionId, image };
}

test('a render writes the revision’s PNG at its scale into the project, and keeps an existing file', async (t) => {
  const asked: CaptureImage[] = [];
  const turn = await imageTurn(t, (_canvasId, _ref, _signal, image) => {
    asked.push(image);
    return Promise.resolve(PNG);
  });
  const tool = turn.h.server.tools.find((entry) => entry.name === 'canvas_image');
  assert.ok(tool);
  const render = { kind: 'render', designId: turn.designId, scale: 2, to: 'exports/poster.png' };

  const [facts, image] = toolContent(await tool.handler({ scopeId: turn.scopeId, ...render }));
  assert.deepEqual(JSON.parse(facts.text ?? ''), {
    ok: true,
    designId: turn.designId,
    revisionId: turn.revisionId,
    path: 'exports/poster.png',
    format: 'png',
    width: 1,
    height: 1,
    bytes: CANVAS_PNG.length,
  });
  assert.deepEqual(image, { type: 'image', data: PNG, mimeType: 'image/png' });
  assert.deepEqual(asked, [{ format: 'png', scale: 2 }]);
  assert.deepEqual(await readFile(join(turn.project, 'exports/poster.png')), CANVAS_PNG);

  const again = await turn.image(render);
  assert.equal(again.code, 'invalid_input');
  assert.match(again.message ?? '', /already exists/);
  assert.equal((await turn.image({ ...render, overwrite: true })).ok, true);
});

test('a render names a file inside the project with its format’s extension, and never follows a link out', async (t) => {
  let captures = 0;
  const turn = await imageTurn(t, () => {
    captures += 1;
    return Promise.resolve(PNG);
  });
  const outside = await temporaryFolder(t, 'canvas-image-outside-');
  await symlink(outside, join(turn.project, 'linked'));
  const render = (to: string, format = 'png') =>
    turn.image({ kind: 'render', designId: turn.designId, format, to });

  for (const to of ['../poster.png', join(outside, 'poster.png'), 'a\\..\\..\\poster.png']) {
    const reply = await render(to);
    assert.equal(reply.code, 'invalid_input', to);
  }
  assert.equal((await render('poster.svg')).code, 'invalid_input');
  assert.equal(captures, 0);

  const linked = await render('linked/poster.png');
  assert.equal(linked.code, 'invalid_input');
  assert.match(linked.message ?? '', /symbolic link/);
  assert.deepEqual(await readdir(outside), []);
});

test('an SVG render is sanitised before it is written, and a refused capture writes nothing', async (t) => {
  const answers = [
    Promise.resolve(
      '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><script>alert(1)</script><rect width="40" height="20" fill="#111"/></svg>',
    ),
    Promise.reject(
      canvasError(
        'capture_unavailable',
        'This design is not a single root <svg>, so it has no SVG. Render it as a PNG.',
      ),
    ),
    Promise.reject(canvasError('capture_unavailable', 'Too large at 3x; try 2x.')),
  ];
  answers.forEach((answer) => answer.catch(() => undefined));
  const turn = await imageTurn(t, () => answers.shift() ?? Promise.reject(new Error('unasked')));

  const saved = await turn.image({
    kind: 'render',
    designId: turn.designId,
    format: 'svg',
    to: 'logo.svg',
  });
  assert.equal(saved.ok, true);
  const svg = await readFile(join(turn.project, 'logo.svg'), 'utf8');
  assert.ok(svg.startsWith(SANITISED_SVG_PREFIX));
  assert.doesNotMatch(svg, /script/);

  const notVector = await turn.image({
    kind: 'render',
    designId: turn.designId,
    format: 'svg',
    to: 'card.svg',
  });
  assert.equal(notVector.code, 'capture_unavailable');
  assert.match(notVector.message ?? '', /not a single root <svg>/);
  const tooLarge = await turn.image({
    kind: 'render',
    designId: turn.designId,
    scale: 3,
    to: 'big.png',
  });
  assert.deepEqual(
    [tooLarge.code, tooLarge.message],
    ['capture_unavailable', 'Too large at 3x; try 2x.'],
  );
  assert.deepEqual((await readdir(turn.project)).sort(), ['logo.svg']);
});

test('an import hands main an image inside the project and answers with its asset reference', async (t) => {
  const imports: { canvasId: string; filePath: string }[] = [];
  const turn = await imageTurn(
    t,
    () => Promise.resolve(PNG),
    (canvasId, filePath) => {
      imports.push({ canvasId, filePath });
      return Promise.resolve(ASSET);
    },
  );
  const outside = await temporaryFolder(t, 'canvas-image-outside-');
  await writeFile(join(outside, 'secret.png'), CANVAS_PNG);
  await mkdir(join(turn.project, 'assets'));
  await writeFile(join(turn.project, 'assets/logo.png'), CANVAS_PNG);
  await writeFile(join(turn.project, 'notes.txt'), 'notes');
  await symlink(join(outside, 'secret.png'), join(turn.project, 'secret.png'));

  const imported = await turn.image({ kind: 'import', from: 'assets/logo.png' });
  assert.deepEqual(imported, {
    ok: true,
    assetId: ASSET.assetId,
    mediaType: 'image/png',
    width: 1,
    height: 1,
    reference: `canvas-asset:${ASSET.assetId}`,
  });
  for (const from of ['../secret.png', 'secret.png', 'notes.txt', 'missing.png']) {
    assert.equal((await turn.image({ kind: 'import', from })).code, 'invalid_input', from);
  }
  assert.deepEqual(imports, [
    { canvasId: turn.canvasId, filePath: join(turn.project, 'assets/logo.png') },
  ]);
});
