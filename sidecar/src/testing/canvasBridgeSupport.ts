import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import type { ServerEvent } from '../protocol.js';
import { CompileCancelledError } from '../canvas/compiler.js';
import { CanvasBuilds } from '../canvas/CanvasBuilds.js';
import { listCanvasAssets } from '../canvas/canvasAssets.js';
import { createCanvasCommandHandler } from '../canvas/canvasBridge.js';
import type { CanvasFileSystem } from '../canvas/canvasFiles.js';
import { CanvasScopes } from '../canvas/canvasScopes.js';
import { CanvasTurns } from '../canvas/canvasTurnContext.js';
import { CanvasWorkspace } from '../canvas/CanvasWorkspace.js';
import type {
  CanvasEvent,
  CanvasReply,
  CanvasError,
  CanvasScope,
  ElementRef,
} from '../canvas/protocol.js';
import { CompilerFleet, fakeDeadlines } from './canvasBuildSupport.js';
import {
  canvasRoot,
  quietBuilds,
  deferred,
  observedFileSystem,
  writeInput,
} from './canvasStorageSupport.js';

export const designSystem = { id: 'droidex', version: 1, mode: 'light' } as const;
export const APP = 'app-1';
export const PAGE = 'page-1';
export const EDITABLE =
  'export default function Hey(){return <h1 style={{color:"var(--ds-fg)"}}>Hey</h1>}';
export const HEY = 'export default function Hey(){return <h1>Hey</h1>}';

/** The asset secret the Canvas suites sign their preview URLs with. */
export const ASSET_SECRET = 'test-canvas-secret';

/**
 * One bridge handler over a workspace, collecting the events it emits. Owned
 * assets are read from the real store under `root`, so a listing reply is the
 * store's answer rather than a fixture's.
 */
export function canvasCommandHandler(options: {
  ready: Promise<CanvasWorkspace>;
  scopes: CanvasScopes;
  builds: CanvasBuilds;
  events: ServerEvent[];
  root: string;
}) {
  const listeners = new Set<(pageId: string) => void>();
  const handle = createCanvasCommandHandler(
    options.ready,
    options.scopes,
    options.builds,
    {
      secret: ASSET_SECRET,
      list: (canvasId) => listCanvasAssets(options.root, canvasId),
    },
    (event) => {
      options.events.push(event);
    },
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  );
  return {
    listeners,
    handle: (command: unknown, pageId: string | null = PAGE) => handle(command, pageId),
    /** Reports a renderer page's socket closing, the way the bridge server does. */
    pageGone: (pageId: string) => {
      for (const listener of listeners) listener(pageId);
    },
  };
}

export interface Harness {
  root: string;
  workspace: CanvasWorkspace;
  scopes: CanvasScopes;
  builds: CanvasBuilds;
  events: ServerEvent[];
  handle: (command: unknown, pageId?: string | null) => Promise<boolean>;
  /** Reports a renderer page's socket closing, the way the bridge server does. */
  pageGone: (pageId: string) => void;
}

export async function harness(
  t: TestContext,
  options: { root?: string; fs?: CanvasFileSystem; builds?: CanvasBuilds } = {},
): Promise<Harness> {
  const builds = options.builds ?? quietBuilds();
  let workspace: CanvasWorkspace | undefined = undefined;
  t.after(async () => {
    await builds.close();
    await workspace?.close();
  });
  const directory = options.root ?? (await canvasRoot(t));
  const scopes = new CanvasScopes();
  const events: ServerEvent[] = [];
  workspace = await CanvasWorkspace.open(directory, builds, {
    isScopeActive: (scopeId) => scopes.isScopeActive(scopeId),
    bindScopeCanvas: (scopeId, canvasId) => {
      scopes.bindScopeCanvas(scopeId, canvasId);
    },
    ...(options.fs ? { fs: options.fs } : {}),
  });
  const { handle, pageGone } = canvasCommandHandler({
    ready: Promise.resolve(workspace),
    scopes,
    builds,
    events,
    root: directory,
  });
  return { root: directory, workspace, scopes, builds, events, handle, pageGone };
}

