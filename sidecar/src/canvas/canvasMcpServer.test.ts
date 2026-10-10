import assert from 'node:assert/strict';
import test from 'node:test';
import {
  harness,
  noRenderer,
  openTurn,
  toolContent,
  type Reply,
} from '../testing/canvasMcpSupport.js';
import {
  CANVAS_PNG,
  deferred,
  observedFileSystem,
  holdManifestWrite,
} from '../testing/canvasStorageSupport.js';
import { createCanvasMcpServer } from './canvasMcpServer.js';
import { CANVAS_MCP_SERVER_NAME, CANVAS_TOOL_NAMES } from './canvasMcpNames.js';
import { DEFAULT_DESIGN_SYSTEM_REF, readDesignSystem } from './designSystems.js';
import {
  DESIGN_CANVAS_MCP_INSTRUCTIONS,
  DESIGN_SESSION_GUIDANCE,
} from './designSessionGuidance.js';

const frame = { name: 'Hey', width: 720, height: 520, designSystem: DEFAULT_DESIGN_SYSTEM_REF };

test('six Canvas tools are discoverable and an inactive chat cannot read', async (t) => {
  const h = await harness(t);
  assert.equal(h.server.name, CANVAS_MCP_SERVER_NAME);
  assert.deepEqual(
    h.server.tools.map((entry) => entry.name),
    [...CANVAS_TOOL_NAMES],
  );
  assert.equal((await h.call('canvas_read', {})).code, 'scope_expired');
});

test('MCP initialization carries tool discovery guidance only for a Design session', async (t) => {
  const h = await harness(t);
  for (const purpose of ['chat', 'design'] as const) {
    const server = createCanvasMcpServer(
      () => Promise.resolve(h.workspace),
      h.turns,
      noRenderer,
      () => 'chat-one',
      purpose,
    );
    t.after(() => server.close());
    const config = await server.start();
    assert.ok('url' in config);
    const response = await fetch(config.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'design-profile-test', version: '1' },
        },
      }),
    });
    const text = await response.text();
    const payload =
      text
        .split('\n')
        .find((line) => line.startsWith('data: '))
        ?.slice(6) ?? text;
    const result = JSON.parse(payload).result;
    assert.equal(
      result?.instructions,
      purpose === 'design' ? DESIGN_CANVAS_MCP_INSTRUCTIONS : undefined,
    );
    if (purpose === 'design') {
      assert.match(result.instructions, /complete working React\/TSX files/);
      assert.match(result.instructions, /Tailwind available; a plain HTML document is not a frame/);
      assert.equal(result.instructions.includes(DESIGN_SESSION_GUIDANCE), false);
    }
    const write = server.tools.find((entry) => entry.name === 'canvas_write');
    assert.ok(write);
    assert.ok(write.description);
    assert.match(write.description, /React\/TSX files/);
    assert.match(write.description, /Tailwind available; a plain HTML document is not a frame/);
  }
});

test('a fabricated read scope tells the model to obtain the active turn lease first', async (t) => {
  const h = await harness(t);
  h.turns.beginTurn('chat-one', undefined);
  const refused = await h.call('canvas_read', { scopeId: 'pricing-card-three-tiers' });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'invalid_input');
  assert.match(refused.message ?? '', /Call canvas_read with no arguments first/);

  const read = await h.call('canvas_read', {});
  assert.equal(read.ok, true);
  assert.ok(read.scopeId);
  // The opening read carries the pinned kit, so the agent can follow it unfetched.
  assert.equal(read.designSystem?.primitives.join(' '), 'Button Card Badge Input Tabs Dialog');
  assert.equal(read.scopeId, h.turns.activeScope('chat-one')?.scopeId);
});

