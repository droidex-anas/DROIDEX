import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import test, { type TestContext } from 'node:test';
import {
  canvasRoot,
  observedFileSystem,
  type CanvasFileSystemOperation,
} from '../testing/canvasStorageSupport.js';
import { canvasError } from './canvasError.js';
import { CanvasFiles } from './canvasFiles.js';
import { REVISION_METADATA_VERSION, type NewRevision } from './canvasRevisionMetadata.js';
import { emptyCanvasManifest, type CanvasManifest } from './canvasManifest.js';

const designSystem = { id: 'droidex', version: 1, mode: 'light' } as const;
const keepGoing = (): void => undefined;

function manifest(canvasId = 'cv_01'): CanvasManifest {
  const value = emptyCanvasManifest(canvasId, 'Components', 1_767_225_600_000);
  value.designs.push({
    designId: 'dsg_hey',
    name: 'Hey',
    rect: { x: 0, y: 0, width: 720, height: 720 },
    layoutVersion: 0,
    manifestVersion: 0,
    revisionId: null,
    lastWorkingRevisionId: null,
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
  await files.writeManifest(saved, keepGoing);
  assert.deepEqual(await files.loadManifest('cv_01'), { state: 'loaded', manifest: saved });
  // A new revision of the same canvas replaces the head in one rename.
  const updated = { ...saved, sequence: 1, name: 'Boards' };
  await files.writeManifest(updated, keepGoing);
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

test('a manifest the caller abandons before the rename leaves the last head', async (t) => {
  const { root, files } = await openRoot(t);
  const saved = manifest();
  await files.writeManifest(saved, keepGoing);
  await assert.rejects(
    files.writeManifest({ ...saved, sequence: 9 }, () => {
      throw canvasError('scope_expired', 'the lease was revoked');
    }),
    { code: 'scope_expired' },
  );
  assert.deepEqual(await files.loadManifest('cv_01'), { state: 'loaded', manifest: saved });
  assert.deepEqual(await readdir(join(root, 'cv_01')), ['manifest.json']);
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
  // A revision nobody stored is an unusable reference, not damaged storage.
  await assert.rejects(
    files.readRevision('cv_01', { designId: 'dsg_hey', revisionId: 'rev_missing' }),
    { code: 'invalid_input' },
  );
});

test('a revision whose listed source is gone is damaged, not an unknown reference', async (t) => {
  const { root, files } = await openRoot(t);
  await files.publishRevision('cv_01', revision(), source);
  await rm(join(root, 'cv_01', 'revisions', 'rev_01', 'files', 'main.tsx'));
  await assert.rejects(files.readRevision('cv_01', { designId: 'dsg_hey', revisionId: 'rev_01' }), {
    code: 'storage_failed',
  });
});

test('every directory a publish creates is flushed, leaves before parents', async (t) => {
  const root = await canvasRoot(t);
  const calls: { operation: CanvasFileSystemOperation; path: string }[] = [];
  const files = new CanvasFiles(
    root,
    observedFileSystem((operation, path) => {
      calls.push({ operation, path });
    }),
  );
  await files.createRoot();
  await files.publishRevision('cv_01', revision(), source);

  const staging = calls.find(
    (call) => call.operation === 'mkdir' && basename(call.path).startsWith('.staging-'),
  )?.path;
  assert.ok(staging);
  const canvas = join(root, 'cv_01');
  const revisions = join(canvas, 'revisions');
  const at = (operation: CanvasFileSystemOperation, path: string): number => {
    const index = calls.findIndex((call) => call.operation === operation && call.path === path);
    assert.notEqual(index, -1, `${operation} never reached ${path}`);
    return index;
  };
  const published = at('rename', join(revisions, 'rev_01'));

  // The staging tree is durable before it is renamed into place, deepest first.
  assert.ok(at('open', join(staging, 'files', 'ui')) < at('open', join(staging, 'files')));
  assert.ok(at('open', join(staging, 'files')) < at('open', staging));
  assert.ok(at('open', staging) < published);
  // Then the entries the rename and the new directories added, outwards.
  assert.ok(published < at('open', revisions));
  assert.ok(at('open', revisions) < at('open', canvas));
  assert.ok(at('open', canvas) < at('open', root));
});

test('creating the root and a first manifest flush the entries they added', async (t) => {
  const root = await canvasRoot(t);
  const flushed: string[] = [];
  const files = new CanvasFiles(
    root,
    observedFileSystem((operation, path) => {
      if (operation === 'open' && !basename(path).includes('.')) flushed.push(path);
    }),
  );
  // The root is an entry in the profile directory, which has to record it.
  await files.createRoot();
  assert.deepEqual(flushed, [dirname(root)]);
  flushed.length = 0;

  await files.writeManifest(manifest(), keepGoing);
  assert.deepEqual(flushed, [join(root, 'cv_01'), root]);
  // A canvas that already exists adds no entry to the root.
  flushed.length = 0;
  await files.writeManifest({ ...manifest(), sequence: 1 }, keepGoing);
  assert.deepEqual(flushed, [join(root, 'cv_01')]);
});

test('a linked ancestor or metadata file is refused on the write and read paths', async (t) => {
  const { root, files } = await openRoot(t);
  const outside = join(root, '..', 'outside');
  await mkdir(outside, { recursive: true });

  // A linked `revisions/` would land this design's source outside the root.
  await mkdir(join(root, 'cv_01'));
  await symlink(outside, join(root, 'cv_01', 'revisions'));
  await assert.rejects(files.publishRevision('cv_01', revision(), source), {
    code: 'storage_failed',
  });
  assert.deepEqual(await readdir(outside), []);

  // A decoy the schema accepts and whose files are all present, so following
  // the link would succeed and only the open refusing it can fail this.
  await files.publishRevision('cv_02', revision(), source);
  const metadata = join(root, 'cv_02', 'revisions', 'rev_01', 'revision.json');
  await writeFile(
    join(outside, 'decoy.json'),
    JSON.stringify({ ...revision(), files: [...source.keys()] }),
  );
  await rm(metadata);
  await symlink(join(outside, 'decoy.json'), metadata);
  await assert.rejects(files.readRevision('cv_02', { designId: 'dsg_hey', revisionId: 'rev_01' }), {
    code: 'storage_failed',
  });
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

test('cleanup refuses a linked ancestor instead of deleting through it', async (t) => {
  const { root, files } = await openRoot(t);
  const outside = join(root, '..', 'outside');
  await mkdir(join(outside, '.staging-someone-elses'), { recursive: true });
  await writeFile(join(outside, '.staging-someone-elses', 'keep.txt'), 'not ours');

  await mkdir(join(root, 'cv_01'));
  await symlink(outside, join(root, 'cv_01', 'revisions'));
  await assert.rejects(files.removeTemporaries('cv_01'), { code: 'storage_failed' });
  assert.deepEqual(await readdir(join(outside, '.staging-someone-elses')), ['keep.txt']);

  // A linked canvas directory is refused before anything in it is read.
  await symlink(outside, join(root, 'cv_02'));
  await assert.rejects(files.removeTemporaries('cv_02'), { code: 'storage_failed' });
  assert.deepEqual(await readdir(outside), ['.staging-someone-elses']);
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
  let failing: CanvasFileSystemOperation | null = null;
  const files = new CanvasFiles(
    root,
    observedFileSystem((operation) => {
      if (operation === failing) throw new Error('disk full');
    }),
  );
  await files.createRoot();
  const saved = manifest();
  await files.writeManifest(saved, keepGoing);

  failing = 'rename';
  await assert.rejects(files.writeManifest({ ...saved, sequence: 1 }, keepGoing), {
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
  await files.writeManifest(manifest(), keepGoing);
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
  await files.writeManifest(manifest('cv_02'), keepGoing);
  await files.writeManifest(manifest('cv_01'), keepGoing);
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
