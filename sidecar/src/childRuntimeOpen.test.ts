import assert from 'node:assert/strict';
import test from 'node:test';

import { childStateFromRecord, type ParentChildSessions } from './ChildSessionState.js';
import {
  CHILD_OPEN_CANCELLED,
  awaitOpenStep,
  beginOpenAttempt,
  cancelOpenAttempts,
  openChildHistory,
} from './childRuntimeOpen.js';

function child() {
  return childStateFromRecord({
    parentAppSessionId: 'parent',
    childSessionId: 'child',
    providerSessionId: 'provider',
    role: 'worker',
    status: 'paused',
    modelId: 'model-default',
    transcriptAvailable: true,
    updatedAt: 1,
  });
}

function parentWith(): ParentChildSessions {
  const state = child();
  return {
    parentAppSessionId: 'parent',
    generation: 1,
    lease: {} as ParentChildSessions['lease'],
    children: new Map([[state.identity.childSessionId, state]]),
    spawnChildren: new Map(),
    settledSinceWake: new Map(),
    pendingSpawns: new Map(),
    openAttempts: new Map(),
    reservedOpenSlots: new Set(),
    runtimeQueue: [],
    closing: false,
  };
}

test('awaitOpenStep still cleans a late load after cancellation', async () => {
  const parent = parentWith();
  const attempt = beginOpenAttempt(parent, 'child');
  const cleaned: string[] = [];
  const operation = new Promise<string>((resolve) => {
    setImmediate(() => resolve('session'));
  });
  attempt.cancel();
  const result = await awaitOpenStep(attempt, operation, (value) => {
    cleaned.push(value);
  });
  assert.equal(result, CHILD_OPEN_CANCELLED);
  await operation;
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(cleaned, ['session']);
});

test('cancelOpenAttempts cancels every in-flight open and closes provisionals', async () => {
  const parent = parentWith();
  const attempt = beginOpenAttempt(parent, 'child');
  let closed = 0;
  attempt.provisionalSession = {
    close: () => {
      closed += 1;
      return Promise.resolve();
    },
  } as never;
  await cancelOpenAttempts(parent);
  assert.equal(attempt.isCancelled, true);
  assert.equal(parent.openAttempts.size, 0);
  assert.equal(closed, 1);
  await cancelOpenAttempts(parent);
  assert.equal(closed, 1);
});

test('openChildHistory reports unavailable when no transcript exists', () => {
  const errors: string[] = [];
  openChildHistory(
    {
      parentAppSessionId: 'parent',
      childSessionId: 'child',
      role: 'worker',
      status: 'completed',
      modelId: 'model-default',
      transcriptAvailable: false,
      updatedAt: 1,
    },
    'open',
    'req-1',
    {
      emitError: (_identity, _op, _id, code) => {
        errors.push(code);
      },
      emit: () => undefined,
      loadChildHistory: () => undefined,
    },
  );
  assert.deepEqual(errors, ['child.runtime_unavailable']);
});
