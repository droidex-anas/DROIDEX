import assert from 'node:assert/strict';
import test from 'node:test';
import { canvasShutdownReply, shutdownSidecar } from './shutdown.js';
import { board } from './testing/canvasBuildSupport.js';
import { deferred } from './testing/canvasStorageSupport.js';

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
