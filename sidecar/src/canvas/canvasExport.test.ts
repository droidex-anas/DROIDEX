import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { type TestContext } from 'node:test';
import { startBridgeServer } from '../bridgeServer.js';
import { CanvasFiles } from './canvasFiles.js';
import { CanvasCommandError } from './canvasError.js';
import { exportCanvasSource } from './canvasExport.js';
import { readDesignSystem, saveDesignSystem } from './designSystems.js';
import { DROIDEX_DESIGN_SYSTEM } from './presets/droidex.js';
import type { DesignSystemRef } from './protocol.js';

const canvasId = 'export-canvas';
const ref = { designId: 'hey', revisionId: 'revision-1' };
const defaultKit = { id: 'droidex', version: 1, mode: 'light' } as const;

async function profile(t: TestContext): Promise<{ root: string; destination: string }> {
  const root = await mkdtemp(join(tmpdir(), 'canvas-export-'));
  const previous = process.env.DROIDEX_USER_DATA_DIR;
  process.env.DROIDEX_USER_DATA_DIR = root;
  t.after(async () => {
    if (previous === undefined) delete process.env.DROIDEX_USER_DATA_DIR;
    else process.env.DROIDEX_USER_DATA_DIR = previous;
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(join(root, 'canvases'));
  const destination = join(root, 'export');
  await mkdir(destination);
  return { root, destination };
}

async function saveRevision(root: string, files: Record<string, string>, kit: DesignSystemRef) {
  const storage = new CanvasFiles(join(root, 'canvases'));
  await storage.publishRevision(
    canvasId,
    {
      version: 1,
      ...ref,
      parentRevisionId: null,
      designSystem: kit,
      createdAt: 1,
    },
    new Map(Object.entries(files)),
  );
}

async function fileSet(root: string, prefix = ''): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...(await fileSet(root, path)));
    else files.push(path);
  }
  return files.sort();
}

test('exports the exact revision, referenced image, pinned kit, and private-free build metadata', async (t) => {
  const { root, destination } = await profile(t);
  const secret = 'INTERNAL_CANARY_FOR_EXPORT_TEST';
  const font = Buffer.from('wOF2test-font');
  const fontId = createHash('sha256').update(font).digest('hex');
  const kit = await saveDesignSystem({
    ...DROIDEX_DESIGN_SYSTEM,
    id: 'export-kit',
    name: 'Export kit',
    guidance: secret,
    files: {
      ...DROIDEX_DESIGN_SYSTEM.files,
      'tokens.css': `${DROIDEX_DESIGN_SYSTEM.files['tokens.css']}\n@font-face { font-family: Export; src: url(data:font/woff2;base64,${font.toString('base64')}); }`,
      'fonts/OFL.txt': 'Open Font License',
    },
  });
  const image = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489',
    'hex',
  );
  const assetId = createHash('sha256').update(image).digest('hex');
  await mkdir(join(root, 'canvases', canvasId, 'assets'), { recursive: true });
  await writeFile(join(root, 'canvases', canvasId, 'assets', assetId), image);
  const source = `export default function Hey(){return <img src="canvas-asset:${assetId}" alt="Hey"/>}`;
  await saveRevision(root, { 'main.tsx': source, 'style.css': 'h1 { color: red; }' }, kit);

  const result = await exportCanvasSource(canvasId, ref, destination);
  const system = await readDesignSystem(kit);
  const expected = [
    'README.md',
    `assets/${assetId}`,
    'build.mjs',
    'canvas-export/modes.json',
    ...Object.keys(system.files).map((path) => `design-system/${path}`),
    `fonts/${fontId}.woff2`,
    'package.json',
    'src/main.tsx',
    'src/style.css',
  ].sort();
  assert.deepEqual(await fileSet(destination), expected);
  assert.equal(result.filesWritten, expected.length);
  assert.equal(await readFile(join(destination, 'src/main.tsx'), 'utf8'), source);
  assert.deepEqual(await readFile(join(destination, 'assets', assetId)), image);
  assert.deepEqual(await readFile(join(destination, 'fonts', `${fontId}.woff2`)), font);
  for (const path of expected) {
    const content = await readFile(join(destination, path));
    assert.ok(!content.includes(Buffer.from(root)), `${path} exposed the profile path`);
    assert.ok(!content.includes(Buffer.from(secret)), `${path} exposed kit guidance`);
  }
});

