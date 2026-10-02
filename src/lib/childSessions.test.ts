import test from 'node:test';
import assert from 'node:assert/strict';
import type { ChildAccess, ChildSessionInfo } from '../hooks/storeChildSession';
import type { TranscriptEvent } from '../types/bridge';
import {
  childSessionActivityForTarget,
  childSessionIdForFeature,
  childSessionLabel,
  childSelectionForFeature,
  childSessionLatest,
  childSessionMeta,
  childSessionTargetFromEvent,
  childRuntimeSubmitTarget,
  commitChildPromptAfterBaseline,
  childSessionIsLive,
  childSessionKey,
  findChildSessionForTarget,
  isPendingChildPlaceholder,
  mergeChildSessionSpawn,
  orderedChildSessions,
  shouldOpenSelectedChild,
  shouldRequestReleasedChildHistory,
  spawnedChildSessions,
  resolveWaveSessions,
  workingFirstChildSessions,
  transcriptForVisibleSession,
  visibleSessionCanCompact,
  visibleSessionIsPending,
  visibleSessionTarget,
  type VisibleSessionTarget,
} from './childSessions';
import { childSessionInfo } from './tools';

function ev(
  p: Partial<TranscriptEvent> &
    Pick<TranscriptEvent, 'id' | 'sourceSessionId' | 'role' | 'ts' | 'kind'>,
): TranscriptEvent {
  return { appSessionId: 'app-1', ...p } as TranscriptEvent;
}

function child(overrides: Partial<ChildSessionInfo> = {}): ChildSessionInfo {
  return {
    parentAppSessionId: 'parent-a',
    childSessionId: 'child-a',
    role: 'worker',
    status: 'running',
    modelId: 'model-default',
    transcriptAvailable: true,
    streamFidelity: 'state',
    ...overrides,
  };
}

const selection = { parentAppSessionId: 'parent-a', childSessionId: 'child-a' };

/** The visible target for parent-a/child-a with the given child and access. */
function childTarget(summary: ChildSessionInfo, access?: ChildAccess) {
  return visibleSessionTarget(
    'parent-a',
    selection,
    { 'parent-a': { 'child-a': summary } },
    access ? { 'parent-a': { 'child-a': access } } : {},
  );
}

function readyAccess(runtimeGeneration: number): ChildAccess {
  return { state: 'ready', requestId: 'ready', runtimeGeneration };
}

/** A git baseline the test releases by hand, to race state changes against it. */
function heldBaseline() {
  let release = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { wait: () => promise, release };
}

const spawn = (toolArgs: Record<string, unknown>): TranscriptEvent =>
  ev({
    id: 's',
    sourceSessionId: 'orc',
    role: 'primary',
    ts: 1,
    kind: 'tool_call',
    toolName: 'Task',
    toolArgs,
  });

test('childSessionTargetFromEvent falls back to the spawn event id', () => {
  const spawnEvent = spawn({ subagent_type: 'explorer' });
  assert.deepEqual(childSessionTargetFromEvent(spawnEvent), {
    toolUseId: spawnEvent.id,
    label: 'explorer',
  });
  assert.deepEqual(childSessionTargetFromEvent({ ...spawnEvent, toolUseId: 'tool-a' }), {
    toolUseId: 'tool-a',
    label: 'explorer',
  });
});

test('resolveWaveSessions matches a registered child by spawn event id when toolUseId is absent', () => {
  const spawnEvent = spawn({ subagent_type: 'explorer' });
  const registered = child({
    parentAppSessionId: spawnEvent.appSessionId,
    spawnLink: { kind: 'tool-use', id: spawnEvent.id },
  });
  const [resolved] = resolveWaveSessions([spawnEvent], [registered]);
  assert.equal(resolved?.childSessionId, 'child-a');
  assert.equal(resolved?.status, 'running');
  const siblings = resolveWaveSessions(
    [spawnEvent],
    [registered, { ...registered, childSessionId: 'child-b' }],
  );
  assert.deepEqual(siblings.map(childSessionKey), ['child-a', 'child-b']);
});

