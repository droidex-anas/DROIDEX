import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { canvasRoot } from '../testing/canvasStorageSupport.js';
import { CanvasFiles } from './canvasFiles.js';
import { REVISION_METADATA_VERSION } from './canvasRevisionMetadata.js';
import { placeFrames, stageFrames } from './canvasFrames.js';
import type { CreateFramesInput } from './protocol.js';

const designSystem = { id: 'droidex', version: 1, mode: 'light' } as const;
const frame = { name: 'Copy', width: 720, height: 720, designSystem };
const revision = { designId: 'dsg_hey', revisionId: 'rev_01' };

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

test('a variant is placed only while the frame it is a variant of is on the board', () => {
  const staged = [
    { designId: 'dsg_copy', revisionId: null, frame: { ...frame, variantOf: revision.designId } },
  ];
  assert.throws(() => placeFrames(staged, [], undefined), { code: 'not_found' });

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
  const [placed] = placeFrames(staged, [source], undefined);
  assert.equal(placed?.variantOf, revision.designId);
  // Placed beside another frame, it would sit in a set it does not belong to.
  const other = { ...source, designId: 'dsg_other', rect: { ...source.rect, x: 800 } };
  assert.throws(() => placeFrames(staged, [source, other], { designId: other.designId }), {
    code: 'invalid_input',
  });
});
