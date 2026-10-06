import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test, type TestContext } from 'node:test';
import { startCanvasRuntime } from './canvasRuntime.js';

// A runtime the app owns is refused for shape alone, before anything is loaded
// from it, so these fixtures need no real packages. That a whole runtime then
// compiles is what tools/canvas-compiler-probe.ts measures, against the staged
// tree and a packaged app.

const SIDECAR_MODULES = resolve(import.meta.dirname, '../../node_modules');

test('a checkout only has to resolve', () => {
  assert.equal(startCanvasRuntime(null), null);
});

test('an incomplete or damaged runtime names the first file at fault', (t) => {
  const absent = fixture(t, { files: { 'node_modules/absent/index.js': 12 } });
  assert.equal(startCanvasRuntime(absent.path), 'node_modules/absent/index.js is missing');

  const resized = fixture(t, { files: { 'node_modules/a/index.js': 1 } });
  resized.write('node_modules/a/index.js', 'module.exports = 1;\n');
  assert.equal(startCanvasRuntime(resized.path), 'node_modules/a/index.js is 20 bytes, not 1');

  const untyped = fixture(t, { files: { 'node_modules/a/index.js': 'small' } });
  assert.equal(startCanvasRuntime(untyped.path), 'node_modules/a/index.js has no staged size');
});

test('a runtime with no manifest is refused', (t) => {
  const empty = scratch(t, 'canvas-runtime-empty-');
  assert.equal(startCanvasRuntime(empty), 'manifest.json could not be read');

  writeFileSync(join(empty, 'manifest.json'), '{"files":{}}\n');
  assert.equal(startCanvasRuntime(empty), 'manifest.json is not a runtime');
});

test('the esbuild binary has to be there and executable', (t) => {
  const absent = fixture(t, { binary: 'node_modules/@esbuild/absent/bin/esbuild' });
  assert.equal(
    startCanvasRuntime(absent.path),
    'node_modules/@esbuild/absent/bin/esbuild is missing',
  );

  const plain = fixture(t, {});
  plain.write('binary', 'not executable\n');
  chmodSync(join(plain.path, 'binary'), 0o644);
  assert.equal(startCanvasRuntime(plain.path), 'binary is not executable');
});

test('a symbolic link anywhere inside the runtime is refused', (t) => {
  // Staging never makes one, so a link inside is a file from outside wearing an
  // owned path — which a size check cannot see at all for a replaced directory.
  const linkedFile = fixture(t, { files: { 'node_modules/a/index.js': 12 } });
  linkedFile.write('outside.js', 'module.exports = 1;\n');
  mkdirSync(join(linkedFile.path, 'node_modules/a'), { recursive: true });
  symlinkSync(
    join(linkedFile.path, 'outside.js'),
    join(linkedFile.path, 'node_modules/a/index.js'),
  );
  assert.equal(startCanvasRuntime(linkedFile.path), 'node_modules/a/index.js is a symbolic link');

  const linkedDirectory = fixture(t, { files: { 'node_modules/a/index.js': 12 } });
  mkdirSync(join(linkedDirectory.path, 'elsewhere'));
  linkedDirectory.write('elsewhere/index.js', 'module.exports = 1;\n');
  mkdirSync(join(linkedDirectory.path, 'node_modules'));
  symlinkSync(
    join(linkedDirectory.path, 'elsewhere'),
    join(linkedDirectory.path, 'node_modules/a'),
  );
  assert.equal(
    startCanvasRuntime(linkedDirectory.path),
    'node_modules/a/index.js is reached through a symbolic link',
  );
});

test("a module an ancestor supplies is not the runtime's own", (t) => {
  // A runtime whose own node_modules is empty: every specifier then comes from
  // the ancestor, which is the escape to refuse. The link is outside the
  // runtime, where links are the machine's business.
  const parent = scratch(t, 'canvas-runtime-parent-');
  symlinkSync(SIDECAR_MODULES, join(parent, 'node_modules'));
  const borrowed = fixture(t, {}, join(parent, 'runtime'));
  mkdirSync(join(borrowed.path, 'node_modules'));

  assert.equal(startCanvasRuntime(borrowed.path), 'esbuild resolves outside the runtime');
});

test('a runtime with no node_modules at all resolves nothing', (t) => {
  assert.equal(startCanvasRuntime(fixture(t, {}).path), 'esbuild does not resolve');
});

interface Fixture {
  path: string;
  write(relative: string, contents: string): void;
}

/** A runtime directory whose manifest can be bent one field at a time. */
function fixture(
  t: TestContext,
  { binary = 'binary', files = {} }: { binary?: string; files?: Record<string, unknown> },
  at?: string,
): Fixture {
  const path = at ?? scratch(t, 'canvas-runtime-');
  mkdirSync(path, { recursive: true });
  const write = (relative: string, contents: string): void => {
    mkdirSync(dirname(join(path, relative)), { recursive: true });
    writeFileSync(join(path, relative), contents);
  };
  writeFileSync(join(path, 'manifest.json'), `${JSON.stringify({ binary, files })}\n`);
  if (binary === 'binary') {
    write('binary', '#!/bin/sh\n');
    chmodSync(join(path, 'binary'), 0o755);
  }
  return { path, write };
}

function scratch(t: TestContext, prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => {
    rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}
