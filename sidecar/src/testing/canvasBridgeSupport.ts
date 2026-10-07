import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import type { ServerEvent } from '../protocol.js';
import { CanvasBuilds } from '../canvas/CanvasBuilds.js';
import { createCanvasCommandHandler } from '../canvas/canvasBridge.js';
import type { CanvasFileSystem } from '../canvas/canvasFiles.js';
import { CanvasScopes } from '../canvas/canvasScopes.js';
import { CanvasTurns } from '../canvas/canvasTurnContext.js';
import { CanvasWorkspace } from '../canvas/CanvasWorkspace.js';
import type { CanvasEvent, CanvasReply } from '../canvas/protocol.js';
import { CompilerFleet, fakeDeadlines } from './canvasBuildSupport.js';
import { canvasRoot, quietBuilds } from './canvasStorageSupport.js';

export const designSystem = { id: 'droidex', version: 1, mode: 'light' } as const;
export const APP = 'app-1';
export const PAGE = 'page-1';
export const HEY = 'export default function Hey(){return <h1>Hey</h1>}';

interface Harness {
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
  const listeners = new Set<(pageId: string) => void>();
  const handle = createCanvasCommandHandler(
    Promise.resolve(workspace),
    scopes,
    builds,
    (event) => {
      events.push(event);
    },
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  );
  return {
    root: directory,
    workspace,
    scopes,
    builds,
    events,
    handle: (command, pageId = PAGE) => handle(command, pageId),
    pageGone: (pageId) => {
      for (const listener of listeners) listener(pageId);
    },
  };
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

export function errorOf(harnessed: Harness, requestId: string): { code: string; message: string } {
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
