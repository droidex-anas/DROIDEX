import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import {
  LiveRuntimeJournal,
  liveRuntimeJournalPath,
  type LiveChildIdentity,
  type LiveSessionIdentity,
} from './liveRuntimeJournal.js';
import { SessionAdoption } from './sessionAdoption.js';
import { SESSION_RUNTIME_IDLE_RETIREMENT_MS } from './sessionRuntimeRetirement.js';
import type { SessionSummary } from './protocol.js';
import { sessionSummary } from './testing/sessionSummaryFixture.js';

const NOW = 4_000_000_000;

type AdoptionOptions = ConstructorParameters<typeof SessionAdoption>[0];

function summary(appSessionId: string, phase: SessionSummary['phase'] = 'running'): SessionSummary {
  return sessionSummary({
    appSessionId,
    providerSessionId: `provider-${appSessionId}`,
    phase,
    streaming: phase === 'running',
  });
}

/** A live-runtime journal in a scratch directory removed after the test. */
function scratchJournal(t: TestContext): { dir: string; journal: LiveRuntimeJournal } {
  const dir = mkdtempSync(join(tmpdir(), 'adoption-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, journal: new LiveRuntimeJournal(liveRuntimeJournalPath(dir)) };
}

/** Adoption over `journal` with nothing live, resuming nothing, unless overridden. */
function createAdoption(
  journal: LiveRuntimeJournal,
  overrides: Partial<AdoptionOptions> = {},
): SessionAdoption {
  return new SessionAdoption({
    journal,
    registry: {
      liveSessionsSnapshot: () => [],
      getCanonicalSummary: () => undefined,
      getLive: () => undefined,
      updateSummary: () => undefined,
    },
    lifecycle: { resume: async () => false },
    liveChildren: () => [],
    recordedProcesses: () => [],
    reapProcesses: () => Promise.resolve(),
    persistSummaries: () => undefined,
    appendStatus: () => undefined,
    sessionRuntimeIdleMs: SESSION_RUNTIME_IDLE_RETIREMENT_MS,
    now: () => NOW,
    ...overrides,
  });
}

function runningIdentity(appSessionId: string): LiveSessionIdentity {
  return {
    appSessionId,
    providerSessionId: `provider-${appSessionId}`,
    phase: 'running',
    streaming: true,
    lastActiveAt: 1,
  };
}

test('failed provider adoption marks the session interrupted instead of running', async (t) => {
  const { journal } = scratchJournal(t);
  journal.write({ sessions: [runningIdentity('app-1')], children: [], processes: [] });
  const historical = summary('app-1');
  const persisted: SessionSummary[] = [];
  const statuses: string[] = [];
  const adoption = createAdoption(journal, {
    registry: {
      liveSessionsSnapshot: () => [],
      getCanonicalSummary: () => historical,
      getLive: () => undefined,
      updateSummary: () => undefined,
    },
    persistSummaries: (sessions) => {
      persisted.push(...sessions);
    },
    appendStatus: (_appSessionId, text) => {
      statuses.push(text);
    },
  });

  const result = await adoption.adopt();
  assert.equal(result.interrupted.length, 1);
  assert.equal(persisted[0]?.phase, 'paused');
  assert.equal(persisted[0]?.streaming, false);
  assert.match(persisted[0]?.interruptReason ?? '', /could not reconnect/);
  assert.equal(statuses.length, 1);
});

test('a resumed in-flight session is paused with an interrupt reason', async (t) => {
  const { journal } = scratchJournal(t);
  journal.write({ sessions: [runningIdentity('app-2')], children: [], processes: [] });
  const live = { summary: summary('app-2') };
  const persisted: SessionSummary[] = [];
  const adoption = createAdoption(journal, {
    registry: {
      liveSessionsSnapshot: () => [live],
      getCanonicalSummary: () => live.summary,
      getLive: () => live,
      updateSummary: (_id, patch) => {
        live.summary = { ...live.summary, ...patch };
      },
    },
    lifecycle: { resume: async () => true },
    persistSummaries: (sessions) => {
      persisted.push(...sessions);
    },
  });

  const result = await adoption.adopt();
  assert.equal(result.interrupted[0]?.reason.includes('did not continue'), true);
  assert.equal(live.summary.phase, 'paused');
  assert.equal(live.summary.streaming, false);
  assert.equal(typeof live.summary.interruptReason, 'string');
  // A live summary has one owner, so adoption never stores a copy of its own.
  assert.deepEqual(persisted, []);
});

test('running children are marked interrupted and written out of the live journal', async (t) => {
  const { journal } = scratchJournal(t);
  const child = {
    parentAppSessionId: 'app-3',
    childSessionId: 'child-1',
    status: 'running' as const,
  };
  journal.write({ sessions: [], children: [child], processes: [] });
  const liveChildren = [child];
  const adoption = createAdoption(journal, { liveChildren: () => liveChildren });

  const result = await adoption.adopt();
  assert.equal(result.interrupted[0]?.childSessionId, 'child-1');
  assert.match(result.interrupted[0]?.reason ?? '', /child agent did not continue/);

  liveChildren.length = 0;
  adoption.persistLiveSet();
  assert.deepEqual(journal.read().children, []);
});

// Adoption spawns a provider process per journalled session. These cover the
// sessions it must not spawn one for, because the first retirement sweep would
// release it moments later, and the ones it must still spawn one for however
// long they have been idle.
interface BootCase {
  identity?: Partial<LiveSessionIdentity>;
  children?: LiveChildIdentity[];
}

function bootAdoption(t: TestContext, options: BootCase = {}) {
  const identity: LiveSessionIdentity = {
    appSessionId: 'app-boot',
    providerSessionId: 'provider-app-boot',
    phase: 'completed',
    streaming: false,
    lastActiveAt: NOW - SESSION_RUNTIME_IDLE_RETIREMENT_MS - 1,
    ...options.identity,
  };
  const { journal } = scratchJournal(t);
  journal.write({ sessions: [identity], children: options.children ?? [], processes: [] });
  const resumed: string[] = [];
  const adoption = createAdoption(journal, {
    registry: {
      liveSessionsSnapshot: () => [],
      getCanonicalSummary: () => summary(identity.appSessionId, 'completed'),
      getLive: () => undefined,
      updateSummary: () => undefined,
    },
    lifecycle: {
      resume: async (appSessionId: string) => {
        resumed.push(appSessionId);
        return true;
      },
    },
  });
  return { adoption, journal, resumed };
}

test('a settled session idle past the budget is not given a provider process at boot', async (t) => {
  const { adoption, journal, resumed } = bootAdoption(t);
  const result = await adoption.adopt();

  assert.deepEqual(resumed, []);
  // Nothing was interrupted, so the user is told nothing: the session is a
  // reopenable entry with its transcript, exactly as a retired one is.
  assert.deepEqual(result.interrupted, []);
  assert.deepEqual(journal.read().sessions, []);
});

test('boot resumes only the three most recently active settled sessions and an in-flight session', async (t) => {
  const { journal } = scratchJournal(t);
  const sessions = [5, 1, 4, 2, 3].map(
    (minutesIdle): LiveSessionIdentity => ({
      appSessionId: `settled-${minutesIdle}`,
      providerSessionId: `provider-settled-${minutesIdle}`,
      phase: 'completed',
      streaming: false,
      lastActiveAt: NOW - minutesIdle * 60_000,
    }),
  );
  sessions.push(runningIdentity('streaming'));
  journal.write({ sessions, children: [], processes: [] });
  const resumed: string[] = [];
  const adoption = createAdoption(journal, {
    lifecycle: {
      resume: async (appSessionId) => {
        resumed.push(appSessionId);
        return true;
      },
    },
  });

  await adoption.adopt();

  assert.deepEqual(resumed, ['settled-1', 'settled-2', 'settled-3', 'streaming']);
});

test('a session still needed is given its runtime back however long it has been idle', async (t) => {
  const cases: [string, BootCase][] = [
    [
      'inside the budget',
      { identity: { lastActiveAt: NOW - SESSION_RUNTIME_IDLE_RETIREMENT_MS + 60_000 } },
    ],
    ['interrupted mid-turn', { identity: { phase: 'running', streaming: true } }],
    ['awaiting plan approval', { identity: { phase: 'awaiting_plan_approval' } }],
    [
      'children still running',
      {
        children: [
          { parentAppSessionId: 'app-boot', childSessionId: 'child-1', status: 'running' },
        ],
      },
    ],
  ];
  for (const [label, options] of cases) {
    const { adoption, resumed } = bootAdoption(t, options);
    await adoption.adopt();
    assert.deepEqual(resumed, ['app-boot'], label);
  }
});

test('the journal carries when each live session was last active, and drops an entry without it', (t) => {
  const { dir, journal } = scratchJournal(t);
  const live = { summary: { ...summary('app-journal', 'completed'), updatedAt: 12_345 } };
  const adoption = createAdoption(journal, {
    registry: {
      liveSessionsSnapshot: () => [live],
      getCanonicalSummary: () => live.summary,
      getLive: () => live,
      updateSummary: () => undefined,
    },
    lifecycle: { resume: async () => true },
  });

  adoption.persistLiveSet();
  assert.equal(journal.read().sessions[0]?.lastActiveAt, 12_345);

  // A journal entry without it cannot be judged against the budget, so it is
  // not a journal entry, though the children journalled beside it are kept.
  // Only DROIDEX writes this file.
  const withoutLastActive = {
    appSessionId: 'app-journal',
    providerSessionId: 'provider-app-journal',
    phase: 'completed',
    streaming: false,
  };
  const child = {
    parentAppSessionId: 'app-journal',
    childSessionId: 'worker-1',
    status: 'running',
  };
  writeFileSync(
    liveRuntimeJournalPath(dir),
    JSON.stringify({ sessions: [withoutLastActive], children: [child] }),
  );
  assert.deepEqual(journal.read().sessions, []);
  assert.deepEqual(
    journal.read().children.map((entry) => entry.childSessionId),
    ['worker-1'],
  );

  // A missing journal is an empty live set.
  assert.deepEqual(new LiveRuntimeJournal(liveRuntimeJournalPath(join(dir, 'none'))).read(), {
    sessions: [],
    children: [],
    processes: [],
  });
});
