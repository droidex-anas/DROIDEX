import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { SessionSummary } from '@droidex/protocol';
import { persistTestChild, persistTestSummaries } from './testing/historyPersistenceFixture.js';
import { sessionSummary } from './testing/sessionSummaryFixture.js';

const originalHome = process.env.HOME;
const home = mkdtempSync(join(tmpdir(), 'droid-mission-history-'));
process.env.HOME = home;

const { HistoryIndex, hydrateHistoricalSession, loadMissionControlSessions } =
  await import('./history.js');

test.after(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(home, { recursive: true, force: true });
});

test('Mission hydration restores logical child progress beneath the exact parent', () => {
  const missionDir = join(home, '.factory', 'missions', 'mission-1');
  mkdirSync(missionDir, { recursive: true });
  writeFileSync(
    join(missionDir, 'state.json'),
    JSON.stringify({
      missionId: 'mission-1',
      baseSessionId: 'parent-app',
      state: 'completed',
    }),
  );
  writeFileSync(
    join(missionDir, 'progress_log.jsonl'),
    [
      {
        type: 'worker_started',
        timestamp: '2026-07-29T00:00:00.000Z',
        workerSessionId: 'provider-old',
        spawnId: 'spawn-1',
      },
      {
        type: 'worker_completed',
        timestamp: '2026-07-29T00:01:00.000Z',
        workerSessionId: 'provider-old',
        featureId: 'feature-1',
      },
    ]
      .map((entry) => JSON.stringify(entry))
      .join('\n'),
  );

  const history = new HistoryIndex();
  persistTestSummaries([missionSummary()]);
  persistTestChild({
    parentAppSessionId: 'parent-app',
    childSessionId: 'child-stable',
    providerSessionId: 'provider-current',
    role: 'worker',
    status: 'completed',
    modelId: 'model',
    spawnLink: { kind: 'spawn', id: 'spawn-1' },
    transcriptAvailable: true,
    updatedAt: 2,
  });
  persistTestChild({
    parentAppSessionId: 'other-parent',
    childSessionId: 'child-stable',
    providerSessionId: 'provider-old',
    role: 'worker',
    status: 'completed',
    modelId: 'model',
    spawnLink: { kind: 'spawn', id: 'other-spawn' },
    transcriptAvailable: true,
    updatedAt: 2,
  });
  history.close();

  const hydrated = hydrateHistoricalSession('mission-1');
  assert.deepEqual(
    hydrated.progress.map((entry) => entry.workerChildSessionId),
    ['child-stable', 'child-stable'],
  );
  assert.equal(JSON.stringify(hydrated.progress).includes('provider-old'), false);
  assert.equal(JSON.stringify(hydrated.progress).includes('spawn-1'), false);
});

test('Mission enumeration keeps healthy missions beside an unreadable sibling', (t) => {
  const warnings = t.mock.method(console, 'warn', () => undefined);
  const brokenDir = join(home, '.factory', 'missions', 'a-broken');
  mkdirSync(brokenDir, { recursive: true });
  writeFileSync(join(brokenDir, 'state.json'), '{"baseSessionId": "broken-app", "secret-partial');
  const healthyDir = join(home, '.factory', 'missions', 'mission-healthy');
  mkdirSync(healthyDir, { recursive: true });
  writeFileSync(
    join(healthyDir, 'state.json'),
    JSON.stringify({
      missionId: 'mission-healthy',
      baseSessionId: 'healthy-app',
      state: 'completed',
      workingDirectory: '/work/project',
    }),
  );

  const listedIds = loadMissionControlSessions().map(({ summary }) => summary.missionId);
  assert.ok(listedIds.includes('mission-healthy'));
  assert.equal(listedIds.includes('a-broken'), false);
  assert.deepEqual(
    loadMissionControlSessions({ workspaceCwds: ['/work/project'] }).map(
      ({ summary }) => summary.missionId,
    ),
    ['mission-healthy'],
  );
  assert.doesNotThrow(() => hydrateHistoricalSession('healthy-app'));
  assert.throws(
    () => hydrateHistoricalSession('broken-app'),
    (error: Error) =>
      error.message.includes('Mission history not found for broken-app') &&
      error.message.includes(brokenDir) &&
      !error.message.includes('secret-partial'),
  );

  assert.equal(warnings.mock.callCount(), 1);
  const warning = String(warnings.mock.calls[0]?.arguments[0]);
  assert.ok(warning.includes(brokenDir));
  assert.equal(warning.includes('secret-partial'), false);
});

function missionSummary(): SessionSummary {
  return sessionSummary({
    appSessionId: 'parent-app',
    providerSessionId: 'parent-provider',
    missionId: 'mission-1',
    sessionPurpose: 'mission-control',
    interactionMode: 'agi',
    workspaceKind: 'none',
    autonomy: 'medium',
    phase: 'completed',
    updatedAt: 2,
  });
}