test('mergeChildSessionSpawn combines label and description deltas in either order', () => {
  const merged = { label: 'worker', description: 'fix the bug' };
  const label = spawn({ subagent_type: 'worker' });
  const description = spawn({ description: 'fix the bug' });
  assert.deepEqual(childSessionInfo(mergeChildSessionSpawn(label, description).toolArgs), merged);
  assert.deepEqual(childSessionInfo(mergeChildSessionSpawn(description, label).toolArgs), merged);
  // Latest args that already carry both fields win as they are.
  const next = spawn({ subagent_type: 'worker', description: 'do X' });
  assert.deepEqual(childSessionInfo(mergeChildSessionSpawn(label, next).toolArgs), {
    label: 'worker',
    description: 'do X',
  });
});

test('a spawn is timed from its first delta, not from the last one to stream in', () => {
  const first = spawn({ subagent_type: 'worker' });
  // Deltas of one spawn can stream over a second or more; timing the row from
  // the last of them would start it late and shorten the card's total.
  const late = { ...spawn({ description: 'do X' }), id: 'late', ts: 4_000 };
  assert.equal(mergeChildSessionSpawn(first, late).ts, first.ts);
  // Both merge paths preserve it: this one needs no arg rebuild at all.
  assert.equal(
    mergeChildSessionSpawn(first, { ...late, toolArgs: { subagent_type: 'worker' } }).ts,
    first.ts,
  );
});

test('childSessionLatest surfaces failures and errors, not stale activity', () => {
  const out = childSessionLatest({
    kind: 'tool_result',
    text: 'command exited 1',
    toolName: 'Bash',
    isError: true,
  });
  assert.equal(out?.head, 'Failed');
  assert.equal(out?.body, 'command exited 1');
  assert.equal(childSessionLatest({ kind: 'error', text: 'boom' })?.head, 'Error');
  assert.equal(childSessionLatest(undefined), null);
});

test('switching to a feature without an exact child clears the previous prompt target', () => {
  const worker = child({ parentAppSessionId: 'mission-parent', childSessionId: 'worker-a' });
  const progress = [
    {
      id: 'progress-a',
      timestamp: '2026-07-30T00:00:00.000Z',
      type: 'worker_started' as const,
      title: 'Feature A worker',
      featureId: 'feature-a',
      workerChildSessionId: 'worker-a',
    },
    {
      id: 'progress-b',
      timestamp: '2026-07-30T00:00:01.000Z',
      type: 'worker_started' as const,
      title: 'Feature B worker',
      featureId: 'feature-b',
      workerChildSessionId: 'missing-worker-b',
    },
  ];

  assert.equal(childSelectionForFeature(progress, [worker], 'feature-a'), 'worker-a');
  assert.equal(childSelectionForFeature(progress, [worker], 'feature-b'), null);
  assert.equal(childSelectionForFeature(progress, [worker], 'feature-without-progress'), null);
  assert.deepEqual(
    visibleSessionTarget(
      'mission-parent',
      null,
      { 'mission-parent': { 'worker-a': worker } },
      { 'mission-parent': { 'worker-a': readyAccess(1) } },
    ),
    { kind: 'primary' },
  );
});

test('child ordering gives unlabeled siblings one stable label across surfaces', () => {
  const later = child({ childSessionId: 'worker-later', startedAt: 20 });
  const earlier = child({ childSessionId: 'worker-earlier', startedAt: 10 });

  const ordered = orderedChildSessions([later, earlier]);
  assert.deepEqual(
    ordered.map((childSession, index) => [
      childSession.childSessionId,
      childSessionLabel(childSession, index),
    ]),
    [
      ['worker-earlier', 'Worker 1'],
      ['worker-later', 'Worker 2'],
    ],
  );
});

