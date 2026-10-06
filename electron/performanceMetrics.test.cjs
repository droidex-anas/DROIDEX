const test = require('node:test');
const assert = require('node:assert');

const { createPerformanceMetricsCollector } = require('./performanceMetrics.cjs');

test('collector reports injected PTY and WebContents counts with process health', () => {
  const { collect } = createPerformanceMetricsCollector({
    countPtys: () => 3,
    listWebContents: () => [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }],
    nativeBrowserCounts: () => ({ sessions: 3, live: 2 }),
    terminalCounts: () => ({ live: 3, retained: 1, total: 4 }),
    powerTier: () => 'hidden',
  });

  const metrics = collect();
  assert.equal(metrics.ptys, 3);
  assert.equal(metrics.webContentsTotal, 4);
  assert.equal(metrics.nativeBrowsers.live, 2);
  assert.equal(metrics.nativeBrowsers.sessions, 3);
  assert.equal(metrics.terminals.retained, 1);
  assert.equal(metrics.powerTier, 'hidden');
  assert.ok(Number.isFinite(metrics.timestamp));
  assert.ok(metrics.memory.rssBytes > 0);
  assert.ok(metrics.memory.heapUsedBytes > 0);
  assert.ok(metrics.cpu.userMs >= 0);
  assert.ok(metrics.cpu.systemMs >= 0);
});

test('collector tolerates missing accessors', () => {
  const { collect } = createPerformanceMetricsCollector();
  const metrics = collect();
  assert.equal(metrics.ptys, 0);
  assert.equal(metrics.webContentsTotal, 0);
  assert.equal(metrics.nativeBrowsers.live, 0);
  assert.equal(metrics.terminals.live, 0);
  assert.equal(metrics.powerTier, 'interactive');
});