test('a collision leaves the existing file byte-identical', async (t) => {
  const { root, destination } = await profile(t);
  await saveRevision(root, { 'main.tsx': 'export default () => null;' }, defaultKit);
  const existing = Buffer.from([0, 255, 1, 2]);
  await writeFile(join(destination, 'README.md'), existing);

  await assert.rejects(exportCanvasSource(canvasId, ref, destination), (error) => {
    assert.ok(error instanceof CanvasCommandError);
    assert.equal(error.code, 'invalid_input');
    return true;
  });
  assert.deepEqual(await readFile(join(destination, 'README.md')), existing);
  assert.deepEqual(await fileSet(destination), ['README.md']);
});

test('the renderer bridge token cannot invoke host-only export', async (t) => {
  const { root, destination } = await profile(t);
  await saveRevision(root, { 'main.tsx': 'export default () => null;' }, defaultKit);
  const bridge = startBridgeServer({
    requestedPort: 0,
    token: 'renderer-token',
    assetToken: 'asset-token',
    canvasExportToken: 'host-token',
    onCommand: async () => undefined,
  });
  t.after(() => bridge.close());
  await bridge.ready;
  const url = `http://127.0.0.1:${String(bridge.port)}/canvas/source-export`;
  const body = JSON.stringify({ canvasId, ref, destinationDirectory: destination });
  const unauthorized = await fetch(url, {
    method: 'POST',
    headers: { 'x-canvas-export-token': 'renderer-token' },
    body,
  });
  assert.equal(unauthorized.status, 404);
  assert.deepEqual(await fileSet(destination), []);
  const malformed = await fetch(url, {
    method: 'POST',
    headers: { 'x-canvas-export-token': 'host-token' },
    body: JSON.stringify({ canvasId, ref, destinationDirectory: destination, extra: true }),
  });
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), {
    code: 'invalid_input',
    message: 'Choose a Canvas revision to export.',
  });
});

test('refuses linked destination paths and escaping revision paths', async (t) => {
  const { root, destination } = await profile(t);
  await saveRevision(root, { 'main.tsx': 'export default () => null;' }, defaultKit);
  const outside = join(root, 'outside');
  await mkdir(outside);
  await symlink(outside, join(destination, 'src'));
  await assert.rejects(exportCanvasSource(canvasId, ref, destination), (error) => {
    assert.ok(error instanceof CanvasCommandError);
    assert.equal(error.code, 'invalid_source_path');
    return true;
  });
  assert.deepEqual(await fileSet(outside), []);

  await rm(join(destination, 'src'));
  const metadata = join(root, 'canvases', canvasId, 'revisions', ref.revisionId, 'revision.json');
  const revision = JSON.parse(await readFile(metadata, 'utf8'));
  revision.files = ['../escape.tsx'];
  await writeFile(metadata, JSON.stringify(revision));
  await assert.rejects(exportCanvasSource(canvasId, ref, destination), CanvasCommandError);
  assert.deepEqual(await fileSet(destination), []);
});

test('the exported Hey starter builds and serves outside the checkout without a download', async (t) => {
  const { root, destination } = await profile(t);
  await saveRevision(root, { 'main.tsx': DROIDEX_DESIGN_SYSTEM.examples['Hey.tsx'] }, defaultKit);
  await exportCanvasSource(canvasId, ref, destination);
  const sidecarModules = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'node_modules');
  await symlink(sidecarModules, join(destination, 'node_modules'), 'dir');
  const server = spawn(process.execPath, ['build.mjs', '--serve', '--port=0'], {
    cwd: destination,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => server.kill());
  const address = await new Promise<string>((resolve, reject) => {
    let output = '';
    server.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      const match = output.match(/Canvas preview: (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) resolve(match[1]);
    });
    let errors = '';
    server.stderr.on('data', (chunk: Buffer) => (errors += chunk.toString()));
    server.on('exit', (code) =>
      reject(new Error(`Exported build exited ${String(code)}: ${errors}`)),
    );
  });
  const [document, script] = await Promise.all([
    fetch(address).then((response) => response.text()),
    fetch(`${address}/app.js`).then((response) => response.text()),
  ]);
  assert.match(document, /canvas-root/);
  assert.match(script, /Hey/);
  assert.match(await readFile(join(destination, 'dist/style.css'), 'utf8'), /--ds-accent/);
});
