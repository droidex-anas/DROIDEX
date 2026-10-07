import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import {
  canvasRoot,
  deferred,
  observedFileSystem,
  quietBuilds,
} from '../testing/canvasStorageSupport.js';
import { CanvasWorkspace } from './CanvasWorkspace.js';
import { CANVAS_MCP_SERVER_NAME, createCanvasMcpServer } from './canvasMcpServer.js';
import { CanvasScopes } from './canvasScopes.js';
import { CanvasTurns } from './canvasTurnContext.js';
import { DEFAULT_DESIGN_SYSTEM_REF } from './designSystems.js';
import type { CanvasFileSystem } from './canvasFiles.js';

type Reply = {
  ok: boolean;
  code?: string;
  scopeId?: string;
  pinned?: { designs: { designId: string }[] };
  created?: { canvasId: string; frames: { designId: string; revisionId: string | null }[] };
  receipt?: { revisionId: string };
  frames?: { designId: string }[];
  systems?: { id: string; version: number }[];
  build?: unknown;
};

async function harness(t: TestContext, fs?: CanvasFileSystem) {
  const scopes = new CanvasScopes();
  const turns = new CanvasTurns(scopes, (id) => workspace.attachedCanvasId(id));
  const workspace = await CanvasWorkspace.open(await canvasRoot(t), quietBuilds(), {
    fs,
    isScopeActive: (id) => scopes.isScopeActive(id),
    bindScopeCanvas: (id, canvasId) => scopes.bindScopeCanvas(id, canvasId),
  });
  t.after(() => workspace.close());
  const server = createCanvasMcpServer(
    () => Promise.resolve(workspace),
    turns,
    () => 'chat-one',
  );
  const call = async (name: string, input: Record<string, unknown>): Promise<Reply> => {
    const target = server.tools.find((entry) => entry.name === name);
    assert.ok(target, name);
    const result = await target.handler(input);
    if (typeof result === 'string') return JSON.parse(result) as Reply;
    const content = result.content[0];
    assert.equal(content?.type, 'text');
    if (content?.type !== 'text') throw new Error('Canvas tools must answer with text.');
    return JSON.parse(content.text) as Reply;
  };
  return { scopes, turns, workspace, server, call };
}

const frame = { name: 'Hey', width: 720, height: 520, designSystem: DEFAULT_DESIGN_SYSTEM_REF };

test('six Canvas tools are discoverable and an inactive chat cannot read', async (t) => {
  const h = await harness(t);
  assert.equal(h.server.name, CANVAS_MCP_SERVER_NAME);
  assert.deepEqual(
    h.server.tools.map((entry) => entry.name),
    [
      'canvas_read',
      'canvas_create',
      'canvas_write',
      'canvas_inspect',
      'canvas_arrange',
      'canvas_theme',
    ],
  );
  assert.equal((await h.call('canvas_read', {})).code, 'scope_expired');
});

test('theme listing is bounded and saving requires a client mutation ID', async (t) => {
  const h = await harness(t);
  h.turns.beginTurn('chat-one', undefined);
  assert.equal((await h.call('canvas_read', { unknown: 'secret' })).code, 'invalid_input');
  const listed = await h.call('canvas_theme', { operation: 'list', limit: 1 });
  assert.equal(listed.ok, true);
  assert.equal(listed.systems?.length, 1);
  assert.equal(
    (await h.call('canvas_theme', { operation: 'save', system: {} })).code,
    'invalid_input',
  );
});

test('read binds the newest steer, an earlier named lease stays pinned, and another chat cannot borrow it', async (t) => {
  const h = await harness(t);
  const first = h.turns.beginTurn('chat-one', {
    designs: [{ designId: 'first', revisionId: null }],
    elements: [],
    designSystem: DEFAULT_DESIGN_SYSTEM_REF,
  });
  const oldId = (await h.call('canvas_read', {})).scopeId;
  first.addSteer({
    designs: [{ designId: 'steered', revisionId: null }],
    elements: [],
    designSystem: DEFAULT_DESIGN_SYSTEM_REF,
  });
  assert.deepEqual(
    (await h.call('canvas_read', {})).pinned?.designs.map((ref) => ref.designId),
    ['steered'],
  );
  assert.deepEqual(
    (await h.call('canvas_read', { scopeId: oldId })).pinned?.designs.map((ref) => ref.designId),
    ['first'],
  );

  const other = h.turns.beginTurn('child-chat', undefined);
  const childId = h.turns.activeScope('child-chat')?.scopeId;
  assert.equal((await h.call('canvas_read', { scopeId: childId })).code, 'scope_expired');
  other.revoke();
  first.revoke();
  assert.equal((await h.call('canvas_read', { scopeId: oldId })).code, 'scope_expired');
});

