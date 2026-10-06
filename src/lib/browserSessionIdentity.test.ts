import test from 'node:test';
import assert from 'node:assert/strict';
import {
  browserKeyForSession,
  nativeBrowserRequestTargetsActiveSession,
  nativeBrowserRequestTargetsVisibleSurface,
} from './browserSessionIdentity';
import { sessionSummary } from '../test/sessionSummary';

const session = (appSessionId: string, providerSessionId?: string) =>
  sessionSummary(appSessionId, {
    providerSessionId,
    goal: appSessionId,
    workspaceKind: 'none',
    phase: 'running',
  });

test('browserKeyForSession uses the stable app session id through compaction', () => {
  // The provider session id changes on compaction; the browser
  // key must stay the app id so browser tools keep targeting the visible chat.
  assert.equal(browserKeyForSession(session('app-1', 'provider-after-compaction')), 'app-1');
  assert.equal(browserKeyForSession(session('app-2')), 'app-2');
});

test('nativeBrowserRequestTargetsActiveSession never promotes background browser work', () => {
  assert.equal(nativeBrowserRequestTargetsActiveSession('visible-chat', 'visible-chat'), true);
  assert.equal(nativeBrowserRequestTargetsActiveSession('visible-chat', 'background-chat'), false);
  assert.equal(nativeBrowserRequestTargetsActiveSession(undefined, 'background-chat'), false);
});

test('nativeBrowserRequestTargetsVisibleSurface only attaches the active browser request', () => {
  assert.equal(
    nativeBrowserRequestTargetsVisibleSurface({
      browserKey: 'visible-chat',
      requestAppSessionId: 'visible-chat',
      requestBrowserSessionId: 'browser-visible-chat',
    }),
    true,
  );

  assert.equal(
    nativeBrowserRequestTargetsVisibleSurface({
      browserKey: 'visible-chat',
      visibleBrowserSessionId: 'browser-visible-chat',
      requestAppSessionId: 'background-chat',
      requestBrowserSessionId: 'browser-visible-chat',
    }),
    true,
  );

  assert.equal(
    nativeBrowserRequestTargetsVisibleSurface({
      browserKey: 'visible-chat',
      requestAppSessionId: 'background-chat',
      requestBrowserSessionId: 'browser-background-chat',
    }),
    false,
  );
});
