import assert from 'node:assert/strict';
import test from 'node:test';

import { HotPathMetrics } from './hotPathMetrics.js';

test('nothing is reported before enable, enable keeps its start, and event-loop sampling is opt-in', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000 });
  const metrics = new HotPathMetrics();
  const before = metrics.snapshot();
  assert.equal(before.eventLoop, null);
  assert.equal(before.resources, null);
  assert.equal(before.uptimeMs, 0);

  metrics.enable();
  t.mock.timers.tick(15);
  metrics.enable();
  assert.equal(metrics.snapshot().startedAt, 1_000);
  assert.equal(metrics.snapshot().uptimeMs, 15);
  assert.equal(metrics.snapshot().eventLoop, null);

  metrics.enableEventLoop();
  const armed = metrics.snapshot().eventLoop;
  assert.ok(armed !== null);
  assert.ok(Number.isFinite(armed.meanMs));
  metrics.enableEventLoop();
  assert.ok(metrics.snapshot().eventLoop !== null);
  metrics.disable();
  assert.equal(metrics.snapshot().eventLoop, null);
});

test('recorded samples reach the snapshot, and reset clears them so runs stay independent', () => {
  const metrics = new HotPathMetrics();
  metrics.enable();
  metrics.recordNormalize(0.5);
  metrics.recordNormalize(1.5);
  metrics.recordPersistenceStartup(4);
  metrics.recordPersist(2);
  metrics.recordPersistenceBoundary(7);
  metrics.recordPersistenceFailure();
  metrics.recordPersistenceRecovery();
  metrics.recordEmit(3);
  // Transport takes explicit aggregate bytes and send operations.
  metrics.recordTransport(0.25, 1_000, 1);
  metrics.recordTransport(1, 300, 3);
  metrics.recordCoalesce(4);
  metrics.recordTransportBatch({
    logicalEvents: 10,
    deliveredEvents: 7,
    bytes: 1_200,
    queueDelayMs: 16,
    immediate: false,
  });
  metrics.recordTransportBatch({
    logicalEvents: 1,
    deliveredEvents: 1,
    bytes: 200,
    queueDelayMs: 0,
    immediate: true,
  });
  metrics.recordTransportQueue({
    pendingEvents: 12,
    pendingEstimatedBytes: 4_096,
    oldestPendingAgeMs: 8,
  });
  metrics.recordTransportQueue({
    pendingEvents: 0,
    pendingEstimatedBytes: 0,
    oldestPendingAgeMs: 0,
  });
  metrics.recordClientBufferedAmount(10_000);
  metrics.recordBackpressureDisconnect(20_000);
  metrics.recordReplay(2, 7, 1_400);
  metrics.recordReplayBuffer(4, 2_048);

  const snapshot = metrics.snapshot();
  assert.deepEqual(snapshot.counters, {
    normalized: 2,
    persisted: 1,
    persistenceFailures: 1,
    persistenceRecoveries: 1,
    emitted: 1,
    transportSends: 4,
    coalesceFlushes: 1,
    transportBatches: 2,
    transportLogicalEvents: 11,
    transportDeliveredEvents: 8,
    transportImmediateBatches: 1,
    transportReplayedBatches: 2,
    transportReplayedEvents: 7,
    transportBackpressureDisconnects: 1,
  });
  assert.equal(snapshot.histograms.normalizeMs.p50Ms, 0.5);
  assert.equal(snapshot.histograms.persistenceStartupMs.maxMs, 4);
  assert.equal(snapshot.histograms.persistMs.maxMs, 2);
  assert.equal(snapshot.histograms.persistenceBoundaryMs.maxMs, 7);
  assert.equal(snapshot.histograms.coalesceMerged.maxMs, 4);
  assert.equal(snapshot.histograms.transportBatchEvents.p50Ms, 1);
  assert.equal(snapshot.histograms.transportBatchEvents.maxMs, 7);
  assert.equal(snapshot.transport.bytesTotal, 1_300);
  assert.ok(snapshot.transport.bytesPerSecondAvg > 0);
  assert.equal(snapshot.transport.eventReductionRatio, 0.273);
  assert.equal(snapshot.transport.queue.pendingEvents, 0);
  assert.equal(snapshot.transport.queue.pendingEventsMax, 12);
  assert.equal(snapshot.transport.queue.pendingEstimatedBytesMax, 4_096);
  assert.equal(snapshot.transport.clientBufferedBytesMax, 20_000);
  assert.equal(snapshot.transport.replayBytesTotal, 1_400);
  assert.equal(snapshot.transport.replayBuffer.batches, 4);
  assert.ok(snapshot.process.rssBytes > 0);
  assert.ok(snapshot.process.cpuUserMs >= 0);

  metrics.reset();
  const cleared = metrics.snapshot();
  assert.ok(Object.values(cleared.counters).every((count) => count === 0));
  assert.equal(cleared.transport.bytesTotal, 0);
  assert.equal(cleared.transport.eventReductionRatio, 0);
  assert.ok(Object.values(cleared.transport.queue).every((value) => value === 0));
  assert.ok(Object.values(cleared.transport.replayBuffer).every((value) => value === 0));
  assert.equal(cleared.eventLoop, null);
  assert.equal(cleared.uptimeMs, 0);
});

test('gauge provider supplies resource counts and failures degrade to null', () => {
  const metrics = new HotPathMetrics();
  metrics.enable();
  const counts = {
    livePrimarySessions: 2,
    childAgentsTotal: 7,
    childAgentsActive: 3,
    childAgentsLive: 2,
    childAgentsQueued: 1,
    contextPollers: 4,
    contextPollersActive: 1,
    autoCompactionWatchdogs: 1,
    sessionFileWatchers: 1,
  };
  metrics.setGaugeProvider(() => counts);
  assert.deepEqual(metrics.snapshot().resources, counts);

  metrics.setGaugeProvider(() => {
    throw new Error('gauge blew up');
  });
  assert.equal(metrics.snapshot().resources, null);

  metrics.clearGaugeProvider();
  assert.equal(metrics.snapshot().resources, null);
});

test('transport byte samples wrap the ring without losing totals', () => {
  const metrics = new HotPathMetrics();
  metrics.enable();
  const sends = 10_500;
  for (let index = 0; index < sends; index += 1) metrics.recordTransport(0.1, 2, 1);

  const snapshot = metrics.snapshot();
  assert.equal(snapshot.counters.transportSends, sends);
  assert.equal(snapshot.transport.bytesTotal, sends * 2);
  assert.ok(
    Number.isFinite(snapshot.transport.bytesPerSecondRecent) &&
      snapshot.transport.bytesPerSecondRecent > 0,
  );
});
