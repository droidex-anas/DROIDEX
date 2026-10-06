import assert from 'node:assert/strict';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test, type TestContext } from 'node:test';
import { verifyCanvasRuntime } from './canvasRuntime.js';

// The sidecar's own packages, reached through one link so that every specifier
// still resolves inside the fixture: node answers with a real path, and
// `verifyCanvasRuntime` reads the runtime's node_modules through its links for
// exactly that reason.
const SIDECAR_MODULES = resolve(import.meta.dirname, '../../node_modules');
const BINARY = `node_modules/@esbuild/${process.platform}-${process.arch}/bin/esbuild`;

test('a complete runtime is usable', (t) => {
  assert.equal(verifyCanvasRuntime(fixture(t, {})), null);
});

test('a checkout has nothing the app owns to verify', () => {
  assert.equal(verifyCanvasRuntime(null), null);
});

test('an incomplete or damaged runtime names the first file at fault', (t) => {
  const absent = fixture(t, { files: { 'node_modules/absent/index.js': 12 } });
  assert.equal(verifyCanvasRuntime(absent), 'node_modules/absent/index.js is missing');

  const path = 'node_modules/react/index.js';
  const resized = fixture(t, { files: { [path]: 1 } });
  const size = statSync(join(SIDECAR_MODULES, 'react/index.js')).size;
  assert.equal(verifyCanvasRuntime(resized), `${path} is ${String(size)} bytes, not 1`);

  const untyped = fixture(t, { files: { [path]: 'small' } });
  assert.equal(verifyCanvasRuntime(untyped), `${path} has no staged size`);
});

test('a runtime with no manifest is refused', (t) => {
  const empty = mkdtempSync(join(tmpdir(), 'canvas-runtime-empty-'));
  t.after(() => {
    rmSync(empty, { recursive: true, force: true });
  });

  assert.equal(verifyCanvasRuntime(empty), 'manifest.json could not be read');
  writeFileSync(join(empty, 'manifest.json'), '{"files":{}}\n');
  assert.equal(verifyCanvasRuntime(empty), 'manifest.json is not a runtime');
});

test('the esbuild binary has to be there and executable', (t) => {
  const absent = fixture(t, { binary: 'node_modules/@esbuild/absent/bin/esbuild' });
  assert.equal(verifyCanvasRuntime(absent), 'node_modules/@esbuild/absent/bin/esbuild is missing');

  const plain = fixture(t, { binary: 'binary' });
  writeFileSync(join(plain, 'binary'), 'not executable\n');
  chmodSync(join(plain, 'binary'), 0o644);
  assert.equal(verifyCanvasRuntime(plain), 'binary is not executable');
});

test("a module an ancestor supplies is not the runtime's own", (t) => {
  // A complete-looking runtime whose own node_modules is empty: every
  // specifier then comes from the ancestor, which is the escape to refuse.
  const parent = mkdtempSync(join(tmpdir(), 'canvas-runtime-parent-'));
  t.after(() => {
    rmSync(parent, { recursive: true, force: true });
  });
  symlinkSync(SIDECAR_MODULES, join(parent, 'node_modules'));
  const borrowed = join(parent, 'runtime');
  mkdirSync(join(borrowed, 'node_modules'), { recursive: true });
  writeFileSync(
    join(borrowed, 'manifest.json'),
    `${JSON.stringify({ binary: 'binary', files: {} })}\n`,
  );
  writeFileSync(join(borrowed, 'binary'), '#!/bin/sh\n');
  chmodSync(join(borrowed, 'binary'), 0o755);

  assert.equal(verifyCanvasRuntime(borrowed), 'esbuild resolves outside the runtime');
});

test('a runtime with no node_modules at all is refused', (t) => {
  const bare = mkdtempSync(join(tmpdir(), 'canvas-runtime-bare-'));
  t.after(() => {
    rmSync(bare, { recursive: true, force: true });
  });
  writeFileSync(
    join(bare, 'manifest.json'),
    `${JSON.stringify({ binary: 'binary', files: {} })}\n`,
  );
  writeFileSync(join(bare, 'binary'), '#!/bin/sh\n');
  chmodSync(join(bare, 'binary'), 0o755);

  assert.equal(verifyCanvasRuntime(bare), 'node_modules is missing');
});

/** A runtime directory whose manifest can be bent one field at a time. */
function fixture(
  t: TestContext,
  { binary = BINARY, files = {} }: { binary?: string; files?: Record<string, unknown> },
): string {
  const directory = mkdtempSync(join(tmpdir(), 'canvas-runtime-'));
  t.after(() => {
    rmSync(directory, { recursive: true, force: true });
  });
  symlinkSync(SIDECAR_MODULES, join(directory, 'node_modules'));
  writeFileSync(join(directory, 'manifest.json'), `${JSON.stringify({ binary, files })}\n`);
  return directory;
}
