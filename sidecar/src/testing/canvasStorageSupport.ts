// Shared setup for the Canvas storage suites: a real scratch root, the bridge
// handler over one workspace, and the filesystem seam wrapped with one hook so
// a test can pause or fail exactly the call it cares about.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import type { ServerEvent } from '../protocol.js';
import { CanvasBuilds } from '../canvas/CanvasBuilds.js';
import { listCanvasAssets } from '../canvas/canvasAssets.js';
import { createCanvasCommandHandler } from '../canvas/canvasBridge.js';
import { nodeCanvasFileSystem, type CanvasFileSystem } from '../canvas/canvasFiles.js';
import { CanvasScopes } from '../canvas/canvasScopes.js';
import { CanvasWorkspace } from '../canvas/CanvasWorkspace.js';
import { CompileCancelledError } from '../canvas/compiler.js';
import type { CanvasError, CanvasEvent, CanvasReply, WriteFilesInput } from '../canvas/protocol.js';
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

/** A valid 1x1 PNG, and the asset ID the content-addressed store gives it. */
export const CANVAS_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
  'base64',
);
export const CANVAS_PNG_ASSET_ID = createHash('sha256').update(CANVAS_PNG).digest('hex');

/** The asset secret the storage suites sign their preview URLs with. */
export const TEST_CANVAS_ASSET_SECRET = 'test-canvas-secret';

/** The renderer page a storage suite's commands arrive from by default. */
export const TEST_PAGE = 'page-1';

export interface CanvasCommandHandler {
  /** Dispatches one command, from `TEST_PAGE` unless another page is named. */
  handle: (command: unknown, pageId?: string | null) => Promise<boolean>;
  /** Reports a renderer page's socket closing, the way the bridge server does. */
  pageGone: (pageId: string) => void;
}

/**
 * The bridge handler over one workspace, collecting the events it emits.
 * Assets are read from the real store under `root`; without one the handler
 * answers `canvas.listAssets` as an empty canvas.
 */
export function canvasCommandHandler(options: {
  ready: Promise<CanvasWorkspace>;
  scopes: CanvasScopes;
  builds: CanvasBuilds;
  events: ServerEvent[];
  root?: string;
}): CanvasCommandHandler {
  const listeners = new Set<(pageId: string) => void>();
  const { root } = options;
  const handle = createCanvasCommandHandler(
    options.ready,
    options.scopes,
    options.builds,
    {
      secret: TEST_CANVAS_ASSET_SECRET,
      list: (canvasId) =>
        root === undefined ? Promise.resolve([]) : listCanvasAssets(root, canvasId),
    },
    (event) => options.events.push(event),
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  );
  return {
    handle: (command, pageId = TEST_PAGE) => handle(command, pageId),
    pageGone: (pageId) => {
      for (const listener of listeners) listener(pageId);
    },
  };
}

/** The chat and the renderer page a Canvas bridge suite's commands come from. */
export const TEST_APP_SESSION = 'app-1';
/** One design system every fixture frame is created with. */
export const TEST_DESIGN_SYSTEM = { id: 'droidex', version: 1, mode: 'light' } as const;
/** The trivial design a fixture frame's source starts as. */
export const TEST_DESIGN_SOURCE = 'export default function Hey(){return <h1>Hey</h1>}';

export interface Harness extends CanvasCommandHandler {
  root: string;
  workspace: CanvasWorkspace;
  scopes: CanvasScopes;
  builds: CanvasBuilds;
  events: ServerEvent[];
}

export async function harness(
  t: TestContext,
  options: { root?: string; fs?: CanvasFileSystem; builds?: CanvasBuilds } = {},
): Promise<Harness> {
  const directory = options.root ?? (await canvasRoot(t));
  const scopes = new CanvasScopes();
  const events: ServerEvent[] = [];
  const builds = options.builds ?? quietBuilds();
  const workspace = await CanvasWorkspace.open(directory, builds, {
    isScopeActive: (scopeId) => scopes.isScopeActive(scopeId),
    bindScopeCanvas: (scopeId, canvasId) => {
      scopes.bindScopeCanvas(scopeId, canvasId);
    },
    fs: options.fs,
  });
  t.after(() => workspace.close());
  return {
    root: directory,
    workspace,
    scopes,
    builds,
    events,
    ...canvasCommandHandler({
      ready: Promise.resolve(workspace),
      scopes,
      builds,
      events,
      root: directory,
    }),
  };
}

/** The event answering one request, which every command produces exactly one of. */
export function answer(harnessed: Harness, requestId: string): CanvasEvent {
  const matched = harnessed.events.filter(
    (event): event is CanvasEvent =>
      (event.type === 'canvas.result' || event.type === 'canvas.snapshot') &&
      event.requestId === requestId,
  );
  assert.equal(matched.length, 1, `expected one answer for ${requestId}`);
  const [only] = matched;
  assert.ok(only);
  return only;
}

export function okReply(harnessed: Harness, requestId: string): CanvasReply {
  const event = answer(harnessed, requestId);
  assert.ok(event.type === 'canvas.result' && event.ok, `expected ${requestId} to succeed`);
  return event.reply;
}

export function errorOf(harnessed: Harness, requestId: string): CanvasError {
  const event = answer(harnessed, requestId);
  assert.ok(event.type === 'canvas.result' && !event.ok, `expected ${requestId} to fail`);
  return event.error;
}

/** Creates the chat's canvas the way the pane's Create button does. */
export async function createCanvas(
  harnessed: Harness,
  requestId = 'req-create-canvas',
): Promise<string> {
  assert.equal(
    await harnessed.handle({
      type: 'canvas.createCanvas',
      requestId,
      appSessionId: TEST_APP_SESSION,
    }),
    true,
  );
  const reply = okReply(harnessed, requestId);
  assert.ok(reply.kind === 'attachment' && reply.canvasId !== null);
  return reply.canvasId;
}

export async function createFrame(
  harnessed: Harness,
  canvasId: string,
  requestId = 'req-create-frame',
): Promise<string> {
  await harnessed.handle({
    type: 'canvas.create',
    requestId,
    appSessionId: TEST_APP_SESSION,
    canvasId,
    input: {
      mutationId: 'm-create',
      frames: [{ name: 'Hey', width: 720, height: 720, designSystem: TEST_DESIGN_SYSTEM }],
    },
  });
  const reply = okReply(harnessed, requestId);
  assert.ok(reply.kind === 'created');
  const [frame] = reply.created.frames;
  assert.ok(frame);
  return frame.designId;
}

export async function frameHarness(t: TestContext, options: Parameters<typeof harness>[1] = {}) {
  const canvas = await harness(t, options);
  const canvasId = await createCanvas(canvas);
  const designId = await createFrame(canvas, canvasId);
  return { canvas, canvasId, designId };
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