test('HTTP Canvas calls strictly validate raw arguments and return payload-free refusal envelopes', async (t) => {
  const { scopeId, ...h } = await openTurn(t);
  const config = await h.server.start();
  t.after(() => h.server.close());
  assert.ok('url' in config);
  for (const [name, args, code] of [
    ['canvas_read', { unexpected: 'HTTP_SENTINEL' }, 'invalid_input'],
    [
      'canvas_write',
      {
        scopeId,
        mutationId: 'invalid-path',
        designId: 'one',
        expectedRevisionId: null,
        files: { '../HTTP_SENTINEL.tsx': 'HTTP_SENTINEL' },
        deletedPaths: [],
      },
      'invalid_source_path',
    ],
  ] as const) {
    await t.test(code, async () => {
      const response = await fetch(config.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name, arguments: args },
        }),
      });
      const text = await response.text();
      assert.ok(!text.includes('HTTP_SENTINEL'));
      const data =
        text
          .split('\n')
          .find((line) => line.startsWith('data: '))
          ?.slice(6) ?? text;
      const result = JSON.parse(data).result;
      assert.ok(result);
      assert.equal(result.isError, true);
      assert.equal(JSON.parse(result.content[0].text).code, code);
    });
  }
  assert.deepEqual(h.workspace.listCanvases(), []);
});

