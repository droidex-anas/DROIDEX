// Shared setup for the Canvas storage suites: a real scratch root, and the
// filesystem seam wrapped with one hook so a test can pause or fail exactly the
// call it cares about.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { TestContext } from 'node:test';
import { CanvasBuilds } from '../canvas/CanvasBuilds.js';
import { CanvasWorkspace, type CanvasWorkspaceDeps } from '../canvas/CanvasWorkspace.js';
import type { CanvasScope } from '../canvas/protocol.js';
import { CanvasFiles, nodeCanvasFileSystem, type CanvasFileSystem } from '../canvas/canvasFiles.js';
import { CompileCancelledError } from '../canvas/compiler.js';
import type { WriteFilesInput, CreateFramesInput } from '../canvas/protocol.js';
import {
  canvasManifestSchema,
  mutationFingerprint,
  CANVAS_MUTATION_RETENTION,
  emptyCanvasManifest,
  type CanvasManifest,
  type PersistedDesign,
  type PersistedMutation,
} from '../canvas/canvasManifest.js';

const designSystem = { id: 'droidex', version: 1, mode: 'light' } as const;

/** A valid 1x1 PNG, and the asset ID the content-addressed store gives it. */
export const CANVAS_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
  'base64',
);
export const CANVAS_PNG_ASSET_ID = createHash('sha256').update(CANVAS_PNG).digest('hex');

export function scopeFor(
  canvasId: string | null,
  allowedDesignIds: string[] | 'canvas' = 'canvas',
  scopeId = 'scope-1',
): CanvasScope {
  return {
    origin: 'turn',
    scopeId,
    appSessionId: 'app-1',
    generation: 1,
    canvasId,
    context: { designs: [], elements: [], designSystem },
    allowedDesignIds,
  };
}

interface WorkspaceOptions {
  fs?: CanvasFileSystem;
  isScopeActive?: (scopeId: string) => boolean;
  bindScopeCanvas?: (scopeId: string, canvasId: string) => void;
}

export async function openWorkspace(t: TestContext, options: WorkspaceOptions = {}) {
  const root = await canvasRoot(t);
  const boundCanvasIds: string[] = [];
  const deps: CanvasWorkspaceDeps = {
    isScopeActive: options.isScopeActive ?? (() => true),
    bindScopeCanvas: (scopeId, canvasId) => {
      if (options.bindScopeCanvas) options.bindScopeCanvas(scopeId, canvasId);
      boundCanvasIds.push(canvasId);
    },
    fs: options.fs,
  };
  const workspace = await CanvasWorkspace.open(root, quietBuilds(), deps);
  t.after(() => workspace.close());
  return { root, deps, workspace, boundCanvasIds };
}

/** One canvas holding one reserved 720×720 frame named Hey. */
export async function withFrame(t: TestContext, options: WorkspaceOptions = {}) {
  const context = await openWorkspace(t, options);
  const { canvasId } = await context.workspace.createCanvas('app-1');
  const scope = scopeFor(canvasId);
  const created = await context.workspace.create(scope, {
    mutationId: 'create-hey',
    frames: [{ name: 'Hey', width: 720, height: 720, designSystem }],
  });
  const frame = created.frames[0];
  assert.ok(frame);
  assert.deepEqual(frame.rect, { x: 0, y: 0, width: 720, height: 720 });
  assert.equal(frame.layoutVersion, 0);
  assert.equal(frame.revisionId, null);
  return { ...context, canvasId, scope, designId: frame.designId };
}

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

