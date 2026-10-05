import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { canvasRoot, observedFileSystem } from '../testing/canvasStorageSupport.js';
import { CanvasFiles, REVISION_METADATA_VERSION, type NewRevision } from './canvasFiles.js';
import { emptyCanvasManifest, type CanvasManifest } from './canvasManifest.js';

const designSystem = { id: 'droidex', version: 1, mode: 'light' } as const;

function manifest(canvasId = 'cv_01'): CanvasManifest {
  const value = emptyCanvasManifest(canvasId, 'Components', 1_767_225_600_000);
  value.designs.push({
    designId: 'dsg_hey',
    name: 'Hey',
    rect: { x: 0, y: 0, width: 720, height: 720 },
    layoutVersion: 0,
    revisionId: null,
    designSystem,
  });
  return value;
}

function revision(overrides: Partial<NewRevision> = {}): NewRevision {
  return {
    version: REVISION_METADATA_VERSION,
    designId: 'dsg_hey',
    revisionId: 'rev_01',
    parentRevisionId: null,
    designSystem,
    createdAt: 1_767_225_600_000,
    ...overrides,
  };
}

const source = new Map([
  ['main.tsx', 'export default function Hey() {\n  return <h1>Hey</h1>;\n}\n'],
  ['ui/Cta.tsx', 'export const Cta = () => <button type="button">Go</button>;\n'],
]);

async function openRoot(t: TestContext): Promise<{ root: string; files: CanvasFiles }> {
  const root = await canvasRoot(t);
  const files = new CanvasFiles(root);
  await files.createRoot();
  return { root, files };
}

test('a manifest round-trips, and a damaged one is reported without being changed', async (t) => {
  const { root, files } = await openRoot(t);
  assert.deepEqual(await files.loadManifest('cv_01'), { state: 'missing' });

  const saved = manifest();
  await files.writeManifest(saved);
  assert.deepEqual(await files.loadManifest('cv_01'), { state: 'loaded', manifest: saved });
  // A new revision of the same canvas replaces the head in one rename.
  const updated = { ...saved, sequence: 1, name: 'Boards' };
  await files.writeManifest(updated);
  assert.deepEqual(await files.loadManifest('cv_01'), { state: 'loaded', manifest: updated });

  const path = join(root, 'cv_01', 'manifest.json');
  await writeFile(path, '{ not json');
  assert.equal((await files.loadManifest('cv_01')).state, 'damaged');
  await writeFile(path, JSON.stringify({ ...saved, version: 2 }));
  assert.equal((await files.loadManifest('cv_01')).state, 'damaged');
  await writeFile(path, JSON.stringify({ ...saved, canvasId: 'cv_02' }));
  assert.equal((await files.loadManifest('cv_01')).state, 'damaged');
  // Damaged state is surfaced, never repaired or moved aside.
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { ...saved, canvasId: 'cv_02' });
});

test('a published revision round-trips, and another design cannot claim it', async (t) => {
  const { files } = await openRoot(t);
  await files.publishRevision('cv_01', revision(), source);
  assert.deepEqual(
    await files.readRevision('cv_01', { designId: 'dsg_hey', revisionId: 'rev_01' }),
    source,
  );
  await assert.rejects(
    files.readRevision('cv_01', { designId: 'dsg_other', revisionId: 'rev_01' }),
    { code: 'invalid_input' },
  );
  await assert.rejects(
    files.readRevision('cv_01', { designId: 'dsg_hey', revisionId: 'rev_missing' }),
    { code: 'storage_failed' },
  );
});

