// The Canvas MCP suite's harness: a real workspace and turn leases behind one
// chat's Canvas tools, a compiler that answers at once, and a stand-in pane that
// reports what each ready preview did.

import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { CanvasBuilds } from '../canvas/CanvasBuilds.js';
import type { CanvasCapture } from '../canvas/canvasCaptures.js';
import { canvasError } from '../canvas/canvasError.js';
import type { CanvasFileSystem } from '../canvas/canvasFiles.js';
import { createCanvasMcpServer } from '../canvas/canvasMcpServer.js';
import { CanvasScopes } from '../canvas/canvasScopes.js';
import { CanvasTurns } from '../canvas/canvasTurnContext.js';
import { CanvasWorkspace } from '../canvas/CanvasWorkspace.js';
import { CompileFailedError, type CompileInput } from '../canvas/compiler.js';
import { checkDesignSystemAdherence } from '../canvas/designSystemAdherence.js';
import { readDesignSystem } from '../canvas/designSystems.js';
import { storage } from './canvasBuildSupport.js';

/** No renderer page answers a screenshot here, so capture is always refused. */
export const noRenderer: CanvasCapture = () =>
  Promise.reject(canvasError('capture_unavailable', 'No renderer page answers in this suite.'));

export interface Reply {
  ok: boolean;
  code?: string;
  message?: string;
  scopeId?: string;
  pinned?: { designs: { designId: string }[] };
  created?: { canvasId: string; frames: { designId: string; revisionId: string | null }[] };
  receipt?: { revisionId: string };
  frames?: { designId: string }[];
  systems?: { id: string; version: number }[];
  designSystem?: { primitives: string[] };
  designSystemAdherence?: string;
  build?: {
    status: string;
    diagnostics?: { file?: string; line?: number }[];
    errors?: string[];
    rendered?: boolean;
    designSystem?: { diagnostics: { code: string }[]; next: string };
    next?: string;
  };
}

export async function harness(t: TestContext, fs?: CanvasFileSystem, capture?: CanvasCapture) {
  const scopes = new CanvasScopes();
  const turns = new CanvasTurns(scopes, (id) => workspace.attachedCanvasId(id));
  const store = await storage(t);
  const builds = answeringBuilds();
  const workspace = await CanvasWorkspace.open(store.root, builds, {
    fs,
    isChatKnown: () => true,
    isScopeActive: (id) => scopes.isScopeActive(id),
    bindScopeCanvas: (id, canvasId) => {
      scopes.bindScopeCanvas(id, canvasId);
    },
  });
  store.closing.push(async () => {
    await builds.close();
    await workspace.close();
  });
  // The open pane: it starts a preview of every build that lands and, a turn of
  // the event loop later, says what the design did.
  workspace.changes.subscribe((change) => {
    for (const { designId, build } of change.frames) {
      if (build.status !== 'ready') continue;
      const ran = { designId, revisionId: build.revisionId };
      workspace.previews.record(change.canvasId, { ...ran, outcome: 'loading', errors: [] });
      const throws = build.artifactId.startsWith('throws');
      setImmediate(() => {
        workspace.previews.record(change.canvasId, {
          ...ran,
          outcome: throws ? 'failed' : 'rendered',
          errors: throws ? ['total is not defined'] : [],
        });
      });
    }
  });
  const server = createCanvasMcpServer(
    () => Promise.resolve(workspace),
    turns,
    capture ?? noRenderer,
    () => 'chat-one',
  );
  const call = async (name: string, input: Record<string, unknown>): Promise<Reply> => {
    const target = server.tools.find((entry) => entry.name === name);
    assert.ok(target, name);
    const [content] = toolContent(await target.handler(input));
    assert.equal(content.type, 'text');
    return JSON.parse(content.text ?? '') as Reply;
  };
  return { scopes, turns, workspace, server, call };
}

/** A harness whose chat is in a turn that opened with canvas_read, as every turn does. */
export async function openTurn(t: TestContext) {
  const h = await harness(t);
  h.turns.beginTurn('chat-one', undefined);
  return { ...h, scopeId: (await h.call('canvas_read', {})).scopeId };
}

/**
 * A compiler that answers at once, because canvas_write waits for its build:
 * every design builds under the real kit rule, except one whose main.tsx names
 * `BROKEN`. One that names `THROWS` builds an artifact the stand-in pane below
 * cannot render.
 */
function answeringBuilds(): CanvasBuilds {
  const compile = async (input: CompileInput) => {
    const main = input.files['main.tsx'] ?? '';
    if (main.includes('BROKEN'))
      throw new CompileFailedError([
        { code: 'syntax_error', message: 'Unexpected token', file: 'main.tsx', line: 3 },
      ]);
    const system = await readDesignSystem(input.designSystem);
    const kit = checkDesignSystemAdherence(input.files, system, input.designSystemAdherence);
    if (kit.status === 'failed') throw new CompileFailedError(kit.diagnostics);
    const artifactId = `${main.includes('THROWS') ? 'throws' : 'renders'}-${input.revisionId}`;
    return { artifactId, html: '<html></html>', diagnostics: kit.diagnostics, elements: [] };
  };
  return new CanvasBuilds({
    compiler: () => ({ compile, terminate: () => Promise.resolve() }),
    deadline: () => () => undefined,
  });
}

export function toolContent(result: unknown): { type: string; text?: string }[] {
  if (typeof result === 'string') return [{ type: 'text', text: result }];
  assert.ok(result && typeof result === 'object' && 'content' in result);
  return result.content as { type: string; text?: string }[];
}