test('theme listing is bounded and saving requires a client mutation ID', async (t) => {
  const { scopeId, ...h } = await openTurn(t);
  assert.equal((await h.call('canvas_read', { unknown: 'secret' })).code, 'invalid_input');
  const listed = await h.call('canvas_theme', { operation: 'list', limit: 1 });
  assert.equal(listed.ok, true);
  assert.equal(listed.systems?.length, 1);
  const system = {
    ...(await readDesignSystem(DEFAULT_DESIGN_SYSTEM_REF)),
    id: 'mutation-required-kit',
  };
  assert.equal(
    (await h.call('canvas_theme', { scopeId, operation: 'save', system })).code,
    'invalid_input',
  );
  assert.equal(
    (
      await h.call('canvas_theme', {
        scopeId,
        operation: 'save',
        mutationId: 'forged-provenance',
        system: {
          ...system,
          provenance: {
            sourceCanvasId: 'other-canvas',
            revision: { designId: 'other-frame', revisionId: 'other-revision' },
          },
        },
      })
    ).code,
    'invalid_input',
  );
  assert.equal(
    (await h.call('canvas_theme', { scopeId, operation: 'save', system, mutationId: 'save-kit' }))
      .ok,
    true,
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
  assert.equal((await h.call('canvas_read', { scopeId: childId })).code, 'invalid_input');
  other.revoke();
  assert.equal((await h.call('canvas_read', { scopeId: childId })).code, 'invalid_input');
  first.revoke();
  const expired = await h.call('canvas_read', { scopeId: oldId });
  assert.equal(expired.code, 'scope_expired');
  assert.equal(expired.message, 'That request belongs to a turn that already ended.');
});

for (const [ending, refusalCode] of [
  ['settlement', 'scope_expired'],
  ['provider replacement', 'invalid_input'],
] as const)
  test(`a delayed lease-less mutation cannot borrow authority after ${ending}`, async (t) => {
    const h = await harness(t);
    const first = h.turns.beginTurn('chat-one', undefined);
    const oldScopeId = h.turns.activeScope('chat-one')?.scopeId;
    assert.ok(oldScopeId);
    const delivery = deferred();
    const input = { mutationId: 'delayed-create', frames: [frame] };
    const pending = delivery.promise.then(() => h.call('canvas_create', input));
    if (ending === 'settlement') first.revoke();
    else h.turns.endSession('chat-one');
    h.turns.beginTurn('chat-one', undefined);
    delivery.resolve();
    assert.equal((await pending).code, 'invalid_input');
    assert.equal(
      (await h.call('canvas_create', { ...input, scopeId: oldScopeId })).code,
      refusalCode,
    );
    assert.deepEqual(h.workspace.listCanvases(), []);
    assert.equal(h.workspace.attachedCanvasId('chat-one'), null);
  });

test('a frame-scoped turn cannot inspect another frame on the same canvas', async (t) => {
  const h = await harness(t);
  const wholeCanvas = h.turns.beginTurn('chat-one', undefined);
  const created = await h.call('canvas_create', {
    scopeId: (await h.call('canvas_read', {})).scopeId,
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
  const { scopeId, ...h } = await openTurn(t);
  const input = { scopeId, mutationId: 'create-one', frames: [frame] };
  const first = await h.call('canvas_create', input);
  const retry = await h.call('canvas_create', input);
  assert.equal(first.ok, true);
  assert.deepEqual(retry.created, first.created);
  assert.equal(h.workspace.listCanvases().length, 1);
  const designId = first.created?.frames[0].designId;
  assert.ok(designId);
  const invalid = await h.call('canvas_write', {
    scopeId,
    mutationId: 'bad-path',
    designId,
    expectedRevisionId: null,
    files: { '../escape.tsx': 'bad' },
    deletedPaths: [],
  });
  assert.equal(invalid.code, 'invalid_source_path');
  const written = await h.call('canvas_write', {
    scopeId,
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
        scopeId,
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

test('canvas_write refuses a tree with no entry and reports its build in the same reply', async (t) => {
  const { scopeId, ...h } = await openTurn(t);
  const created = await h.call('canvas_create', { scopeId, mutationId: 'create', frames: [frame] });
  assert.ok(created.created);
  const { canvasId, frames } = created.created;
  const write = (mutationId: string, expectedRevisionId: string | null, source: string) =>
    h.call('canvas_write', {
      scopeId,
      mutationId,
      designId: frames[0].designId,
      expectedRevisionId,
      files: { [mutationId === 'misnamed' ? 'index.tsx' : 'main.tsx']: source },
      deletedPaths: [],
    });

  // The agent learns the entry contract while its call is open, and nothing is stored.
  const misnamed = await write('misnamed', null, 'export default () => <p>Hey</p>');
  assert.equal(misnamed.code, 'invalid_source');
  assert.match(misnamed.message ?? '', /main\.tsx.*index\.tsx/);
  assert.equal(h.workspace.snapshot(canvasId).frames[0].revisionId, null);

  const broken = await write('broken', null, 'export default () => BROKEN');
  assert.equal(broken.build?.status, 'failed');
  assert.deepEqual(broken.build.diagnostics, [
    { code: 'syntax_error', message: 'Unexpected token', file: 'main.tsx', line: 3 },
  ]);
  assert.match(broken.build.next ?? '', /main\.tsx line 3/);

  // A build that compiles can still stop while it renders; the pane says so.
  assert.ok(broken.receipt);
  const throws = await write('throws', broken.receipt.revisionId, 'export default () => THROWS');
  assert.equal(throws.build?.status, 'render_failed');
  assert.deepEqual(throws.build.errors, ['total is not defined']);

  assert.ok(throws.receipt);
  const fixed = await write('fixed', throws.receipt.revisionId, 'export default () => <p>Hey</p>');
  assert.equal(fixed.build?.status, 'ready');
  assert.equal(fixed.build.rendered, true);
  // Under the canvas's default guide rule, straying from the kit is a note beside a ready build.
  assert.equal(fixed.build.designSystem?.diagnostics[0]?.code, 'design_system_unused');
  assert.match(fixed.build.designSystem.next, /strays from the pinned design system/);
  const later = await h.call('canvas_read', { scopeId });
  assert.equal(later.designSystemAdherence, 'guide');
  assert.equal(later.designSystem, undefined, 'only the opening read carries the kit');
  assert.equal(
    (await h.call('canvas_inspect', { designId: frames[0].designId })).build?.status,
    'ready',
  );
});

test('canvas_inspect answers a screenshot with the PNG of the current revision beside its build report', async (t) => {
  const png = CANVAS_PNG.toString('base64');
  const asked: { canvasId: string; designId: string; revisionId: string; aborted: boolean }[] = [];
  const [reached, held] = [deferred(), deferred()];
  const h = await harness(t, undefined, async (canvasId, ref, signal) => {
    asked.push({ canvasId, ...ref, aborted: signal.aborted });
    if (asked.length > 1) {
      reached.resolve();
      await held.promise;
    }
    return png;
  });
  const turn = h.turns.beginTurn('chat-one', undefined);
  const scopeId = (await h.call('canvas_read', {})).scopeId;
  const created = await h.call('canvas_create', { scopeId, mutationId: 'create', frames: [frame] });
  assert.ok(created.created);
  const { canvasId } = created.created;
  const { designId } = created.created.frames[0];
  const written = await h.call('canvas_write', {
    scopeId,
    mutationId: 'write',
    designId,
    expectedRevisionId: null,
    files: { 'main.tsx': 'export default () => <p>Hey</p>' },
    deletedPaths: [],
  });
  assert.ok(written.receipt);
  const { revisionId } = written.receipt;
  const inspect = h.server.tools.find((entry) => entry.name === 'canvas_inspect');
  assert.ok(inspect);

  const [facts, image] = toolContent(await inspect.handler({ designId, kind: 'screenshot' }));
  const reply = JSON.parse(facts.text ?? '') as Reply & { revisionId?: string };
  assert.equal(reply.revisionId, revisionId);
  assert.equal(reply.build?.status, 'ready');
  assert.deepEqual(image, { type: 'image', data: png, mimeType: 'image/png' });
  assert.deepEqual(asked, [{ canvasId, designId, revisionId, aborted: false }]);

  // A capture that settles after its turn ended never reaches the model.
  const expiring = inspect.handler({ designId, kind: 'screenshot' });
  await reached.promise;
  turn.revoke();
  held.resolve();
  const dropped = toolContent(await expiring);
  assert.equal(dropped.length, 1);
  assert.equal(JSON.parse(dropped[0].text ?? '').code, 'scope_expired');
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
  const scopeId = (await h.call('canvas_read', {})).scopeId;
  const created = await h.call('canvas_create', {
    scopeId,
    mutationId: 'create-one',
    frames: [frame],
  });
  assert.ok(created.created);
  const designId = created.created?.frames[0].designId;
  assert.ok(designId);
  hold = true;
  const pending = h.call('canvas_write', {
    scopeId,
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

test('Canvas create preserves seeded variant placement and mutation retry identity', async (t) => {
  const { scopeId, ...h } = await openTurn(t);
  const source = await h.call('canvas_create', {
    scopeId,
    mutationId: 'create-source',
    frames: [frame],
  });
  assert.ok(source.created);
  const { canvasId, frames } = source.created;
  const designId = frames[0].designId;
  const files = { 'main.tsx': 'export default function Hey(){return <h1>Hey</h1>}' };
  const written = await h.call('canvas_write', {
    scopeId,
    mutationId: 'write-source',
    designId,
    expectedRevisionId: null,
    files,
    deletedPaths: [],
  });
  assert.ok(written.receipt);
  const input = {
    scopeId,
    mutationId: 'create-variant',
    placeBeside: { designId },
    frames: [
      {
        ...frame,
        name: 'Variant',
        seed: {
          kind: 'revision',
          canvasId,
          revision: { designId, revisionId: written.receipt.revisionId },
        },
      },
    ],
  };
  const variant = await h.call('canvas_create', input);
  assert.ok(variant.created);
  const [created] = variant.created.frames;
  assert.ok(created.revisionId);
  assert.deepEqual(
    h.workspace.snapshot(canvasId).frames.find((item) => item.designId === created.designId)?.rect,
    { x: 0, y: 600, width: 720, height: 520 },
  );
  assert.deepEqual(
    {
      ...(await h.workspace.readFiles(canvasId, {
        designId: created.designId,
        revisionId: created.revisionId,
      })),
    },
    files,
  );
  assert.deepEqual((await h.call('canvas_create', input)).created, variant.created);
  assert.equal(
    (await h.call('canvas_create', { ...input, placeBeside: undefined })).code,
    'invalid_input',
  );
  assert.equal(h.workspace.snapshot(canvasId).frames.length, 2);
});

for (const name of ['canvas_create', 'canvas_write', 'canvas_arrange', 'canvas_theme'] as const) {
  test(`a published ${name} keeps its MCP success after turn revocation`, async (t) => {
    const held = holdManifestWrite('published');
    const h = await harness(t, held.fs);
    h.turns.beginTurn('chat-one', undefined);
    const scopeId = (await h.call('canvas_read', {})).scopeId;
    const created = await h.call('canvas_create', {
      scopeId,
      mutationId: 'initial',
      frames: [frame],
    });
    assert.ok(created.ok && created.created);
    const first = created.created.frames[0];
    assert.ok(first);
    const { canvasId } = created.created;
    const designId = first.designId;
    let revisionId: string | null = null;
    if (name === 'canvas_theme') {
      const written = await h.call('canvas_write', {
        scopeId,
        mutationId: 'source',
        designId,
        expectedRevisionId: null,
        files: { 'main.tsx': 'export default () => <p>Theme</p>' },
        deletedPaths: [],
      });
      assert.ok(written.receipt);
      revisionId = written.receipt.revisionId;
    }
    const inputs = {
      canvas_create: {
        scopeId,
        mutationId: 'published-create',
        frames: [{ ...frame, name: 'Next' }],
      },
      canvas_write: {
        scopeId,
        mutationId: 'published-write',
        designId,
        expectedRevisionId: null,
        files: { 'main.tsx': 'export default () => null' },
        deletedPaths: [],
      },
      canvas_arrange: {
        scopeId,
        mutationId: 'published-arrange',
        frames: [
          { designId, expectedLayoutVersion: 0, rect: { x: 800, y: 0, width: 720, height: 520 } },
        ],
      },
      canvas_theme: {
        scopeId,
        operation: 'apply',
        mutationId: 'published-theme',
        designId,
        expectedRevisionId: revisionId,
        ref: { ...DEFAULT_DESIGN_SYSTEM_REF, mode: 'dark' },
      },
    };
    held.arm();
    const pending = h.call(name, inputs[name]);
    await held.reached;
    h.turns.endSession('chat-one');
    const closing = h.workspace.close();
    held.release();
    const result = await pending;
    await closing;
    assert.equal(result.ok, true);
    assert.equal((await h.call(name, inputs[name])).code, 'invalid_input');
    const snapshot = h.workspace.snapshot(canvasId);
    if (name === 'canvas_create') assert.equal(snapshot.frames.length, 2);
    if (name === 'canvas_write' || name === 'canvas_theme') {
      assert.ok(result.receipt);
      assert.equal(snapshot.frames[0]?.revisionId, result.receipt.revisionId);
    }
    if (name === 'canvas_arrange') assert.equal(snapshot.frames[0]?.rect.x, 800);
    if (name === 'canvas_theme') assert.equal(snapshot.frames[0]?.designSystem.mode, 'dark');
  });
}

test('a source read loses its captured lease while waiting and cannot borrow a replacement', async (t) => {
  const { scopeId, ...h } = await openTurn(t);
  const created = await h.call('canvas_create', {
    scopeId,
    mutationId: 'initial',
    frames: [frame],
  });
  assert.ok(created.created);
  const first = created.created.frames[0];
  assert.ok(first);
  const written = await h.call('canvas_write', {
    scopeId,
    mutationId: 'source',
    designId: first.designId,
    expectedRevisionId: null,
    files: { 'main.tsx': 'export default () => <h1>READ_SENTINEL</h1>' },
    deletedPaths: [],
  });
  assert.ok(written.receipt);
  const readFiles = h.workspace.readFiles.bind(h.workspace);
  const reached = deferred();
  const released = deferred();
  t.mock.method(h.workspace, 'readFiles', async (...args: Parameters<typeof readFiles>) => {
    const files = await readFiles(...args);
    reached.resolve();
    await released.promise;
    return files;
  });
  const reading = h.call('canvas_read', {
    scopeId,
    view: 'design',
    designId: first.designId,
    revisionId: written.receipt.revisionId,
  });
  await reached.promise;
  h.turns.endSession('chat-one');
  h.turns.beginTurn('chat-one', undefined);
  released.resolve();
  const reply = await reading;
  assert.equal(reply.code, 'invalid_input');
  assert.equal(reply.ok, false);
  assert.ok(!JSON.stringify(reply).includes('READ_SENTINEL'));
});

test('MCP theme apply validates token mapping before publication and preserves retry receipts', async (t) => {
  const { scopeId, ...h } = await openTurn(t);
  const created = await h.call('canvas_create', {
    scopeId,
    mutationId: 'theme-frame',
    frames: [frame],
  });
  assert.ok(created.created);
  const { canvasId, frames } = created.created;
  const designId = frames[0].designId;
  const write = (mutationId: string, expectedRevisionId: string | null, text: string) =>
    h.call('canvas_write', {
      scopeId,
      mutationId,
      designId,
      expectedRevisionId,
      files: { 'main.tsx': text },
      deletedPaths: [],
    });
  const source = await write(
    'theme-source',
    null,
    'export default function App(){return <p style={{color:"var(--ds-missing)"}}>Hey</p>}',
  );
  assert.ok(source.receipt);
  const input = {
    scopeId,
    operation: 'apply',
    mutationId: 'apply-kit',
    designId,
    expectedRevisionId: source.receipt.revisionId,
    ref: { id: 'openai-inspired', version: 1, mode: 'dark' },
  };
  const before = h.workspace.snapshot(canvasId);
  assert.equal((await h.call('canvas_theme', input)).code, 'invalid_source');
  assert.deepEqual(h.workspace.snapshot(canvasId), before);
  const fixed = await write(
    'theme-fix',
    source.receipt.revisionId,
    'export default function App(){return <p>Hey</p>}',
  );
  assert.ok(fixed.receipt);
  input.expectedRevisionId = fixed.receipt.revisionId;
  const applied = await h.call('canvas_theme', input);
  assert.equal(applied.ok, true);
  assert.ok(applied.receipt);
  assert.deepEqual(h.workspace.snapshot(canvasId).frames[0].designSystem, input.ref);
  assert.equal(
    (
      await write(
        'theme-later',
        applied.receipt.revisionId,
        'export default function App(){return <p>Later</p>}',
      )
    ).ok,
    true,
  );
  const after = h.workspace.snapshot(canvasId);
  assert.deepEqual((await h.call('canvas_theme', input)).receipt, applied.receipt);
  assert.deepEqual(h.workspace.snapshot(canvasId), after);
});

test('a delayed theme validation refusal cannot disclose source after its turn is replaced', async (t) => {
  const { scopeId, ...h } = await openTurn(t);
  const created = await h.call('canvas_create', {
    scopeId,
    mutationId: 'validation-frame',
    frames: [frame],
  });
  assert.ok(created.created);
  const { canvasId, frames } = created.created;
  const designId = frames[0].designId;
  const source = await h.call('canvas_write', {
    scopeId,
    mutationId: 'validation-source',
    designId,
    expectedRevisionId: null,
    files: {
      'main.tsx': 'export default () => <p style={{color:"var(--SOURCE_SENTINEL)"}}>Hey</p>',
    },
    deletedPaths: [],
  });
  assert.ok(source.receipt);
  const before = h.workspace.snapshot(canvasId);
  const reached = deferred();
  const release = deferred();
  const write = h.workspace.write.bind(h.workspace);
  t.mock.method(h.workspace, 'write', (...[scope, input, options]: Parameters<typeof write>) => {
    assert.ok(options?.validateSource);
    const validateSource = options.validateSource;
    return write(scope, input, {
      ...options,
      validateSource: async (files) => {
        try {
          await validateSource(files);
        } finally {
          reached.resolve();
          await release.promise;
        }
      },
    });
  });
  const applying = h.call('canvas_theme', {
    scopeId,
    operation: 'apply',
    mutationId: 'validation-apply',
    designId,
    expectedRevisionId: source.receipt.revisionId,
    ref: { ...DEFAULT_DESIGN_SYSTEM_REF, mode: 'dark' },
  });
  await reached.promise;
  h.turns.endSession('chat-one');
  h.turns.beginTurn('chat-one', undefined);
  release.resolve();
  const reply = await applying;
  assert.equal(reply.ok, false);
  assert.equal(reply.code, 'invalid_input');
  assert.ok(!JSON.stringify(reply).includes('SOURCE_SENTINEL'));
  assert.deepEqual(h.workspace.snapshot(canvasId), before);
});