export function writeInput(
  mutationId: string,
  designId: string,
  expectedRevisionId: string | null,
  files: Record<string, string>,
  deletedPaths: string[] = [],
): WriteFilesInput {
  return { mutationId, designId, expectedRevisionId, files, deletedPaths };
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

/** Fails one manifest save before its rename or on the flush just after it. */
export function terminateAtManifestRename(side: 'before' | 'after') {
  let armed = false;
  let renamed = false;
  const failed = deferred();
  const fail = (): never => {
    armed = false;
    failed.resolve();
    throw new Error('power lost');
  };
  const fs = observedFileSystem((operation, path) => {
    if (!armed) return;
    if (operation === 'rename' && path.endsWith('manifest.json')) {
      if (side === 'before') fail();
      renamed = true;
      return;
    }
    if (side === 'after' && renamed && operation === 'open') {
      renamed = false;
      fail();
    }
  });
  return {
    fs,
    arm: () => {
      armed = true;
    },
    failed: failed.promise,
  };
}

/** Holds a manifest write before publication or before its final directory flush. */
export function holdManifestWrite(stage: 'prepared' | 'published') {
  let armed = false;
  let renamed = false;
  const reached = deferred();
  const released = deferred();
  const hold = async (): Promise<void> => {
    armed = false;
    reached.resolve();
    await released.promise;
  };
  const fs = observedFileSystem(async (operation, path) => {
    if (!armed) return;
    if (operation === 'rename' && path.endsWith('manifest.json')) {
      renamed = true;
      return;
    }
    if (operation !== 'open') return;
    if (stage === 'prepared' && path.endsWith('.tmp')) await hold();
    if (stage === 'published' && renamed) await hold();
  });
  return {
    fs,
    arm: () => {
      armed = true;
    },
    reached: reached.promise,
    release: released.resolve,
  };
}

/** Makes the next manifest visible, but refuses every subsequent directory flush. */
export function stopFlushingAfterManifestRename() {
  let armed = false;
  let renamed = false;
  const fs = observedFileSystem((operation, path) => {
    if (!armed) return;
    if (operation === 'rename' && path.endsWith('manifest.json')) {
      renamed = true;
      return;
    }
    if (renamed && operation === 'open' && !basename(path).includes('.'))
      throw new Error('the volume stopped flushing');
  });
  return {
    fs,
    arm: () => {
      armed = true;
    },
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

export async function reopenWorkspace(t: TestContext, root: string, deps: CanvasWorkspaceDeps) {
  const workspace = await CanvasWorkspace.open(root, quietBuilds(), deps);
  t.after(() => workspace.close());
  return workspace;
}

/** The one 720x720 frame named Hey that most create cases reserve. */
export function createInput(mutationId: string): CreateFramesInput {
  return { mutationId, frames: [{ name: 'Hey', width: 720, height: 720, designSystem }] };
}

/** A full ledger whose receipts still belong to a live lease. */
export async function workspaceAtReceiptCapacity(t: TestContext) {
  const root = await canvasRoot(t);
  const canvasId = 'cv_full';
  const design = {
    designId: 'dsg_hey',
    name: 'Hey',
    rect: { x: 0, y: 0, width: 720, height: 720 },
    layoutVersion: 0,
    manifestVersion: 0,
    revisionId: null,
    lastWorkingRevisionId: null,
    designSystem,
  };
  const input = createInput('create-hey');
  const files = new CanvasFiles(root);
  await files.createRoot();
  await files.writeManifest(
    ledgerAtCapacity(canvasId, 'app-1', design, {
      kind: 'create',
      mutationId: input.mutationId,
      scopeId: 'scope-1',
      fingerprint: mutationFingerprint(input),
      designs: [design],
    }),
    () => undefined,
  );
  const workspace = await CanvasWorkspace.open(root, quietBuilds(), {
    isScopeActive: () => true,
    bindScopeCanvas: () => undefined,
  });
  t.after(() => workspace.close());
  const scope = scopeFor(canvasId);

  return { workspace, canvasId, design, input, scope };
}

/** Holds only manifest staging, after artifact and outcome storage have completed. */
export function holdBuildManifest() {
  const reached = deferred();
  const released = deferred();
  let armed = false;
  const fs = observedFileSystem(async (operation, path) => {
    if (!armed || operation !== 'open' || !path.includes('/manifest.json.')) return;
    armed = false;
    reached.resolve();
    await released.promise;
  });
  return {
    fs,
    reached: reached.promise,
    release: released.resolve,
    arm: () => {
      armed = true;
    },
  };
}