test('spawned sessions cover a spawn the store has not registered yet', () => {
  const spawnA = ev({
    id: 'e1',
    sourceSessionId: 'orc',
    role: 'primary',
    ts: 10,
    kind: 'tool_call',
    toolName: 'Task',
    toolUseId: 'tool-a',
    toolArgs: { subagent_type: 'explorer' },
  });
  // Streaming deltas arrive as further tool_call events on the same tool-use id:
  // one agent, with the fields spread across them merged.
  const spawnADelta = { ...spawnA, id: 'e2', ts: 11, toolArgs: { description: 'read the code' } };
  const registered = child({
    parentAppSessionId: 'app-1',
    spawnLink: { kind: 'tool-use', id: 'tool-a' },
    startedAt: 50,
  });

  const pending = spawnedChildSessions([spawnA, spawnADelta], []);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].label, 'explorer');
  assert.equal(pending[0].prompt, 'read the code');
  assert.equal(pending[0].status, 'pending');
  assert.equal(pending[0].streamFidelity, 'state');
  assert.ok(isPendingChildPlaceholder(pending[0]));

  // Registration replaces the placeholder with the stable logical child identity.
  const resolved = spawnedChildSessions([spawnA], [registered]);
  assert.deepEqual(
    resolved.map((childSession) => childSession.childSessionId),
    ['child-a'],
  );
  assert.equal(childSessionKey(pending[0]), 'pending-tool-a');
  assert.equal(childSessionKey(resolved[0]), 'child-a');
  // The spawn event's time is the true start, not the store's later stamp.
  assert.equal(resolved[0].startedAt, 10);

  // A child whose spawn is outside the loaded transcript is kept too.
  const restored = child({
    childSessionId: 'child-old',
    status: 'completed',
    spawnLink: { kind: 'tool-use', id: 'tool-old' },
    startedAt: 5,
  });
  assert.deepEqual(
    spawnedChildSessions([], [restored]).map((childSession) => childSession.childSessionId),
    ['child-old'],
  );
});

test('the panel order pins working agents on top, then newest first, without renumbering', () => {
  const rows = workingFirstChildSessions([
    child({ childSessionId: 'c1', status: 'completed', startedAt: 10 }),
    child({ childSessionId: 'c2', status: 'running', startedAt: 20 }),
    child({ childSessionId: 'c3', status: 'paused', startedAt: 30 }),
    child({ childSessionId: 'c4', status: 'pending', startedAt: 40 }),
    child({ childSessionId: 'c5', status: 'running', startedAt: 50 }),
  ]);
  assert.deepEqual(
    rows.map((row) => [row.child.childSessionId, row.name]),
    [
      // Running first, then newest spawn first; the spawn-order numbering (and
      // the name it produced) survives the reordering.
      ['c5', 'Worker 5'],
      ['c2', 'Worker 2'],
      ['c4', 'Worker 4'],
      ['c3', 'Worker 3'],
      ['c1', 'Worker 1'],
    ],
  );
});

test('queued children are not live and do not sort as working', () => {
  const queued = child({
    childSessionId: 'queued',
    queued: true,
    transcriptAvailable: false,
    startedAt: 50,
  });
  const running = child({ childSessionId: 'live', transcriptAvailable: false, startedAt: 10 });
  assert.equal(childSessionIsLive(queued, { available: true }), false);
  assert.equal(childSessionIsLive(running, { available: true }), true);
  assert.deepEqual(
    workingFirstChildSessions([queued, running]).map((row) => row.child.childSessionId),
    ['live', 'queued'],
  );
});

// Paging older history reveals earlier spawns (often unresolved "Awaiting
// status" placeholders). They must join the list *behind* the newest rows so
// the visible head of the panel never reshuffles while the user reads.
test('older spawns revealed by history paging sort behind the existing rows', () => {
  const recent = [
    child({ childSessionId: 'new-1', status: 'completed', startedAt: 100 }),
    child({ childSessionId: 'new-2', status: 'completed', startedAt: 200 }),
  ];
  const before = workingFirstChildSessions(recent).map((row) => row.child.childSessionId);
  const paged = [
    child({ childSessionId: 'pending-old-1', status: 'pending', startedAt: 1 }),
    child({ childSessionId: 'pending-old-2', status: 'pending', startedAt: 2 }),
    ...recent,
  ];
  const after = workingFirstChildSessions(paged).map((row) => row.child.childSessionId);
  assert.deepEqual(after.slice(0, before.length), before);
  assert.deepEqual(after.slice(before.length), ['pending-old-2', 'pending-old-1']);
});

test('running child activity stays running even without an open runtime', () => {
  const running = child({ spawnLink: { kind: 'tool-use', id: 'tool-a' } });

  // Autonomous subagents never open a runtime; the store status is authoritative.
  assert.equal(
    childSessionActivityForTarget([running], [], { toolUseId: 'tool-a' })?.status,
    'running',
  );
  assert.equal(
    childSessionActivityForTarget([{ ...running, status: 'paused' }], [], {
      toolUseId: 'tool-a',
    })?.status,
    'paused',
  );
});

