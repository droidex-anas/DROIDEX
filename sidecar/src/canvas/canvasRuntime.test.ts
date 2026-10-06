import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
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

test('a relative runtime is a malformed host, not a tree to look for', (t) => {
  const absolute = fixture(t, {}).path;

  assert.equal(
    startCanvasRuntime(relative(process.cwd(), absolute)),
    `${relative(process.cwd(), absolute)} is not an absolute path`,
  );
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
  chmodSync(join(plain.path, 'binary'), 0o644);
  assert.equal(startCanvasRuntime(plain.path), 'binary is not executable');
});

test('nothing staging did not place is part of the runtime', (t) => {
  // An entry nobody listed changes resolution without touching a listed file,
  // so the tree is compared to the manifest rather than the other way around.
  const stage = (): Fixture => {
    const staged = fixture(t, { files: { 'node_modules/a/index.js': 20 } });
    staged.write('node_modules/a/index.js', 'module.exports = 1;\n');
    return staged;
  };

  const linked = stage();
  symlinkSync(SIDECAR_MODULES, join(linked.path, 'node_modules/tailwindcss'));
  assert.equal(startCanvasRuntime(linked.path), 'node_modules/tailwindcss is a symbolic link');

  const extraFile = stage();
  extraFile.write('node_modules/a/extra.js', 'module.exports = 2;\n');
  assert.equal(
    startCanvasRuntime(extraFile.path),
    'node_modules/a/extra.js is not part of the runtime',
  );

  const extraDirectory = stage();
  mkdirSync(join(extraDirectory.path, 'node_modules/a/node_modules'));
  assert.equal(
    startCanvasRuntime(extraDirectory.path),
    'node_modules/a/node_modules is not part of the runtime',
  );
});

test("a module an ancestor supplies is not the runtime's own", (t) => {
  // A runtime whose own node_modules holds only staged files: every specifier
  // then comes from the ancestor, which is the escape to refuse. The link is
  // outside the runtime, where links are the machine's business.
  const parent = scratch(t, 'canvas-runtime-parent-');
  symlinkSync(SIDECAR_MODULES, join(parent, 'node_modules'));
  const borrowed = fixture(
    t,
    { files: { 'node_modules/a/index.js': 20 } },
    join(parent, 'runtime'),
  );
  borrowed.write('node_modules/a/index.js', 'module.exports = 1;\n');

  assert.equal(startCanvasRuntime(borrowed.path), 'esbuild resolves outside the runtime');
});

test('a runtime with no node_modules at all resolves nothing', (t) => {
  assert.equal(startCanvasRuntime(fixture(t, {}).path), 'esbuild does not resolve');
});

test('one spelling of a runtime cannot resolve what another verified', (t) => {
  // A root whose last segment is `node_modules` makes node skip that
  // directory's own packages, so a require anchored at the configured spelling
  // and a check run against the canonical one disagreed about where esbuild
  // comes from. One canonical root for both means the ancestor is seen for what
  // it is.
  const above = scratch(t, 'canvas-runtime-above-');
  symlinkSync(SIDECAR_MODULES, join(above, 'node_modules'));
  const layout = join(above, 'layout');
  const staged = fixture(t, { files: { 'node_modules/a/index.js': 20 } }, join(layout, 'runtime'));
  staged.write('node_modules/a/index.js', 'module.exports = 1;\n');
  const alias = join(layout, 'node_modules');
  symlinkSync(staged.path, alias);

  assert.equal(startCanvasRuntime(alias), 'esbuild resolves outside the runtime');
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
  const write = (entry: string, contents: string): void => {
    mkdirSync(dirname(join(path, entry)), { recursive: true });
    writeFileSync(join(path, entry), contents);
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