export async function buildingCanvas(t: TestContext, fs?: CanvasFileSystem) {
  const fleet = new CompilerFleet();
  const builds = new CanvasBuilds({ compiler: fleet.client, deadline: fakeDeadlines().deadline });
  const canvas = await harness(t, { builds, fs });
  const turns = new CanvasTurns(canvas.scopes, (id) => canvas.workspace.attachedCanvasId(id));
  return { ...canvas, fleet, turns };
}

export function readyFrames(canvas: Harness, canvasId: string, designIds: string[]): Promise<void> {
  return new Promise((resolve) => {
    const stop = canvas.workspace.changes.subscribe(() => {
      if (!designIds.every((id) => canvas.builds.stateOf(canvasId, id).status === 'ready')) return;
      stop();
      resolve();
    });
  });
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
    await harnessed.handle({ type: 'canvas.createCanvas', requestId, appSessionId: APP }),
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
  appSessionId = APP,
): Promise<string> {
  await harnessed.handle({
    type: 'canvas.create',
    requestId,
    appSessionId,
    canvasId,
    input: {
      mutationId: requestId,
      frames: [{ name: 'Hey', width: 720, height: 720, designSystem }],
    },
  });
  const reply = okReply(harnessed, requestId);
  assert.ok(reply.kind === 'created');
  const [frame] = reply.created.frames;
  assert.ok(frame);
  return frame.designId;
}

export async function writeFrame(
  canvas: Harness,
  canvasId: string,
  designId: string,
  appSessionId = APP,
): Promise<void> {
  const requestId = `req-write-${designId}`;
  await canvas.handle({
    type: 'canvas.write',
    requestId,
    appSessionId,
    canvasId,
    input: {
      mutationId: `write-${designId}`,
      designId,
      expectedRevisionId: null,
      files: { 'main.tsx': HEY },
      deletedPaths: [],
    },
  });
  assert.equal(okReply(canvas, requestId).kind, 'written');
}

export async function frameHarness(t: TestContext, options: Parameters<typeof harness>[1] = {}) {
  const canvas = await harness(t, options);
  const canvasId = await createCanvas(canvas);
  const designId = await createFrame(canvas, canvasId);
  return { canvas, canvasId, designId };
}

export function turnScope(canvasId: string, scopeId: string): CanvasScope {
  return {
    origin: 'turn',
    scopeId,
    appSessionId: 'agent-1',
    generation: 1,
    canvasId,
    context: { designs: [], elements: [], designSystem },
    allowedDesignIds: 'canvas',
  };
}

export async function editableElement(
  t: TestContext,
): Promise<{ canvas: Harness; canvasId: string; element: ElementRef }> {
  const builds = new CanvasBuilds({ deadline: fakeDeadlines().deadline });
  t.after(() => builds.close());
  const { canvas, canvasId, designId } = await frameHarness(t, { builds });
  const ready = new Promise<void>((resolve, reject) => {
    const unsubscribe = canvas.workspace.changes.subscribe((change) => {
      const build = change.frames.find((frame) => frame.designId === designId)?.build;
      if (!build || build.status === 'pending' || build.status === 'building') return;
      unsubscribe();
      if (build.status === 'ready') resolve();
      else reject(new Error(`initial build ended as ${build.status}`));
    });
  });
  await canvas.handle({
    type: 'canvas.write',
    requestId: 'req-edit-source',
    appSessionId: APP,
    canvasId,
    input: writeInput('m-edit-source', designId, null, { 'main.tsx': EDITABLE }),
  });
  const written = okReply(canvas, 'req-edit-source');
  assert.ok(written.kind === 'written');
  await ready;
  const build = builds.stateOf(canvasId, designId);
  assert.ok(build.status === 'ready');
  const [site] = build.elements;
  assert.ok(site);
  const element: ElementRef = {
    designId,
    revisionId: written.receipt.revisionId,
    elementId: site.elementId,
    instancePath: '0',
  };
  return { canvas, canvasId, element };
}

