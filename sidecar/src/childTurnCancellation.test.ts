import assert from 'node:assert/strict';
import test from 'node:test';

import {
  childStateFromRecord,
  type ChildOpenAttempt,
  type ParentChildSessions,
} from './ChildSessionState.js';
import {
  cancelInFlightOpen,
  dequeueQueuedChild,
  prepareChildInterrupt,
} from './childTurnCancellation.js';

function child(status: 'paused' | 'running' = 'paused') {
  return childStateFromRecord({
    parentAppSessionId: 'parent',
    childSessionId: 'child',
    role: 'worker',
    status,
    modelId: 'model-default',
    transcriptAvailable: true,
    updatedAt: 1,
  });
}

function attempt(): ChildOpenAttempt {
  let cancel = (): void => undefined;
  let settle = (): void => undefined;
  return {
    settled: new Promise<void>((resolve) => {
      settle = resolve;
    }),
    settle,
    cancelled: new Promise<void>((resolve) => {
      cancel = resolve;
    }),
    cancel,
    isCancelled: false,
  };
}

function parentWith(
  childState: ReturnType<typeof child>,
  open?: ChildOpenAttempt,
): ParentChildSessions {
  const id = childState.identity.childSessionId;
  return {
    parentAppSessionId: 'parent',
    generation: 1,
    lease: {} as ParentChildSessions['lease'],
    children: new Map([[id, childState]]),
    spawnChildren: new Map(),
    settledSinceWake: new Map(),
    pendingSpawns: new Map(),
    openAttempts: open ? new Map([[id, open]]) : new Map(),
    reservedOpenSlots: new Set(),
    runtimeQueue: [id],
    closing: false,
  };
}

test('prepareChildInterrupt discards queued sends and settles without looking running', () => {
  const state = child('running');
  state.queued = true;
  state.queuedRequestId = 'open-1';
  state.turn.pendingSends.push('cancelled');
  const parent = parentWith(state);
  const prepared = prepareChildInterrupt(parent, state, 1_000);
  assert.equal(prepared.kind, 'queued');
  assert.deepEqual(state.turn.pendingSends, []);
  assert.equal(state.queued, false);
  assert.equal(state.status, 'paused');
  assert.equal(state.turn.phase, 'idle');
  assert.deepEqual(parent.runtimeQueue, []);
});

test('prepareChildInterrupt of a live child keeps the runtime path', () => {
  const state = child();
  state.turn.pendingSends.push('cancelled');
  state.runtime = { session: {} as never, generation: 1, lastUsedAt: 0 };
  const prepared = prepareChildInterrupt(parentWith(state), state, 1_000);
  assert.equal(prepared.kind, 'live');
  assert.deepEqual(state.turn.pendingSends, []);
  assert.equal(state.turn.interrupting, false);
});

test('cancelInFlightOpen is a no-op once a runtime exists and is idempotent', () => {
  const state = child();
  const open = attempt();
  const parent = parentWith(state, open);
  assert.equal(cancelInFlightOpen(parent, state), true);
  assert.equal(open.isCancelled, true);
  assert.equal(cancelInFlightOpen(parent, state), true);
  state.runtime = { session: {} as never, generation: 1, lastUsedAt: 0 };
  assert.equal(cancelInFlightOpen(parent, state), false);
});

test('dequeue removes a waiting child from the runtime queue', () => {
  const state = child();
  state.queued = true;
  state.queuedRequestId = 'open-1';
  const parent = parentWith(state);
  dequeueQueuedChild(parent, state);
  assert.deepEqual(parent.runtimeQueue, []);
  assert.equal(state.queued, false);
  assert.equal(state.queuedRequestId, undefined);
});
