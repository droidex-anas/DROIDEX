import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { canvasRoot, quietBuilds } from '../testing/canvasStorageSupport.js';
import { applyDesignSystem } from './applyDesignSystem.js';
import { CanvasWorkspace } from './CanvasWorkspace.js';
import { readDesignSystem } from './designSystems.js';
import type { CanvasScope, SourceFiles } from './protocol.js';

const system = { id: 'openai-inspired', version: 1, mode: 'dark' } as const;

async function design(
  t: TestContext,
  files: SourceFiles = {
    'main.tsx': 'export default function App() { return <button>Hey</button>; }',
  },
) {
  const builds = quietBuilds();
  const workspace = await CanvasWorkspace.open(await canvasRoot(t), builds, {
    isChatKnown: () => true,
    isScopeActive: () => true,
    bindScopeCanvas: () => undefined,
  });
  t.after(async () => {
    await workspace.close();
    await builds.close();
  });
  const { canvasId } = await workspace.createCanvas('app-theme', 'create-theme-canvas');
  const scope: CanvasScope = {
    origin: 'user',
    scopeId: 'user-theme',
    appSessionId: 'app-theme',
    canvasId,
    allowedDesignIds: 'canvas',
  };
  const created = await workspace.create(scope, {
    mutationId: 'create-theme',
    frames: [
      {
        name: 'Theme',
        width: 720,
        height: 720,
        designSystem: { id: 'droidex', version: 1, mode: 'light' },
      },
    ],
  });
  const frame = created.frames[0];
  assert.ok(frame);
  const receipt = await workspace.write(scope, {
    mutationId: 'write-theme',
    designId: frame.designId,
    expectedRevisionId: null,
    files,
    deletedPaths: [],
  });
  const input = {
    designId: frame.designId,
    expectedRevisionId: receipt.revisionId,
    system,
    mutationId: 'apply-theme',
  };
  return { workspace, canvasId, scope, input, files };
}

test('apply commits a new source revision and replays its original receipt after later edits', async (t) => {
  const { workspace, canvasId, scope, input, files } = await design(t);
  const originalKit = await readDesignSystem(system);
  const applied = await applyDesignSystem(workspace, scope, input);
  assert.equal(applied.status, 'applied');
  if (applied.status !== 'applied') return;
  assert.notEqual(applied.receipt.revisionId, input.expectedRevisionId);
  assert.deepEqual({ ...(await workspace.readFiles(canvasId, applied.receipt)) }, files);
  assert.deepEqual(workspace.snapshot(canvasId).frames[0]?.designSystem, system);
  await workspace.write(scope, {
    mutationId: 'later-edit',
    designId: input.designId,
    expectedRevisionId: applied.receipt.revisionId,
    files: { 'main.tsx': 'export default function App() { return <p>Later</p>; }' },
    deletedPaths: [],
  });
  const beforeReplay = workspace.snapshot(canvasId);
  assert.deepEqual(await applyDesignSystem(workspace, scope, input), applied);
  await assert.rejects(
    applyDesignSystem(workspace, scope, { ...input, system: { ...system, version: 99 } }),
    { code: 'invalid_input' },
  );
  assert.deepEqual(workspace.snapshot(canvasId), beforeReplay);
  assert.deepEqual(await readDesignSystem(system), originalKit);
});

test('apply refuses stale CAS and leaves the current source and system intact', async (t) => {
  const { workspace, canvasId, scope, input } = await design(t);
  const before = workspace.snapshot(canvasId);
  await assert.rejects(
    applyDesignSystem(workspace, scope, { ...input, expectedRevisionId: 'stale-revision' }),
    { code: 'revision_conflict' },
  );
  assert.deepEqual(workspace.snapshot(canvasId), before);
});

test('unmapped tokens have source locations and refuse the apply without committing', async (t) => {
  const files = {
    'main.tsx':
      '// "--ds-brand": "#fff"; var(--ds-comment)\nexport default function App() { return <p style={{ color: "var(--ds-brand)" }}>Hey</p>; }',
    'style.css':
      ':root { --owned: #123456; }\n.ds-card { background: var(--owned); color: var(--ds-absent); border-color: var(--ds-absent); content: "var(--ds-quoted)"; }',
  };
  const { workspace, canvasId, scope, input } = await design(t, files);
  const before = workspace.snapshot(canvasId);
  const refused = await applyDesignSystem(workspace, scope, input);
  assert.equal(refused.status, 'refused');
  if (refused.status !== 'refused') return;
  assert.deepEqual(
    refused.diagnostics.map(({ code, file, line }) => ({ code, file, line })),
    [
      { code: 'unmapped_token', file: 'main.tsx', line: 2 },
      { code: 'unmapped_token', file: 'style.css', line: 2 },
    ],
  );
  assert.deepEqual(workspace.snapshot(canvasId), before);
  // Refusal does not spend the mutation ID.
  const changed = await workspace.write(scope, {
    mutationId: 'fix-mapping',
    designId: input.designId,
    expectedRevisionId: input.expectedRevisionId,
    files: {
      'main.tsx': 'export default function App(){return <p>Hey</p>}',
      'style.css': ':root { --owned: #123456; }\n.ds-card { color: var(--owned); }',
    },
    deletedPaths: [],
  });
  assert.equal(
    (
      await applyDesignSystem(workspace, scope, {
        ...input,
        expectedRevisionId: changed.revisionId,
      })
    ).status,
    'applied',
  );
});

test('an unavailable pinned kit version reports version_mismatch without a revision', async (t) => {
  const { workspace, canvasId, scope, input } = await design(t);
  const before = workspace.snapshot(canvasId);
  const result = await applyDesignSystem(workspace, scope, {
    ...input,
    system: { ...system, version: 99 },
  });
  assert.equal(result.status, 'refused');
  if (result.status !== 'refused') return;
  assert.equal(result.diagnostics[0]?.code, 'version_mismatch');
  assert.deepEqual(workspace.snapshot(canvasId), before);
});
