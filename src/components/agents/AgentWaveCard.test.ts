import test from 'node:test';
import assert from 'node:assert/strict';
import type { ChildSessionSummary } from '@droidex/protocol';
import { childStreamSnapshot } from '../../lib/childSessionStream';
import { sameWaveMonitor } from './AgentWaveCard';
import type { AgentMonitorData } from './AgentMonitorCard';

function child(childSessionId: string, toolUseId: string): ChildSessionSummary {
  return {
    childSessionId,
    parentAppSessionId: 'parent',
    status: 'working',
    spawnLink: { kind: 'tool-use', id: toolUseId },
  } as ChildSessionSummary;
}

const NO_MODELS: AgentMonitorData['models'] = [];

function monitor(
  sessions: ChildSessionSummary[],
  snapshots?: AgentMonitorData['snapshots'],
  models: AgentMonitorData['models'] = NO_MODELS,
): AgentMonitorData {
  return { sessions, models, ...(snapshots !== undefined ? { snapshots } : {}) };
}

function snapshotMap(children: ChildSessionSummary[]): AgentMonitorData['snapshots'] {
  return new Map(
    children.map((entry) => [entry.childSessionId, childStreamSnapshot(entry, undefined)]),
  );
}

const spawns = [{ toolUseId: 'tu-a', id: 'spawn-a', ts: 1 }];

test('a wave monitor compares equal when only sibling waves moved', () => {
  const own = child('child-a', 'tu-a');
  const sibling = child('child-b', 'tu-b');
  const before = monitor([own, sibling], snapshotMap([own, sibling]));
  const settledSibling = { ...sibling, status: 'completed' } as ChildSessionSummary;
  // Production snapshot maps are structurally shared: an unchanged child keeps
  // its prior entry object. Reuse own's entry the way the projection would.
  const afterSnapshots = new Map([
    [own.childSessionId, before.snapshots?.get(own.childSessionId)],
    [settledSibling.childSessionId, childStreamSnapshot(settledSibling, undefined)],
  ]) as AgentMonitorData['snapshots'];
  const after = monitor([own, settledSibling], afterSnapshots);

  assert.equal(sameWaveMonitor(before, after, spawns), true);
});

test('a wave monitor re-renders when its own spawn data moves', () => {
  const own = child('child-a', 'tu-a');
  const base = monitor([own], snapshotMap([own]));

  const replacedChild = { ...own, status: 'completed' } as ChildSessionSummary;
  assert.equal(
    sameWaveMonitor(base, monitor([replacedChild], snapshotMap([replacedChild])), spawns),
    false,
  );

  const movedSnapshot = new Map([
    [own.childSessionId, { ...childStreamSnapshot(own, undefined), step: 'new step' }],
  ]);
  assert.equal(
    sameWaveMonitor(base, monitor([own], movedSnapshot as AgentMonitorData['snapshots']), spawns),
    false,
  );

  assert.equal(sameWaveMonitor(base, monitor([], snapshotMap([])), spawns), false);
  assert.equal(
    sameWaveMonitor(base, monitor([own], snapshotMap([own]), [{}] as never), spawns),
    false,
  );
});

test('a missing snapshot entry never compares equal — the fallback sees live activity', () => {
  const own = child('child-a', 'tu-a');
  const full = monitor([own], snapshotMap([own]));
  const partial = monitor([own], new Map());

  assert.equal(sameWaveMonitor(full, partial, spawns), false);
  assert.equal(sameWaveMonitor(partial, full, spawns), false);
  assert.equal(sameWaveMonitor(partial, partial, spawns), true);
  assert.equal(sameWaveMonitor(full, full, spawns), true);
});
