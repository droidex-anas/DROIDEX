// Shared setup for the Canvas storage suites: a real scratch root, and the
// filesystem seam wrapped with one hook so a test can pause or fail exactly the
// call it cares about.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { nodeCanvasFileSystem, type CanvasFileSystem } from '../canvas/canvasFiles.js';

/** A real Canvas root directory, removed after the test. */
export async function canvasRoot(t: TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'droidex-canvas-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return join(directory, 'canvases');
}

export type CanvasFileSystemOperation = keyof CanvasFileSystem;

/**
 * The real filesystem, with `hook` called before every operation Canvas uses.
 * The hook throws to inject a fault and awaits to hold the call open; `path` is
 * the operation's target, which is the destination for `rename`.
 */
export function observedFileSystem(
  hook: (operation: CanvasFileSystemOperation, path: string) => Promise<void> | void,
): CanvasFileSystem {
  const observe = async <T>(
    operation: CanvasFileSystemOperation,
    path: string,
    run: () => Promise<T>,
  ): Promise<T> => {
    await hook(operation, path);
    return run();
  };
  return {
    mkdir: (path) => observe('mkdir', path, () => nodeCanvasFileSystem.mkdir(path)),
    mkdirAll: (path) => observe('mkdirAll', path, () => nodeCanvasFileSystem.mkdirAll(path)),
    open: (path, flags, mode) =>
      observe('open', path, () => nodeCanvasFileSystem.open(path, flags, mode)),
    readdir: (path) => observe('readdir', path, () => nodeCanvasFileSystem.readdir(path)),
    lstat: (path) => observe('lstat', path, () => nodeCanvasFileSystem.lstat(path)),
    rename: (from, to) => observe('rename', to, () => nodeCanvasFileSystem.rename(from, to)),
    rm: (path, options) => observe('rm', path, () => nodeCanvasFileSystem.rm(path, options)),
  };
}
