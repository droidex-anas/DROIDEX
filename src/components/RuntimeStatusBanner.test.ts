import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import RuntimeStatusBanner from './RuntimeStatusBanner';
import { applyHistoryServerEvent, resetHistoryHealthForTests } from '../lib/historyHealth';
import { HISTORY_PERSISTENCE_DEGRADED_MESSAGE } from '../lib/historyStatusCopy';
import { applySidecarStatus, setTransportHealth } from '../lib/runtimeHealth';

afterEach(() => {
  resetHistoryHealthForTests();
  applySidecarStatus({
    lifecycle: 'healthy',
    processAlive: true,
    bridgeResponsive: true,
    lastHeartbeatAt: 1,
    restartCount: 0,
  });
  setTransportHealth('connected');
});

test('persistence degradation renders a durable banner that clears on recovery', () => {
  applySidecarStatus({
    lifecycle: 'healthy',
    processAlive: true,
    bridgeResponsive: true,
    lastHeartbeatAt: 1,
    restartCount: 0,
  });
  setTransportHealth('connected');
  applyHistoryServerEvent({
    type: 'error',
    code: 'history.persistence_degraded',
    message: 'worker failed',
    recoverable: true,
  });

  const degraded = renderToStaticMarkup(createElement(RuntimeStatusBanner));
  assert.ok(degraded.includes('data-testid="history-persistence-banner"'));
  assert.ok(degraded.includes(HISTORY_PERSISTENCE_DEGRADED_MESSAGE));

  applyHistoryServerEvent({ type: 'history.persistenceRecovered' });
  assert.equal(renderToStaticMarkup(createElement(RuntimeStatusBanner)), '');
});

test('search unavailability renders repair instructions without marking persistence unavailable', () => {
  const message =
    'Search storage is corrupt. Quit DROIDEX, back up storage, then repair or restore.';
  applyHistoryServerEvent({
    type: 'error',
    code: 'history.search_unavailable',
    message,
    recoverable: false,
  });
  const unavailable = renderToStaticMarkup(createElement(RuntimeStatusBanner));
  assert.ok(unavailable.includes('data-testid="history-search-banner"'));
  assert.ok(unavailable.includes(message));
  assert.ok(!unavailable.includes('data-testid="history-persistence-banner"'));
  applyHistoryServerEvent({
    type: 'sessions.searchResults',
    requestId: 'recovered',
    results: [],
    indexingIncomplete: false,
  });
  assert.equal(renderToStaticMarkup(createElement(RuntimeStatusBanner)), '');
});
