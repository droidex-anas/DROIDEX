import assert from 'node:assert/strict';
import test from 'node:test';

import { renderReportMarkdown } from './report.js';
import { acceptReplayWireMessage, runReplay } from './runner.js';
import { resolveScenario } from './scenario.js';

// A tiny real-pipeline run: the fake provider streams through the actual
// normalize → coalesce → SQLite → WebSocket path, so this proves the harness
// wiring end to end without turning the suite into a benchmark.
test('replay run drives the real sidecar pipeline and reports measurements', async () => {
  const report = await runReplay({
    // Named long-history, so the report also carries its half-to-half drift.
    spec: resolveScenario('smoke', {
      seed: 13,
      name: 'long-history',
      deltasPerTurn: 40,
      eventsPerSecond: 80,
      coalesceMs: 10,
    }),
  });

  assert.ok(report.durationMs > 0);
  assert.ok(report.providerEvents >= 25);
  assert.ok(report.client.appendedReceived >= 3, 'some appended events must reach the client');
  assert.ok(report.client.markerSamples >= 2, 'tool markers must produce exact e2e samples');
  assert.ok(report.client.appendToReceiveMs.count === report.client.appendedReceived);
  assert.ok(report.client.providerToReceiveMs.p95Ms !== undefined);
  assert.ok(report.client.bytesReceived > 0);

  const sidecar = report.sidecar;
  assert.ok(sidecar.counters.normalized >= report.providerEvents);
  assert.ok(sidecar.counters.persisted >= report.client.appendedReceived);
  assert.ok(sidecar.histograms.persistMs.count > 0);
  assert.ok(sidecar.histograms.persistMs.count <= sidecar.counters.persisted);
  assert.ok(sidecar.histograms.transportMs.count > 0);
  assert.ok(sidecar.eventLoop !== null);
  assert.ok(sidecar.resources !== null);
  assert.ok(sidecar.resources.livePrimarySessions >= 1);

  assert.ok(report.budgets.results.length > 0);
  assert.ok(report.gates.results.length > 0);
  for (const result of report.budgets.results) {
    assert.ok(['pass', 'fail', 'unmeasured'].includes(result.status));
    assert.ok(result.budgetMs > 0);
  }

  const markdown = renderReportMarkdown(report);
  const latencySection = markdown.slice(
    markdown.indexOf('## Stage latencies'),
    markdown.indexOf('## Transport batches'),
  );
  const distributionSection = markdown.slice(
    markdown.indexOf('## Transport batches'),
    markdown.indexOf('## Client-observed latency'),
  );
  assert.equal(latencySection.includes('coalesce merged'), false);
  assert.equal(distributionSection.includes('coalesce merged'), true);

  assert.ok(report.drift);
  assert.ok(report.drift.firstHalfToReceiveMs.count > 0);
  assert.ok(report.drift.secondHalfToReceiveMs.count > 0);
});

test('the replay client takes its baseline from the first batch and rejects gaps, generation changes and reordering', () => {
  const connected = { type: 'connection', status: 'connected' } as const;
  const batch = (generation: string, seqs: number[]) => ({
    type: 'events.batch' as const,
    generation,
    firstSeq: Math.min(...seqs),
    lastSeq: Math.max(...seqs),
    events: seqs.map((seq) => ({ seq, event: connected })),
  });

  // The first batch establishes the live sequence baseline, wherever it starts.
  const late = { generation: null, lastSeq: 0 };
  assert.equal(acceptReplayWireMessage(batch('generation-1', [7]), late).length, 1);
  assert.deepEqual(late, { generation: 'generation-1', lastSeq: 7 });

  const cursor = { generation: null, lastSeq: 0 };
  assert.equal(acceptReplayWireMessage(batch('generation-1', [1, 2]), cursor).length, 2);
  assert.deepEqual(cursor, { generation: 'generation-1', lastSeq: 2 });
  assert.throws(() => acceptReplayWireMessage(batch('generation-1', [4]), cursor), /sequence gap/);
  assert.throws(
    () => acceptReplayWireMessage(batch('generation-2', [3]), cursor),
    /generation changed/,
  );
  assert.throws(
    () => acceptReplayWireMessage(batch('generation-1', [2, 1]), { generation: null, lastSeq: 0 }),
    /entry order/,
  );
});