test('a frame-scoped turn cannot inspect another frame on the same canvas', async (t) => {
  const h = await harness(t);
  const wholeCanvas = h.turns.beginTurn('chat-one', undefined);
  const created = await h.call('canvas_create', {
    mutationId: 'create-pair',
    frames: [frame, { ...frame, name: 'Other' }],
  });
  assert.ok(created.created);
  const [allowed, other] = created.created.frames;
  wholeCanvas.revoke();
  const scoped = h.turns.beginTurn('chat-one', {
    designs: [{ designId: allowed.designId, revisionId: null }],
    elements: [],
    designSystem: DEFAULT_DESIGN_SYSTEM_REF,
  });
  const summary = await h.call('canvas_read', {});
  assert.equal(summary.ok, true);
  assert.deepEqual(
    summary.frames?.map((item) => item.designId),
    [allowed.designId],
  );
  assert.equal(
    (
      await h.call('canvas_read', {
        view: 'design',
        designId: other.designId,
        revisionId: 'revision',
      })
    ).code,
    'scope_expired',
  );
  assert.equal(
    (await h.call('canvas_inspect', { designId: other.designId })).code,
    'scope_expired',
  );
  scoped.revoke();
});

test('lost create response retries to the same canvas and invalid source paths have a stable refusal code', async (t) => {
  const h = await harness(t);
  h.turns.beginTurn('chat-one', undefined);
  const input = { mutationId: 'create-one', frames: [frame] };
  const first = await h.call('canvas_create', input);
  const retry = await h.call('canvas_create', input);
  assert.equal(first.ok, true);
  assert.deepEqual(retry.created, first.created);
  assert.equal(h.workspace.listCanvases().length, 1);
  const designId = first.created?.frames[0].designId;
  assert.ok(designId);
  const invalid = await h.call('canvas_write', {
    mutationId: 'bad-path',
    designId,
    expectedRevisionId: null,
    files: { '../escape.tsx': 'bad' },
    deletedPaths: [],
  });
  assert.equal(invalid.code, 'invalid_source_path');
  const written = await h.call('canvas_write', {
    mutationId: 'write-one',
    designId,
    expectedRevisionId: null,
    files: { 'main.tsx': 'export default function Hey(){return <h1>Hey</h1>}' },
    deletedPaths: [],
  });
  assert.equal(written.ok, true);
  assert.ok(written.receipt?.revisionId);
  assert.equal((await h.call('canvas_inspect', { designId })).ok, true);
  assert.equal(
    (await h.call('canvas_inspect', { designId, kind: 'screenshot' })).code,
    'capture_unavailable',
  );
  assert.equal(
    (
      await h.call('canvas_write', {
        mutationId: 'conflict',
        designId,
        expectedRevisionId: null,
        files: {},
        deletedPaths: [],
      })
    ).code,
    'revision_conflict',
  );
});

test('provider replacement while a write is staged refuses its old lease and leaves the head unchanged', async (t) => {
  const reached = deferred();
  const release = deferred();
  let hold = false;
  const fs = observedFileSystem(async (operation, path) => {
    if (hold && operation === 'open' && path.includes('/manifest.json.') && path.endsWith('.tmp')) {
      hold = false;
      reached.resolve();
      await release.promise;
    }
  });
  const h = await harness(t, fs);
  h.turns.beginTurn('chat-one', undefined);
  const created = await h.call('canvas_create', { mutationId: 'create-one', frames: [frame] });
  assert.ok(created.created);
  const designId = created.created?.frames[0].designId;
  assert.ok(designId);
  hold = true;
  const pending = h.call('canvas_write', {
    mutationId: 'write-stale',
    designId,
    expectedRevisionId: null,
    files: { 'main.tsx': 'export default function Hey(){return <h1>Hey</h1>}' },
    deletedPaths: [],
  });
  await reached.promise;
  h.turns.endSession('chat-one');
  h.turns.beginTurn('chat-one', undefined);
  release.resolve();
  assert.equal((await pending).code, 'scope_expired');
  assert.equal(h.workspace.snapshot(created.created.canvasId).frames[0].revisionId, null);
});
