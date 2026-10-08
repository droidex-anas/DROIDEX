import assert from 'node:assert/strict';
import test from 'node:test';
import { CanvasBuilds } from './canvas/CanvasBuilds.js';
import { CanvasScopes } from './canvas/canvasScopes.js';
import { CanvasWorkspace } from './canvas/CanvasWorkspace.js';
import type { CanvasScope } from './canvas/protocol.js';
import type { ServerEvent } from './protocol.js';
import { canvasShutdownReply, shutdownCanvas, shutdownSidecar } from './shutdown.js';
import { canvasCommandHandler } from './testing/canvasBridgeSupport.js';
import { board, CompilerFleet, fakeDeadlines, storage } from './testing/canvasBuildSupport.js';
import { deferred, observedFileSystem } from './testing/canvasStorageSupport.js';

test('sidecar shutdown attempts every stage and reports the first failure', async () => {
  const calls: string[] = [];
  const firstError = new Error('session shutdown failed');

  await assert.rejects(
    shutdownSidecar({
      closeCanvasAdmission: () => {
        calls.push('admission');
      },
      shutdownSessions: async () => {
        calls.push('sessions');
        throw firstError;
      },
      shutdownAutomations: async () => {
        calls.push('automations');
        throw new Error('automation shutdown failed');
      },
      shutdownCanvas: async () => {
        calls.push('canvas');
        throw new Error('canvas shutdown failed');
      },
      disableMetrics: () => {
        calls.push('metrics');
        throw new Error('metrics shutdown failed');
      },
      closeBridge: async () => {
        calls.push('bridge');
        throw new Error('bridge shutdown failed');
      },
    }),
    (error) => error === firstError,
  );
  assert.deepEqual(calls, ['admission', 'sessions', 'canvas', 'automations', 'metrics', 'bridge']);
});

test('shutdown closes Canvas admission and aborts builds before session cleanup settles', async (t) => {
  const canvas = await board(t);
  const [designId] = await canvas.create('Hey');
  assert.ok(designId);
  await canvas.write(designId, null, 'v1');
  const compile = await canvas.fleet.compile(1);
  const sessions = deferred();
  const admission = new AbortController();
  const calls: string[] = [];
  const closing = shutdownSidecar({
    closeCanvasAdmission: () => admission.abort(),
    shutdownSessions: () => sessions.promise,
    shutdownAutomations: async () => {
      calls.push('automations');
    },
    shutdownCanvas: () => canvas.builds.close(),
    disableMetrics: () => undefined,
    closeBridge: async () => undefined,
  });
  try {
    assert.equal(admission.signal.aborted, true, 'new pane commands are refused immediately');
    assert.deepEqual(
      canvasShutdownReply(
        { type: 'canvas.createCanvas', requestId: 'after-close', appSessionId: 'app-1' },
        admission.signal,
      ),
      {
        type: 'canvas.result',
        requestId: 'after-close',
        ok: false,
        error: { code: 'scope_expired', message: 'DROIDEX is shutting down.' },
      },
    );
    assert.equal(compile.signal.aborted, true, 'build cancellation does not wait for sessions');
    assert.deepEqual(calls, [], 'automation persistence still follows session settlement');
  } finally {
    sessions.resolve();
    await closing;
  }
});

test('shutdown refuses an admitted pane arrange before build storage drains', async (t) => {
  const artifactReached = deferred();
  const artifactRelease = deferred();
  const outcomeReached = deferred();
  const outcomeRelease = deferred();
  let holdOutputs = false;
  const fs = observedFileSystem(async (operation, path) => {
    if (!holdOutputs) return;
    if (operation === 'open' && path.includes('/builds/held-artifact.html.')) {
      artifactReached.resolve();
      await artifactRelease.promise;
    }
    if (operation === 'rename' && path.includes('/builds/') && path.endsWith('.json')) {
      outcomeReached.resolve();
      await outcomeRelease.promise;
    }
  });
  const store = await storage(t);
  const fleet = new CompilerFleet();
  const builds = new CanvasBuilds({ compiler: fleet.client, deadline: fakeDeadlines().deadline });
  const scopes = new CanvasScopes();
  const workspace = await CanvasWorkspace.open(store.root, builds, {
    isScopeActive: (id) => scopes.isScopeActive(id),
    bindScopeCanvas: (id, canvasId) => scopes.bindScopeCanvas(id, canvasId),
    fs,
  });
  const ready = Promise.resolve(workspace);
  store.closing.push(() => shutdownCanvas(builds, scopes, ready, workspace));
  const { canvasId } = await workspace.createCanvas('app-1');
  const scope: CanvasScope = {
    origin: 'user',
    scopeId: 'setup',
    appSessionId: 'app-1',
    canvasId,
    allowedDesignIds: 'canvas',
  };
  scopes.register(scope);
  const { frames } = await workspace.create(scope, {
    mutationId: 'setup-frames',
    frames: ['One', 'Two'].map((name) => ({
      name,
      width: 720,
      height: 720,
      designSystem: { id: 'droidex', version: 1, mode: 'light' },
    })),
  });
  const first = frames[0];
  assert.ok(first);
  for (const frame of frames) {
    await workspace.write(scope, {
      mutationId: `write-${frame.designId}`,
      designId: frame.designId,
      expectedRevisionId: null,
      files: { 'main.tsx': 'export default () => null' },
      deletedPaths: [],
    });
  }
  holdOutputs = true;
  (await fleet.compile(1)).ready('held-artifact');
  await artifactReached.promise;
  (await fleet.compile(2)).ready('held-outcome');
  await outcomeReached.promise;
  const events: ServerEvent[] = [];
  const { handle: dispatch } = canvasCommandHandler({
    ready,
    scopes,
    builds,
    events,
    root: store.root,
  });
  const mutation = dispatch(
    {
      type: 'canvas.arrange',
      requestId: 'queued-pane',
      appSessionId: 'app-1',
      canvasId,
      input: {
        mutationId: 'move-on-quit',
        frames: [
          {
            designId: first.designId,
            expectedLayoutVersion: 0,
            rect: { x: 123, y: 456, width: 720, height: 720 },
          },
        ],
      },
    },
    'page-1',
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  const admission = new AbortController();
  let canvasClosed = false;
  const closing = shutdownSidecar({
    closeCanvasAdmission: () => admission.abort(),
    shutdownSessions: async () => undefined,
    shutdownAutomations: async () => undefined,
    shutdownCanvas: () =>
      shutdownCanvas(builds, scopes, ready, workspace).then(() => {
        canvasClosed = true;
      }),
    disableMetrics: () => undefined,
    closeBridge: async () => undefined,
  });
  try {
    outcomeRelease.resolve();
    await mutation;
    const reply = events.find(
      (event) => event.type === 'canvas.result' && event.requestId === 'queued-pane',
    );
    assert.ok(reply?.type === 'canvas.result');
    assert.equal(reply.ok, false, 'an admitted pane mutation must lose its publication authority');
    assert.equal(workspace.snapshot(canvasId).frames[0]?.layoutVersion, 0);
    assert.equal(canvasClosed, false, 'unrelated artifact storage remains held');
    assert.equal(scopes.isScopeActive(scope.scopeId), false, 'pane user scopes are revoked');
  } finally {
    artifactRelease.resolve();
    outcomeRelease.resolve();
    await closing;
  }
});
