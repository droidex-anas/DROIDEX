import assert from 'node:assert/strict';
import test from 'node:test';

import { serverEventForHistoryStatus } from './historyStatusEvents.js';

test('healthy persistence recovers, and failures stay errors that name the cause without a fake progress figure', () => {
  assert.deepEqual(serverEventForHistoryStatus({ state: 'healthy' }), {
    type: 'history.persistenceRecovered',
  });
  for (const [state, code, recoverable, message] of [
    ['degraded', 'history.persistence_degraded', true, 'disk full'],
    ['search_unavailable', 'history.search_unavailable', false, 'FTS5 missing'],
    ['unavailable', 'history.unavailable', false, 'cannot open'],
  ] as const) {
    const event = serverEventForHistoryStatus({ state, message });
    assert.equal(event.type, 'error');
    if (event.type !== 'error') return;
    assert.equal(event.code, code);
    assert.equal(event.recoverable, recoverable);
    assert.match(event.message, new RegExp(message));
    assert.doesNotMatch(event.message, /\d+\s*%/);
    assert.doesNotMatch(event.message, /ETA/i);
  }
});
