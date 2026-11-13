import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { CANVAS_PNG, canvasRoot, withFrame } from '../testing/canvasStorageSupport.js';
import { CanvasFiles } from './canvasFiles.js';
import { emptyCanvasManifest } from './canvasManifest.js';
import { REVISION_METADATA_VERSION } from './canvasRevisionMetadata.js';
import { placeFrames, stageFrames, stageRevision } from './canvasFrames.js';
import type { CreateFramesInput, SourceFiles } from './protocol.js';

const designSystem = { id: 'droidex', version: 1, mode: 'light' } as const;
const frame = { name: 'Copy', width: 720, height: 720, designSystem };
const revision = { designId: 'dsg_hey', revisionId: 'rev_01' };
const source = {
  designId: revision.designId,
  name: 'Hey',
  rect: { x: 0, y: 0, width: 720, height: 720 },
  layoutVersion: 0,
  manifestVersion: 0,
  revisionId: revision.revisionId,
  lastWorkingRevisionId: null,
  designSystem,
};

async function withRevision(t: TestContext): Promise<{ files: CanvasFiles; root: string }> {
  const root = await canvasRoot(t);
  const files = new CanvasFiles(root);
  await files.createRoot();
  await files.publishRevision(
    'cv_01',
    {
      version: REVISION_METADATA_VERSION,
      ...revision,
      parentRevisionId: null,
      designSystem,
      createdAt: 1_767_225_600_000,
    },
    new Map([['main.tsx', 'export default () => null;\n']]),
  );
  return { files, root };
}

function create(frames: CreateFramesInput['frames']): CreateFramesInput {
  return { mutationId: 'create-copy', frames };
}

test('a seed is copied from this canvas only, and a missing library item is refused', async (t) => {
  const { files, root } = await withRevision(t);
  const [staged] = await stageFrames(
    files,
    root,
    'cv_01',
    create([{ ...frame, seed: { kind: 'revision', canvasId: 'cv_01', revision } }]),
  );
  assert.ok(staged?.revisionId);
  assert.notEqual(staged.revisionId, revision.revisionId);

  await assert.rejects(
    stageFrames(
      files,
      root,
      'cv_01',
      create([{ ...frame, seed: { kind: 'revision', canvasId: 'cv_other', revision } }]),
    ),
    { code: 'invalid_input' },
  );
  await assert.rejects(
    stageFrames(
      files,
      root,
      'cv_01',
      create([{ ...frame, seed: { kind: 'library', itemId: 'item_01' } }]),
    ),
    { code: 'not_found' },
  );
});

test('an SVG seed draws the canvas asset as the frame, and a retry answers the same frame', async (t) => {
  const { root, workspace, canvasId, scope } = await withFrame(t);
  // Main sends a raster's decoded size; an SVG's comes from the sanitised markup.
  const owned = async (name: string, bytes: Buffer, size?: { width: number; height: number }) => {
    const filePath = join(root, name);
    await writeFile(filePath, bytes);
    const digest = createHash('sha256').update(bytes).digest('hex');
    return (await workspace.importCanvasImage({ canvasId, filePath, digest, ...size })).assetId;
  };
  const svgOf = (body: string) =>
    Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">${body}</svg>`);
  const svg = await owned('logo.svg', svgOf('<path d="M0 0h24"/>'));
  const styled = await owned('styled.svg', svgOf('<style>path{fill:red}</style><path d="M0 0"/>'));
  const png = await owned('dot.png', CANVAS_PNG, { width: 1, height: 1 });
  const seeded = (mutationId: string, assetId: string): CreateFramesInput => ({
    mutationId,
    frames: [{ ...frame, seed: { kind: 'svg', assetId } }],
  });

  const created = await workspace.create(scope, seeded('paste-logo', svg));
  const [vector] = created.frames;
  assert.ok(vector?.revisionId);
  assert.equal(created.svgAsImage, undefined);
  const files = await workspace.readFiles(canvasId, {
    designId: vector.designId,
    revisionId: vector.revisionId,
  });
  assert.match(files['main.tsx'] ?? '', /<svg className="block" width="24" height="24">/);
  const retried = await workspace.create(scope, seeded('paste-logo', svg));
  assert.deepEqual(
    retried.frames.map((entry) => entry.designId),
    [vector.designId],
  );

  // The board is told once why a frame is an image; the recorded answer does not repeat it.
  const image = await workspace.create(scope, seeded('paste-styled', styled));
  const designId = image.frames[0]?.designId;
  assert.deepEqual(image.svgAsImage, [{ designId, reason: 'stylesheet' }]);
  assert.equal(
    (await workspace.create(scope, seeded('paste-styled', styled))).svgAsImage,
    undefined,
  );

  await assert.rejects(workspace.create(scope, seeded('paste-dot', png)), {
    code: 'invalid_input',
  });
  await assert.rejects(workspace.create(scope, seeded('paste-gone', 'f'.repeat(64))), {
    code: 'not_found',
  });
});

test('a variant is placed only while the frame it is a variant of is on the board', () => {
  const staged = [
    { designId: 'dsg_copy', revisionId: null, frame: { ...frame, variantOf: revision.designId } },
  ];
  const empty = emptyCanvasManifest('cv_01', 'Board', 1_767_225_600_000);
  assert.throws(() => placeFrames(staged, empty, undefined), {
    code: 'not_found',
    message: /No frame on this board/,
  });
  const removal = {
    undoId: 'undo_01',
    removedAt: 1_767_225_600_000,
    expectedLayoutSequence: 0,
    occupants: [],
    consumed: false,
    designs: [source],
  };
  assert.throws(() => placeFrames(staged, { ...empty, tombstones: [removal] }, undefined), {
    code: 'not_found',
    message: /Undo it/,
  });

  const [placed] = placeFrames(staged, { ...empty, designs: [source] }, undefined);
  assert.equal(placed?.variantOf, revision.designId);
  // Placed beside another frame, it would sit in a set it does not belong to.
  const other = { ...source, designId: 'dsg_other', rect: { ...source.rect, x: 800 } };
  const board = { ...empty, designs: [source, other] };
  assert.throws(() => placeFrames(staged, board, { designId: other.designId }), {
    code: 'invalid_input',
  });
});

test('one write renames a file by case alone', async (t) => {
  const { files } = await withRevision(t);
  const write = (revisionId: string, sources: SourceFiles, deletedPaths: string[]) =>
    stageRevision(
      files,
      'cv_01',
      { ...source, revisionId },
      {
        mutationId: `write-${revisionId}`,
        designId: source.designId,
        expectedRevisionId: revisionId,
        files: sources,
        deletedPaths,
      },
      {},
    );
  const added = await write(revision.revisionId, { 'card.tsx': 'card' }, []);
  const renamed = await write(added.revisionId, { 'Card.tsx': 'card' }, ['card.tsx']);
  const tree = await files.readRevision('cv_01', { ...revision, revisionId: renamed.revisionId });
  assert.deepEqual([...tree.keys()].sort(), ['Card.tsx', 'main.tsx']);
});
