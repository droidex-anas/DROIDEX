// Shared setup for the Canvas storage suites: a real scratch root, and the
// filesystem seam wrapped with one hook so a test can pause or fail exactly the
// call it cares about.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { CanvasBuilds } from '../canvas/CanvasBuilds.js';
import { nodeCanvasFileSystem, type CanvasFileSystem } from '../canvas/canvasFiles.js';
import { CompileCancelledError } from '../canvas/compiler.js';
import {
  canvasManifestSchema,
  CANVAS_MUTATION_RETENTION,
  emptyCanvasManifest,
  type CanvasManifest,
  type PersistedDesign,
  type PersistedMutation,
} from '../canvas/canvasManifest.js';

/** A real Canvas root directory, removed after the test. */
export async function canvasRoot(t: TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'droidex-canvas-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return join(directory, 'canvases');
}

/**
 * A build registry for the suites that are about storage rather than previews.
 * Its compiler answers every build with a cancellation, which publishes no
 * build change, so those suites still see exactly the changes they commit.
 */
export function quietBuilds(): CanvasBuilds {
  return new CanvasBuilds({
    compiler: () => ({
      compile: () => Promise.reject(new CompileCancelledError()),
      terminate: () => Promise.resolve(),
    }),
    deadline: () => () => undefined,
  });
}

/** A promise a test resolves itself, to hold or release an awaited call. */
export function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
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

/** The lease the filler receipts in `ledgerAtCapacity` belong to. */
const LEDGER_FILLER_SCOPE_ID = 'scope-filler';

/**
 * A canvas history holding as many unsettled receipts as the ledger allows:
 * `create` plus filler arranges under one other lease. Parsed through the
 * loader's own schema, so a test builds a history the workspace accepts rather
 * than a hand-made object.
 */
export function ledgerAtCapacity(
  canvasId: string,
  appSessionId: string,
  design: PersistedDesign,
  create: PersistedMutation,
): CanvasManifest {
  const manifest = emptyCanvasManifest(canvasId, 'Canvas 1', 1_767_225_600_000);
  manifest.sequence = 1;
  manifest.designs.push(design);
  manifest.attachedAppSessionIds.push(appSessionId);
  manifest.mutations.push(create);
  while (manifest.mutations.length < CANVAS_MUTATION_RETENTION.unsettled) {
    manifest.mutations.push({
      kind: 'arrange',
      mutationId: `filler-${String(manifest.mutations.length)}`,
      scopeId: LEDGER_FILLER_SCOPE_ID,
      fingerprint: 'f'.repeat(64),
      sequence: 1,
      placements: [],
    });
  }
  return canvasManifestSchema.parse(manifest);
}