export function pauseAtSource(path: string) {
  const reached = deferred();
  const release = deferred();
  let armed = true;
  return {
    reached: reached.promise,
    release: release.resolve,
    fs: observedFileSystem(async (operation, target) => {
      if (!armed || operation !== 'open' || !target.endsWith(path)) return;
      armed = false;
      reached.resolve();
      await release.promise;
    }),
  };
}

export function holdArtifactRead() {
  const reached = deferred();
  const released = deferred();
  let armed = false;
  return {
    arm: () => {
      armed = true;
    },
    reached: reached.promise,
    release: released.resolve,
    fs: observedFileSystem(async (operation, path) => {
      if (!armed || operation !== 'open' || !path.endsWith('/artifact-one.html')) return;
      armed = false;
      reached.resolve();
      await released.promise;
      throw Object.assign(new Error('derived artifact disappeared'), { code: 'ENOENT' });
    }),
  };
}

export async function pendingWorkspaceHandler(t: TestContext) {
  // A compiler that only answers an abort, so a started build stays started.
  const builds = new CanvasBuilds({
    compiler: () => ({
      compile: (_input, signal) =>
        new Promise<never>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              reject(new CompileCancelledError());
            },
            {
              once: true,
            },
          );
        }),
      terminate: () => Promise.resolve(),
    }),
    deadline: () => () => undefined,
  });
  const canvas = await harness(t, { builds });
  const canvasId = await createCanvas(canvas);
  const designId = await createFrame(canvas, canvasId);
  await canvas.handle({
    type: 'canvas.write',
    requestId: 'req-write-source',
    appSessionId: APP,
    canvasId,
    input: {
      mutationId: 'm-write-source',
      designId,
      expectedRevisionId: null,
      files: { 'main.tsx': HEY },
      deletedPaths: [],
    },
  });
  // Cancelled leaves saved source with nothing built for it, which is what a
  // subscription's rebuild sweep picks up.
  builds.cancelCanvas(canvasId);
  const opening = deferred();
  const events: ServerEvent[] = [];
  const { handle, listeners } = canvasCommandHandler({
    ready: opening.promise.then(() => canvas.workspace),
    scopes: canvas.scopes,
    builds: canvas.builds,
    events,
    root: canvas.root,
  });

  return { builds, canvas, canvasId, designId, events, listeners, handle, opening };
}

export async function activeTurnBuilds(t: TestContext) {
  const canvas = await buildingCanvas(t);
  const canvasId = await createCanvas(canvas);
  const turn = canvas.turns.beginTurn(APP, undefined);
  t.after(() => {
    turn.revoke();
  });
  const scope = canvas.turns.activeScope(APP);
  assert.ok(scope);
  const created = await canvas.workspace.create(scope, {
    mutationId: 'create-turn-frames',
    frames: ['One', 'Two', 'Three'].map((name) => ({
      name,
      width: 720,
      height: 720,
      designSystem,
    })),
  });
  const ids = created.frames.map((frame) => frame.designId);
  await canvas.handle({ type: 'canvas.subscribe', requestId: 'req-watch', canvasId });
  for (const designId of ids) {
    await canvas.workspace.write(scope, {
      mutationId: `turn-write-${designId}`,
      designId,
      expectedRevisionId: null,
      files: { 'main.tsx': HEY },
      deletedPaths: [],
    });
  }
  return { canvas, canvasId, scope, ids };
}

export async function watchedArtifact(t: TestContext, fs: CanvasFileSystem) {
  const canvas = await buildingCanvas(t, fs);
  const canvasId = await createCanvas(canvas);
  const designId = await createFrame(canvas, canvasId);
  await canvas.handle({ type: 'canvas.subscribe', requestId: 'req-watch', canvasId });
  await writeFrame(canvas, canvasId, designId);
  const ready = readyFrames(canvas, canvasId, [designId]);
  (await canvas.fleet.compile(1)).ready('artifact-one');
  await ready;
  const before = canvas.builds.stateOf(canvasId, designId);
  assert.ok(before.status === 'ready');
  return { canvas, canvasId, designId, before };
}