test('visible child actionability is exact and readiness-gated', () => {
  const running = child();
  const children = {
    'parent-a': { 'child-a': running },
    'parent-b': { 'child-a': { ...running, parentAppSessionId: 'parent-b' } },
  };
  const ready = visibleSessionTarget('parent-a', selection, children, {
    'parent-a': { 'child-a': { state: 'ready', requestId: 'request-a', runtimeGeneration: 4 } },
  });
  assert.equal(ready.kind, 'child');
  if (ready.kind !== 'child') assert.fail('expected exact child target');
  assert.equal(ready.child.parentAppSessionId, 'parent-a');
  assert.equal(ready.canSend, true);
  assert.equal(ready.canInterrupt, true);
  assert.equal(ready.settingsReadiness, 'ready');

  const wrongParent = visibleSessionTarget('parent-b', selection, children, {});
  assert.deepEqual(wrongParent, { kind: 'primary' });
});

test('completed and historical children stay selected while actions are disabled', () => {
  const completed = child({ status: 'completed' });

  for (const access of [readyAccess(2), { state: 'history' as const, requestId: 'history' }]) {
    const target = childTarget(completed, access);
    assert.equal(target.kind, 'child');
    if (target.kind !== 'child') assert.fail('expected selected child target');
    assert.equal(target.childSessionId, 'child-a');
    assert.equal(target.canSend, false);
    assert.equal(target.canInterrupt, false);
    assert.equal(target.settingsReadiness, 'failed');
  }

  const beforeHistorySettlement = childTarget(completed);
  assert.equal(beforeHistorySettlement.kind, 'child');
  if (beforeHistorySettlement.kind !== 'child') assert.fail('expected selected child target');
  assert.equal(beforeHistorySettlement.settingsReadiness, 'failed');
});

test('visible pending state never inherits liveness across the parent-child boundary', () => {
  const readyChild = childTarget(child(), readyAccess(2));
  const historicalChild = childTarget(child(), { state: 'history', requestId: 'history' });

  assert.equal(visibleSessionIsPending(readyChild, false, null), true);
  assert.equal(visibleSessionIsPending(historicalChild, true, 'primary'), false);
  assert.equal(visibleSessionIsPending({ kind: 'primary' }, true, 'primary'), true);
  assert.equal(visibleSessionIsPending({ kind: 'primary' }, true, 'child-a'), false);
  assert.equal(visibleSessionCanCompact(readyChild), false);
  assert.equal(visibleSessionCanCompact(historicalChild), false);
  assert.equal(visibleSessionCanCompact({ kind: 'primary' }), true);
});

type BaselineChange = {
  target?: VisibleSessionTarget;
  composerRevision?: number;
  canCommit?: boolean;
};

/** Starts a child prompt commit on runtime 7, applies `change` while the git baseline is held, then releases it. */
async function commitAcrossBaseline(change: BaselineChange) {
  const captured = childRuntimeSubmitTarget(childTarget(child(), readyAccess(7)));
  assert.ok(captured);
  let current: Required<BaselineChange> = {
    target: childTarget(child(), readyAccess(7)),
    composerRevision: 1,
    canCommit: true,
  };
  const baseline = heldBaseline();
  const effects: string[] = [];
  const committed = commitChildPromptAfterBaseline({
    capturedTarget: captured,
    capturedComposerRevision: 1,
    waitForBaseline: baseline.wait,
    currentTarget: () => current.target,
    currentComposerRevision: () => current.composerRevision,
    canCommit: () => current.canCommit,
    appendTranscript: () => effects.push('append'),
    resetComposer: () => effects.push('reset'),
    sendCommand: () => effects.push('send'),
  });
  current = { ...current, ...change };
  baseline.release();
  return { committed: await committed, effects };
}

test('child prompt commit drops every effect when the runtime closes, is replaced, or an update starts', async () => {
  const changes: Array<[string, BaselineChange]> = [
    ['runtime closed', { target: childTarget(child(), { state: 'closed', requestId: null }) }],
    ['replacement runtime of the same child', { target: childTarget(child(), readyAccess(8)) }],
    ['update started', { canCommit: false }],
  ];
  for (const [label, change] of changes) {
    assert.deepEqual(await commitAcrossBaseline(change), { committed: false, effects: [] }, label);
  }
});

test('child prompt commit preserves a composer revised during git baseline', async () => {
  assert.deepEqual(await commitAcrossBaseline({ composerRevision: 3 }), {
    committed: true,
    effects: ['append', 'send'],
  });
});

