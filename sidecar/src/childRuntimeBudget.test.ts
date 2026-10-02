import assert from 'node:assert/strict';
import test from 'node:test';

import { childRuntimeAdmission, decideChildRuntimeCapacity } from './childRuntimeBudget.js';
import {
  childStateFromRecord,
  type ChildSessionState,
  type ParentChildSessions,
} from './ChildSessionState.js';
import { FakeFactorySession } from './testing/fakeFactoryRuntime.js';

const budget = { maxLive: 2, maxQueued: 3 };

test('admission admits under the limit or by evicting idle, queues busy overflow, rejects a full queue', () => {
  const hardMax = { maxLive: 4, maxQueued: 16 };
  const cases = [
    { limits: budget, live: 1, queued: 0, idleLive: 0, expected: 'admit' },
    { limits: budget, live: 2, queued: 0, idleLive: 1, expected: 'admit' },
    { limits: budget, live: 2, queued: 2, idleLive: 0, expected: 'queue' },
    { limits: budget, live: 2, queued: 3, idleLive: 0, expected: 'reject' },
    { limits: hardMax, live: 3, queued: 0, idleLive: 0, expected: 'admit' },
    { limits: hardMax, live: 4, queued: 0, idleLive: 0, expected: 'queue' },
  ] as const;
  for (const { limits, expected, ...occupancy } of cases) {
    assert.equal(
      childRuntimeAdmission(limits, { ...occupancy, reserved: 0 }),
      expected,
      JSON.stringify(occupancy),
    );
  }
});

function child(id: string, lastUsedAt = 0): ChildSessionState {
  const state = childStateFromRecord({
    parentAppSessionId: 'parent',
    childSessionId: id,
    providerSessionId: `provider-${id}`,
    role: 'worker',
    status: 'paused',
    modelId: 'model-default',
    transcriptAvailable: true,
    updatedAt: 1,
  });
  state.runtime = {
    session: new FakeFactorySession(`provider-${id}`, {}, []),
    generation: 1,
    lastUsedAt,
  };
  return state;
}

function parentOf(...children: ChildSessionState[]): ParentChildSessions {
  return {
    parentAppSessionId: 'parent',
    generation: 1,
    lease: {
      summary: {} as ParentChildSessions['lease']['summary'],
      droid: new FakeFactorySession('parent-provider', {}, []),
      mcpConfigs: [],
    },
    children: new Map(children.map((entry) => [entry.identity.childSessionId, entry])),
    spawnChildren: new Map(),
    settledSinceWake: new Map(),
    pendingSpawns: new Map(),
    openAttempts: new Map(),
    reservedOpenSlots: new Set(),
    runtimeQueue: [],
    closing: false,
  };
}

test('capacity evicts the least-recently-used idle runtime at the live limit', () => {
  const older = child('older', 1);
  const newer = child('newer', 9);
  const requested = child('requested');
  requested.runtime = undefined;
  const parent = parentOf(older, newer, requested);
  assert.deepEqual(decideChildRuntimeCapacity(parent, requested, budget), {
    action: 'evict',
    victim: older,
  });
});

test('capacity rejects when the queue is already full', () => {
  const busy = child('busy', 1);
  busy.turn.phase = 'streaming';
  const other = child('other', 2);
  other.turn.phase = 'streaming';
  const requested = child('requested');
  requested.runtime = undefined;
  const parent = parentOf(busy, other, requested);
  parent.runtimeQueue = ['a', 'b', 'c'];
  assert.deepEqual(decideChildRuntimeCapacity(parent, requested, budget), { action: 'reject' });
});
