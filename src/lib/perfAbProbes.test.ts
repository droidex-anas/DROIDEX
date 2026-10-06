import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  HISTORY_10K,
  measureBundle,
  measureMountedRows,
  runAbProbes,
  TERMINAL_FLOOD_CHUNKS,
} from './perfAbProbes';

const treeRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

test('10k-row histories keep a bounded mounted window on this tree', async () => {
  const metric = await measureMountedRows(treeRoot, HISTORY_10K);
  assert.equal(metric.id, 'feed.mountedRowsAt10k');
  assert.ok(metric.value > 0);
  assert.ok(metric.value < 80);
  assert.ok(metric.value < HISTORY_10K);
});

test('A/B probes emit labelled metrics without requiring a GUI', async () => {
  const previousRuns = process.env.DROIDEX_PERF_SIDECAR_STARTUP_RUNS;
  process.env.DROIDEX_PERF_SIDECAR_STARTUP_RUNS = '1';
  try {
    const result = await runAbProbes(treeRoot);
    const byId = new Map(result.metrics.map((metric) => [metric.id, metric]));
    for (const id of [
      'feed.mountedRowsAt10k',
      'feed.eventsRebuiltPerDelta',
      'feed.rowVisitsPerTailDeltaAt10k',
      'terminal.deliveriesPerFlood',
      'markdown.perDeltaRenderMs',
      'sidecar.readyMs',
      'sidecar.firstSessionsListMs',
    ]) {
      assert.ok(byId.has(id), `missing metric ${id}`);
    }
    assert.ok((byId.get('feed.mountedRowsAt10k')?.value ?? 0) < 80);
    assert.ok((byId.get('feed.eventsRebuiltPerDelta')?.value ?? 99) <= 8);
    assert.ok((byId.get('terminal.deliveriesPerFlood')?.value ?? 99) < TERMINAL_FLOOD_CHUNKS);
    assert.ok((byId.get('markdown.perDeltaRenderMs')?.value ?? -1) >= 0);
    if (existsSync(join(treeRoot, 'sidecar/dist/sidecar.mjs'))) {
      assert.ok((byId.get('sidecar.readyMs')?.value ?? -1) > 0);
      assert.ok((byId.get('sidecar.firstSessionsListMs')?.value ?? -1) > 0);
    }
    const bundle = measureBundle(treeRoot);
    if (bundle) {
      assert.ok(bundle.some((metric) => metric.id === 'bundle.initialJsBytes' && metric.value > 0));
    }
  } finally {
    if (previousRuns === undefined) delete process.env.DROIDEX_PERF_SIDECAR_STARTUP_RUNS;
    else process.env.DROIDEX_PERF_SIDECAR_STARTUP_RUNS = previousRuns;
  }
});