test('primary and exact child transcripts remain isolated while switching', () => {
  const text = (id: string, sourceSessionId: string, ts: number) =>
    ev({
      id,
      sourceSessionId,
      role: sourceSessionId.startsWith('child') ? 'worker' : 'primary',
      ts,
      kind: 'text',
      text: id,
    });
  const transcript = [
    { ...text('user', 'user', 1), author: 'user' as const },
    text('primary', 'parent-a', 2),
    text('child-a', 'child-a', 3),
    text('child-b', 'child-b', 4),
  ];

  assert.deepEqual(
    transcriptForVisibleSession(transcript, null).map((event) => event.id),
    ['user', 'primary'],
  );
  assert.deepEqual(
    transcriptForVisibleSession(transcript, 'child-a').map((event) => event.id),
    ['child-a'],
  );
  assert.deepEqual(
    transcriptForVisibleSession(transcript, 'child-b').map((event) => event.id),
    ['child-b'],
  );
});

test('only an unopened child opens itself; released history rehydrates from any settled access', () => {
  // [access, opens the selected child, requests released history]
  const cases: Array<[ChildAccess | undefined, boolean, boolean]> = [
    [undefined, true, true],
    [{ state: 'opening', requestId: 'request-a' }, false, false],
    [{ state: 'ready', requestId: 'request-a', runtimeGeneration: 2 }, false, true],
    [{ state: 'history', requestId: 'request-a' }, false, true],
    [{ state: 'failed', requestId: 'request-a' }, false, true],
    [{ state: 'closed', requestId: null }, false, true],
  ];
  for (const [access, opens, requestsHistory] of cases) {
    const label = access?.state ?? 'no access';
    assert.equal(shouldOpenSelectedChild(access), opens, label);
    assert.equal(shouldRequestReleasedChildHistory(access), requestsHistory, label);
  }
});

test('feature navigation uses only the latest exact progress child link', () => {
  const progress = [
    { featureId: 'feature-a', workerChildSessionId: 'worker-a' },
    { featureId: 'feature-b', workerChildSessionId: 'worker-b' },
    { featureId: 'feature-a', workerChildSessionId: 'worker-a-2' },
    { featureId: 'feature-c' },
  ].map((entry, index) => ({
    type: 'worker_started' as const,
    timestamp: `2026-07-29T10:0${index}:00.000Z`,
    ...entry,
  }));

  assert.equal(childSessionIdForFeature(progress, 'feature-a'), 'worker-a-2');
  assert.equal(childSessionIdForFeature(progress, 'feature-c'), undefined);
});

test('child metadata shows provider-managed autonomy unless the runtime confirmed one', () => {
  const first = child({ childSessionId: 'worker-a', modelId: 'model-a', reasoningEffort: 'high' });
  const second = {
    ...first,
    childSessionId: 'worker-b',
    status: 'completed' as const,
    transcriptAvailable: false,
  };

  // Without a live runtime confirmation the child shows "provider managed",
  // never a parent or guessed autonomy value.
  assert.equal(
    childSessionMeta(first, 'Model A'),
    'worker · running · Model A · high · provider managed · transcript',
  );
  assert.equal(
    childSessionMeta(second, 'Model A'),
    'worker · completed · Model A · high · provider managed · no transcript',
  );
  assert.equal(
    childSessionMeta({ ...first, autonomy: 'low' as const }, 'Model A'),
    'worker · running · Model A · high · low autonomy · transcript',
  );
});

test('spawn navigation resolves only an exact tool-use link', () => {
  const sibling = { status: 'completed' as const, label: 'same label' };
  const childSessions = [
    child({
      ...sibling,
      childSessionId: 'worker-a',
      spawnLink: { kind: 'tool-use', id: 'tool-a' },
    }),
    child({
      ...sibling,
      childSessionId: 'worker-b',
      spawnLink: { kind: 'tool-use', id: 'tool-b' },
    }),
  ];

  assert.equal(
    findChildSessionForTarget(childSessions, {
      toolUseId: 'tool-b',
      label: 'same label',
    })?.childSessionId,
    'worker-b',
  );
  assert.equal(
    findChildSessionForTarget(childSessions, {
      label: 'same label',
    }),
    undefined,
  );
});
