import assert from 'node:assert/strict';
import test from 'node:test';

import type { ServerEvent } from './protocol.js';
import {
  nativeSnapshot,
  nativeSuccess,
  observeNativeBrowserTimeouts,
} from './testing/browserCharacterizationSupport.js';
import { FakeFactorySession } from './testing/fakeFactoryRuntime.js';
import {
  createNativeBrowserTestContext,
  createSessionManagerTestContext,
} from './testing/sessionManagerTestContext.js';

type NativeBrowserRequestEvent = Extract<ServerEvent, { type: 'browser.native.request' }>;

function nativeRequests(events: ServerEvent[]): NativeBrowserRequestEvent[] {
  return events.filter(
    (event): event is NativeBrowserRequestEvent => event.type === 'browser.native.request',
  );
}

test('browser commands route to the browser manager and report a missing session', async () => {
  const h = createSessionManagerTestContext();
  const viewport = { width: 1024, height: 768, deviceScaleFactor: 1 };

  try {
    const open = {
      type: 'browser.open',
      appSessionId: 'app-b1',
      url: 'https://example.test',
      viewport,
      viewportMode: 'custom',
    } as const;
    await h.handle(open);

    assert.deepEqual(h.browsers.calls.at(-1), { target: 'browser', method: 'open', args: [open] });
    const updated = h.events.at(-1);
    assert.equal(updated?.type, 'browser.updated');
    assert.equal(updated.state.appSessionId, 'app-b1');

    await h.handle({ type: 'browser.reload', appSessionId: 'missing' });

    assert.equal(
      h.events.some(
        (event) =>
          event.type === 'browser.error' &&
          event.appSessionId === 'missing' &&
          event.message === 'Browser session is not open yet.',
      ),
      true,
    );
  } finally {
    await h.dispose();
  }
});

test('native browser results settle only the request they answer, and late results are ignored', async () => {
  const timeouts = observeNativeBrowserTimeouts();
  const h = createNativeBrowserTestContext();

  try {
    let opened = false;
    const open = h.handle({
      type: 'browser.open',
      appSessionId: 'app-b2',
      url: 'https://example.test',
    });
    void open.then(() => {
      opened = true;
    });
    const request = nativeRequests(h.events).at(-1)?.request;
    assert.ok(request);

    await h.handle({
      type: 'browser.native.result',
      result: {
        requestId: 'unknown',
        appSessionId: 'app-b2',
        browserSessionId: 'browser-b2',
        ok: true,
      },
    });
    assert.equal(opened, false);

    await h.handle({
      type: 'browser.native.result',
      result: nativeSuccess(request, nativeSnapshot('https://example.test')),
    });
    await open;
    assert.equal(opened, true);
    assert.equal(
      h.events.some(
        (event) =>
          event.type === 'browser.updated' &&
          event.state.appSessionId === 'app-b2' &&
          event.state.url === 'https://example.test',
      ),
      true,
    );

    const reload = h.handle({ type: 'browser.reload', appSessionId: 'app-b2' });
    const timedOutRequest = nativeRequests(h.events).at(-1)?.request;
    assert.ok(timedOutRequest);
    timeouts.fireCurrent();
    await reload;
    assert.equal(
      h.events.some(
        (event) =>
          event.type === 'browser.error' &&
          event.appSessionId === 'app-b2' &&
          /DROIDEX browser did not respond to reload within \d+ms\./.test(event.message),
      ),
      true,
    );

    const eventCountBeforeLateResult = h.events.length;
    await h.handle({
      type: 'browser.native.result',
      result: nativeSuccess(timedOutRequest, nativeSnapshot('https://example.test/reloaded')),
    });
    assert.equal(h.events.length, eventCountBeforeLateResult);

    const close = h.handle({ type: 'browser.close', appSessionId: 'app-b2' });
    const closeRequest = nativeRequests(h.events).at(-1)?.request;
    assert.ok(closeRequest);
    await h.handle({ type: 'browser.native.result', result: nativeSuccess(closeRequest) });
    await close;
  } finally {
    await h.dispose();
    timeouts.restore();
  }
});

test('the browser stays bound to the stable session across a provider swap', async () => {
  const h = createSessionManagerTestContext();
  const appSessionId = 'provider-1';

  try {
    await h.create({
      sessionPurpose: 'chat',
      clientRef: 'b3',
      title: 'Browser continuity',
      goal: 'go',
      interactionMode: 'auto',
      autonomy: 'low',
    });
    await h.waitForIdle();
    h.provider.session(appSessionId).nextCompactResult = {
      newSessionId: 'provider-2',
      removedCount: 1,
    };
    h.runtime.loadQueue.set('provider-2', [new FakeFactorySession('provider-2', {}, h.calls)]);

    await h.handle({
      type: 'browser.open',
      appSessionId: appSessionId,
      url: 'https://example.test',
    });
    await h.handle({ type: 'session.compact', appSessionId: appSessionId });
    const browserUpdatesBeforeReload = h.events.filter((event) => event.type === 'browser.updated');
    await h.handle({ type: 'browser.reload', appSessionId: appSessionId });

    assert.deepEqual(
      h.browsers.calls
        .filter((call) => call.target === 'browser')
        .map((call) => [call.method, call.args[0]]),
      [
        ['open', { type: 'browser.open', appSessionId: appSessionId, url: 'https://example.test' }],
        ['reload', appSessionId],
      ],
    );
    assert.equal(
      h.events.some(
        (event) =>
          event.type === 'session.updated' &&
          event.session.appSessionId === appSessionId &&
          event.session.providerSessionId === 'provider-2',
      ),
      true,
    );
    const browserUpdates = h.events.filter(
      (event): event is Extract<ServerEvent, { type: 'browser.updated' }> =>
        event.type === 'browser.updated',
    );
    assert.equal(browserUpdates.length > browserUpdatesBeforeReload.length, true);
    assert.equal(browserUpdates.at(-1)?.state.appSessionId, appSessionId);
  } finally {
    await h.dispose();
  }
});