test('a link anywhere under a revision is refused instead of followed', async (t) => {
  const { root, files } = await openRoot(t);
  await files.publishRevision('cv_01', revision(), source);
  const secret = join(root, 'secret.txt');
  await writeFile(secret, 'not source');

  const sourcePath = join(root, 'cv_01', 'revisions', 'rev_01', 'files', 'main.tsx');
  await rm(sourcePath);
  await symlink(secret, sourcePath);
  await assert.rejects(files.readRevision('cv_01', { designId: 'dsg_hey', revisionId: 'rev_01' }), {
    code: 'storage_failed',
  });

  // A linked revision directory is refused before its metadata is read.
  await symlink(
    join(root, 'cv_01', 'revisions', 'rev_01'),
    join(root, 'cv_01', 'revisions', 'rev_02'),
  );
  await assert.rejects(files.readRevision('cv_01', { designId: 'dsg_hey', revisionId: 'rev_02' }), {
    code: 'storage_failed',
  });
});

test('a published revision is immutable: a second publish cannot replace it', async (t) => {
  const { files } = await openRoot(t);
  await files.publishRevision('cv_01', revision(), source);
  await assert.rejects(
    files.publishRevision('cv_01', revision(), new Map([['main.tsx', 'overwritten']])),
    { code: 'storage_failed' },
  );
  assert.deepEqual(
    await files.readRevision('cv_01', { designId: 'dsg_hey', revisionId: 'rev_01' }),
    source,
  );
});

test('a failed write keeps the last head and leaves no temporary behind', async (t) => {
  const root = await canvasRoot(t);
  let failing: string | null = null;
  const files = new CanvasFiles(
    root,
    observedFileSystem((operation, path) => {
      if (failing !== null && operation === failing) throw new Error('disk full');
      void path;
    }),
  );
  await files.createRoot();
  const saved = manifest();
  await files.writeManifest(saved);

  failing = 'rename';
  await assert.rejects(files.writeManifest({ ...saved, sequence: 1 }), {
    code: 'storage_failed',
  });
  await assert.rejects(files.publishRevision('cv_01', revision(), source), {
    code: 'storage_failed',
  });
  failing = null;

  assert.deepEqual(await files.loadManifest('cv_01'), { state: 'loaded', manifest: saved });
  // The staged revision was discarded, so nothing could publish it later.
  assert.deepEqual(await readdir(join(root, 'cv_01', 'revisions')), []);
  assert.deepEqual(await readdir(join(root, 'cv_01')), ['manifest.json', 'revisions']);
});

test('open removes the staging trees and manifest temporaries a crash left behind', async (t) => {
  const { root, files } = await openRoot(t);
  await files.writeManifest(manifest());
  const staging = join(root, 'cv_01', 'revisions', '.staging-abandoned');
  await mkdir(staging, { recursive: true });
  await writeFile(join(staging, 'revision.json'), '{}');
  await writeFile(join(root, 'cv_01', 'manifest.json.abandoned.tmp'), '{}');

  await files.removeTemporaries('cv_01');
  assert.deepEqual(await readdir(join(root, 'cv_01', 'revisions')), []);
  assert.deepEqual(await readdir(join(root, 'cv_01')), ['manifest.json', 'revisions']);
  // A canvas with nothing to clean is still fine.
  await files.removeTemporaries('cv_02');
});

test('only directories named like a canvas are listed, and a link is not one', async (t) => {
  const { root, files } = await openRoot(t);
  await files.writeManifest(manifest('cv_02'));
  await files.writeManifest(manifest('cv_01'));
  await writeFile(join(root, 'notes.txt'), 'ignored');
  await mkdir(join(root, 'has spaces'), { recursive: true });
  await symlink(join(root, 'cv_01'), join(root, 'cv_linked'));
  assert.deepEqual(await files.listCanvasIds(), ['cv_01', 'cv_02']);
});

test('an unusable identifier or source path never reaches the filesystem', async (t) => {
  const { files } = await openRoot(t);
  await assert.rejects(files.loadManifest('../escape'), { code: 'invalid_input' });
  await assert.rejects(
    files.publishRevision('cv_01', revision(), new Map([['../escape.tsx', 'x']])),
    { code: 'invalid_source_path' },
  );
});
