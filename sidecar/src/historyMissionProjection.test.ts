import assert from 'node:assert/strict';
import test from 'node:test';

import { projectMissionProgress, type PersistedChildSession } from './history.js';

const workerA: PersistedChildSession = {
  parentAppSessionId: 'parent-a',
  childSessionId: 'child-a',
  providerSessionId: 'provider-current-a',
  role: 'worker',
  status: 'completed',
  modelId: 'model',
  spawnLink: { kind: 'spawn', id: 'spawn-a' },
  transcriptAvailable: true,
  updatedAt: 1,
};

test('projects historical Mission progress through the exact persisted spawn link', () => {
  const progress = projectMissionProgress(
    [
      {
        type: 'worker_started',
        timestamp: '1',
        workerProviderSessionId: 'provider-old-a',
        spawnId: 'spawn-a',
      },
      {
        type: 'worker_selected_feature',
        timestamp: '2',
        workerProviderSessionId: 'provider-old-a',
        featureId: 'feature-a',
      },
      {
        type: 'worker_failed',
        timestamp: '3',
        spawnId: 'spawn-a',
        message: 'failed',
      },
      {
        type: 'worker_started',
        timestamp: '4',
        workerProviderSessionId: 'provider-current-a',
        spawnId: 'spawn-a',
      },
      {
        type: 'worker_started',
        timestamp: '5',
        workerProviderSessionId: 'provider-old-a',
        spawnId: 'spawn-a',
      },
      {
        type: 'worker_failed',
        timestamp: '6',
        workerProviderSessionId: 'provider-old-a',
        spawnId: 'spawn-a',
        message: 'stale failure',
      },
    ],
    [workerA],
  );

  assert.deepEqual(progress, [
    {
      type: 'worker_started',
      timestamp: '1',
      workerChildSessionId: 'child-a',
    },
    {
      type: 'worker_selected_feature',
      timestamp: '2',
      featureId: 'feature-a',
      workerChildSessionId: 'child-a',
    },
    {
      type: 'worker_failed',
      timestamp: '3',
      message: 'failed',
      workerChildSessionId: 'child-a',
    },
    {
      type: 'worker_started',
      timestamp: '4',
      workerChildSessionId: 'child-a',
    },
    {
      type: 'worker_started',
      timestamp: '5',
    },
    {
      type: 'worker_failed',
      timestamp: '6',
      message: 'stale failure',
    },
  ]);
  assert.equal(JSON.stringify(progress).includes('provider-old-a'), false);
  assert.equal(JSON.stringify(progress).includes('spawn-a'), false);
});

test('progress names no child without exact spawn proof under its own parent', () => {
  const started = (provider: string, spawnId: string, timestamp = '1') => ({
    type: 'worker_started' as const,
    timestamp,
    workerProviderSessionId: provider,
    spawnId,
  });
  // The same child id and provider recorded under another parent's spawn.
  const foreign: PersistedChildSession = {
    ...workerA,
    parentAppSessionId: 'parent-b',
    spawnLink: { kind: 'spawn', id: 'spawn-b' },
  };
  assert.deepEqual(projectMissionProgress([started('provider-old-a', 'spawn-a')], [foreign]), [
    { type: 'worker_started', timestamp: '1' },
  ]);

  // A provider identity alone, without the WorkerStarted that ties it to a spawn.
  assert.deepEqual(
    projectMissionProgress(
      [
        {
          type: 'worker_selected_feature',
          timestamp: '1',
          workerProviderSessionId: 'provider-current-a',
          featureId: 'feature-a',
        },
      ],
      [workerA],
    ),
    [{ type: 'worker_selected_feature', timestamp: '1', featureId: 'feature-a' }],
  );

  // One provider rebound to a second persisted spawn.
  const workerB: PersistedChildSession = {
    ...workerA,
    childSessionId: 'child-b',
    providerSessionId: 'provider-current-b',
    spawnLink: { kind: 'spawn', id: 'spawn-b' },
  };
  assert.deepEqual(
    projectMissionProgress(
      [started('provider-shared', 'spawn-a'), started('provider-shared', 'spawn-b', '2')],
      [workerA, workerB],
    ).map((entry) => entry.workerChildSessionId),
    ['child-a', undefined],
  );
});
