import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { canvasRoot } from '../testing/canvasStorageSupport.js';
import { CanvasFiles } from './canvasFiles.js';
import { REVISION_METADATA_VERSION } from './canvasRevisionMetadata.js';
import { stageFrames } from './canvasFrames.js';
import type { CreateFramesInput } from './protocol.js';

const designSystem = { id: 'droidex', version: 1, mode: 'light' } as const;
const frame = { name: 'Copy', width: 720, height: 720, designSystem };
const revision = { designId: 'dsg_hey', revisionId: 'rev_01' };

async function withRevision(t: TestContext): Promise<CanvasFiles> {
  const files = new CanvasFiles(await canvasRoot(t));
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
  return files;
}

function create(frames: CreateFramesInput['frames']): CreateFramesInput {
  return { mutationId: 'create-copy', frames };
}

test('a seed is copied from this canvas only, and a library seed is refused', async (t) => {
  const files = await withRevision(t);
  const [staged] = await stageFrames(
    files,
    'cv_01',
    create([{ ...frame, seed: { kind: 'revision', canvasId: 'cv_01', revision } }]),
  );
  assert.ok(staged?.revisionId);
  assert.notEqual(staged.revisionId, revision.revisionId);

  await assert.rejects(
    stageFrames(
      files,
      'cv_01',
      create([{ ...frame, seed: { kind: 'revision', canvasId: 'cv_other', revision } }]),
    ),
    { code: 'invalid_input' },
  );
  await assert.rejects(
    stageFrames(
      files,
      'cv_01',
      create([{ ...frame, seed: { kind: 'library', itemId: 'item_01' } }]),
    ),
    { code: 'invalid_input' },
  );
});
