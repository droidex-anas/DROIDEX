import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addDiagnosticsBreadcrumb,
  setDiagnosticsContext,
  getSessionLog,
  getCurrentAppState,
  __resetDiagnosticsForTest,
} from './rendererDiagnostics';

test('addDiagnosticsBreadcrumb records only allowed categories into the session log', () => {
  __resetDiagnosticsForTest();
  addDiagnosticsBreadcrumb('console', 'leaked log');
  addDiagnosticsBreadcrumb('fetch', 'GET /api/secret');
  addDiagnosticsBreadcrumb('ui.click', 'button pressed');
  assert.equal(getSessionLog().length, 0);

  addDiagnosticsBreadcrumb('session', 'mode changed to spec');
  addDiagnosticsBreadcrumb('app', 'app focused');
  addDiagnosticsBreadcrumb('bridge', 'bridge connected');
  addDiagnosticsBreadcrumb('navigation', 'navigated to /settings');

  const log = getSessionLog();
  assert.deepEqual(
    log.map((entry) => entry.category),
    ['session', 'app', 'bridge', 'navigation'],
  );
  assert.equal(log[0].message, 'mode changed to spec');
  for (const entry of log) {
    assert.equal(typeof entry.timestamp, 'number');
  }
});

test('session log ring buffer caps at 50 entries with FIFO eviction', () => {
  __resetDiagnosticsForTest();
  for (let i = 0; i < 60; i++) {
    addDiagnosticsBreadcrumb('session', `entry ${i}`);
  }
  const log = getSessionLog();
  assert.equal(log.length, 50);
  assert.equal(log[0].message, 'entry 10');
  assert.equal(log[49].message, 'entry 59');
});

test('the session log and app state are copied in and out, so callers cannot mutate them', () => {
  __resetDiagnosticsForTest();
  addDiagnosticsBreadcrumb('session', 'original');
  const log = getSessionLog();
  log.push({ category: 'session', message: 'injected', level: 'info', timestamp: 0 });
  log[0].message = 'tampered';
  const freshLog = getSessionLog();
  assert.equal(freshLog.length, 1);
  assert.equal(freshLog[0].message, 'original');

  const state = { interactionMode: 'spec', view: 'chat' };
  setDiagnosticsContext(state);
  state.interactionMode = 'auto';
  const stored = getCurrentAppState();
  assert.equal(stored.interactionMode, 'spec');
  stored.interactionMode = 'auto';
  assert.equal(getCurrentAppState().interactionMode, 'spec');
});
