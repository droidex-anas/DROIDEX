import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reducer, type AppState } from './useStore';
import type { ContextStatsSnapshot, TranscriptEvent } from '../types/bridge';
import { sessionSummary } from '../test/sessionSummary';
import { textEvent } from '../test/textEvent';
import { childSummary } from '../test/childSummary';

const session = (autoCompactions = 0) =>
  sessionSummary('m1', {
    providerSessionId: 'provider-1',
    title: 'Context test',
    cwd: '/tmp',
    autonomy: 'off',
    phase: 'running',
    contextTokens: autoCompactions ? 0 : 100_000,
    contextAccuracy: autoCompactions ? undefined : 'exact',
    maxContextTokens: 100_000,
    autoCompactions,
    updatedAt: autoCompactions + 1,
  });

const snapshot = (used: number): ContextStatsSnapshot => ({
  used,
  remaining: 100_000 - used,
  limit: 100_000,
  accuracy: 'exact',
  updatedAt: '2026-07-11T07:49:46.824Z',
});

function longTranscriptWithHistoricalCompactions(): TranscriptEvent[] {
  return Array.from({ length: 30_002 }, (_, index) =>
    index < 2
      ? textEvent(`restored-compaction-${String(index)}`, {
          appSessionId: 'm1',
          ts: index,
          kind: 'compaction',
          text: undefined,
        })
      : textEvent(`event-${String(index)}`, { appSessionId: 'm1', ts: index }),
  );
}

test('SESSION_UPDATED invalidates context stats only when the compaction generation advances', () => {
  const start: AppState = {
    ...initialState,
    sessions: {
      m1: session(),
      m2: {
        ...session(),
        appSessionId: 'm2',
        providerSessionId: 'provider-2',
      },
    },
    contextStats: {
      primary: { m1: snapshot(100_000), m2: snapshot(20_000) },
      child: {},
    },
  };

  const next = reducer(start, { type: 'SESSION_UPDATED', session: session(1) });

  assert.equal(next.contextStats.primary.m1, undefined);
  assert.equal(next.contextStats.primary.m2?.used, 20_000);
  assert.equal(next.sessions.m1.contextTokens, 0);
  assert.equal(next.sessions.m1.autoCompactions, 1);

  // An ordinary update in the same generation keeps the reading.
  const renamed = reducer(start, {
    type: 'SESSION_UPDATED',
    session: { ...session(), title: 'Renamed', updatedAt: 2 },
  });
  assert.equal(renamed.contextStats.primary.m1?.used, 100_000);
});

test('post-compaction context update installs the fresh lower reading', () => {
  const start: AppState = {
    ...initialState,
    sessions: { m1: session() },
    contextStats: { primary: { m1: snapshot(100_000) }, child: {} },
  };
  const compacted = reducer(start, { type: 'SESSION_UPDATED', session: session(1) });

  const refreshed = reducer(compacted, {
    type: 'CONTEXT_UPDATED',
    appSessionId: 'm1',
    sourceSessionId: 'provider-2',
    stats: snapshot(35_066),
  });

  assert.equal(refreshed.contextStats.primary.m1?.used, 35_066);
  assert.equal(refreshed.sessions.m1.contextTokens, 35_066);
});

/** A session whose meter reads full, so a restored compaction must clear it. */
function fullMeterState(transcript: TranscriptEvent[] = []): AppState {
  return {
    ...initialState,
    sessions: { m1: session() },
    transcripts: { m1: transcript },
    contextStats: { primary: { m1: snapshot(100_000) }, child: {} },
  };
}

function assertMeterReset(state: AppState, autoCompactions: number): void {
  assert.equal(state.sessions.m1.autoCompactions, autoCompactions);
  assert.equal(state.sessions.m1.contextTokens, 0);
  assert.equal(state.contextStats.primary.m1, undefined);
}

test('long restores count compactions released from the retained transcript tail', () => {
  const restored = longTranscriptWithHistoricalCompactions();
  const replaced = reducer(fullMeterState(), {
    type: 'SESSION_HISTORY',
    appSessionId: 'm1',
    progress: [],
    transcripts: restored,
    mode: 'replace',
  });
  const prepended = reducer(fullMeterState(restored.slice(2_000)), {
    type: 'SESSION_HISTORY',
    appSessionId: 'm1',
    progress: [],
    transcripts: restored.slice(0, 2_000),
    mode: 'prepend',
    olderCursor: 'older-page',
  });

  for (const next of [replaced, prepended]) {
    assert.ok(next.transcripts.m1.length <= 1_200);
    assert.equal(
      next.transcripts.m1.some((event) => event.kind === 'compaction'),
      false,
    );
    assertMeterReset(next, 2);
  }
});

test('live and provider-history dividers restore as one compaction generation', () => {
  const restored = (id: string, role: TranscriptEvent['role'] = 'primary'): TranscriptEvent => ({
    id,
    appSessionId: 'm1',
    sourceSessionId: role === 'primary' ? 'primary' : 'worker-1',
    role,
    ts: 1,
    kind: 'compaction',
  });

  const next = reducer(fullMeterState(), {
    type: 'SESSION_HISTORY',
    appSessionId: 'm1',
    progress: [],
    transcripts: [
      restored('compaction-m1-summary-1'),
      restored('provider-session:compaction'),
      restored('compaction-worker-1-summary-1', 'worker'),
    ],
    mode: 'replace',
    hasMore: false,
  });

  assertMeterReset(next, 1);
});

test('a delayed session summary cannot roll back a restored compaction generation', () => {
  const restored = {
    ...session(4),
    contextTokens: 25_000,
    contextRemainingTokens: 75_000,
    contextAccuracy: 'estimated' as const,
    contextUpdatedAt: '2026-08-05T08:00:00.000Z',
  };
  const start: AppState = {
    ...initialState,
    sessions: { m1: restored },
  };

  const next = reducer(start, { type: 'SESSION_UPDATED', session: session(0) });

  assert.equal(next.sessions.m1.autoCompactions, 4);
  assert.equal(next.sessions.m1.contextTokens, 25_000);
  assert.equal(next.sessions.m1.contextRemainingTokens, 75_000);
  assert.equal(next.sessions.m1.contextAccuracy, 'estimated');
  assert.equal(next.sessions.m1.contextUpdatedAt, '2026-08-05T08:00:00.000Z');
});

test('a replaced or closed child runtime clears only that child context snapshot', () => {
  const child = childSummary('parent', 'child', { status: 'running', modelId: 'model-child' });
  const start: AppState = {
    ...initialState,
    childSessions: { parent: { child } },
    childRuntime: { parent: { child: { available: true, runtimeGeneration: 3 } } },
    contextStats: {
      primary: {},
      child: {
        parent: { child: snapshot(80_000), sibling: snapshot(20_000) },
        other: { child: snapshot(30_000) },
      },
    },
  };
  // [runtime still available, generation]: a replacement, then a same-generation close.
  for (const [runtimeAvailable, runtimeGeneration] of [
    [true, 4],
    [false, 3],
  ] as const) {
    const next = reducer(start, {
      type: 'SESSION_CHILD',
      child,
      runtimeAvailable,
      runtimeGeneration,
    });
    const label = `available=${String(runtimeAvailable)}`;
    assert.equal(next.contextStats.child.parent?.child, undefined, label);
    assert.equal(next.contextStats.child.parent?.sibling?.used, 20_000, label);
    assert.equal(next.contextStats.child.other?.child?.used, 30_000, label);
  }
});
