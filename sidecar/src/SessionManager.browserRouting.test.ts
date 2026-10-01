import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import {
  createDesktopBrowserChannel,
  type BrowserChannelProcess,
} from './browser/desktopBrowserChannel.js';
import type { BrowserNativeRequest, BrowserNativeResult, ServerEvent } from './protocol.js';
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

// Stands in for the desktop app's main process on the other end of the channel.
function fakeDesktopApp() {
  const channel = new EventEmitter() as EventEmitter & { connected: boolean; sent: unknown[] };
  channel.connected = true;
  channel.sent = [];
  Object.assign(channel, {
    send: (message: unknown, callback?: (error: Error | null) => void) => {
      channel.sent.push(message);
      callback?.(null);
      return true;
    },
  });
  return {
    requestBrowser: createDesktopBrowserChannel(channel as unknown as BrowserChannelProcess, 5_000),
    lastRequest: () =>
      (channel.sent.at(-1) as { request: BrowserNativeRequest } | undefined)?.request,
    answer: async (id: string, result: BrowserNativeResult) => {
      channel.emit('message', { type: 'browser.result', id, result });
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

test('[B1] Browser command routing', { concurrency: false }, async () => {
  const h = createSessionManagerTestContext();
  const viewport = { width: 1024, height: 768, deviceScaleFactor: 1 };
  const resizedViewport = { width: 1280, height: 720, deviceScaleFactor: 2 };

  try {
    await h.handle({
      type: 'browser.open',
      appSessionId: 'app-b1',
      url: 'https://example.test',
      viewport,
      viewportMode: 'tablet',
    });

    assert.deepEqual(h.browsers.calls.at(-1), {
      target: 'browser',
      method: 'open',
      args: [
        {
          type: 'browser.open',
          appSessionId: 'app-b1',
          url: 'https://example.test',
          viewport,
          viewportMode: 'tablet',
        },
      ],
    });
    assert.deepEqual(h.events.at(-1), {
      type: 'browser.updated',
      state: {
        browserSessionId: 'browser-app-b1',
        appSessionId: 'app-b1',
        url: 'https://example.test',
        viewport,
        viewportMode: 'tablet',
        scroll: { x: 0, y: 0 },
      },
    });

    await h.handle({
      type: 'browser.open',
      appSessionId: 'app-b1',
      url: 'https://example.test/reopened-viewport',
      viewport: resizedViewport,
    });

    assert.deepEqual(h.events.at(-1), {
      type: 'browser.updated',
      state: {
        browserSessionId: 'browser-app-b1',
        appSessionId: 'app-b1',
        url: 'https://example.test/reopened-viewport',
        viewport: resizedViewport,
        viewportMode: 'tablet',
        scroll: { x: 0, y: 0 },
      },
    });

    await h.handle({
      type: 'browser.open',
      appSessionId: 'app-b1',
      url: 'https://example.test/reopened-mode',
      viewportMode: 'mobile',
    });

    assert.deepEqual(h.events.at(-1), {
      type: 'browser.updated',
      state: {
        browserSessionId: 'browser-app-b1',
        appSessionId: 'app-b1',
        url: 'https://example.test/reopened-mode',
        viewport: resizedViewport,
        viewportMode: 'mobile',
        scroll: { x: 0, y: 0 },
      },
    });

    await h.handle({
      type: 'browser.open',
      appSessionId: 'app-b1',
      url: 'https://example.test/reopened',
    });

    assert.deepEqual(h.events.at(-1), {
      type: 'browser.updated',
      state: {
        browserSessionId: 'browser-app-b1',
        appSessionId: 'app-b1',
        url: 'https://example.test/reopened',
        viewport: resizedViewport,
        viewportMode: 'mobile',
        scroll: { x: 0, y: 0 },
      },
    });

    await h.handle({
      type: 'browser.open',
      appSessionId: 'app-b1-default',
      url: 'https://example.test/default',
    });

    assert.deepEqual(h.events.at(-1), {
      type: 'browser.updated',
      state: {
        browserSessionId: 'browser-app-b1-default',
        appSessionId: 'app-b1-default',
        url: 'https://example.test/default',
        viewport: { width: 1200, height: 800, deviceScaleFactor: 2 },
        viewportMode: 'fit',
        scroll: { x: 0, y: 0 },
      },
    });

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

test('[B2] Desktop browser requests and answers', { concurrency: false }, async () => {
  const timeouts = observeNativeBrowserTimeouts();
  const app = fakeDesktopApp();
  const h = createNativeBrowserTestContext(app.requestBrowser);

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
    const request = app.lastRequest();
    assert.ok(request);

    await app.answer('unknown', { ...nativeSuccess(request), requestId: 'unknown' });
    assert.equal(opened, false);

    await app.answer(
      request.requestId,
      nativeSuccess(request, nativeSnapshot('https://example.test')),
    );
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
    const timedOutRequest = app.lastRequest();
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

    // A late answer is dropped; nothing is replayed.
    const eventCountBeforeLateResult = h.events.length;
    await app.answer(
      timedOutRequest.requestId,
      nativeSuccess(timedOutRequest, nativeSnapshot('https://example.test/reloaded')),
    );
    assert.equal(h.events.length, eventCountBeforeLateResult);

    const close = h.handle({ type: 'browser.close', appSessionId: 'app-b2' });
    const closeRequest = app.lastRequest();
    assert.ok(closeRequest);
    await app.answer(closeRequest.requestId, nativeSuccess(closeRequest));
    await close;
  } finally {
    await h.dispose();
    timeouts.restore();
  }
});

test('[B3] Browser continuity across compaction', { concurrency: false }, async () => {
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

    await h.handle({ type: 'session.close', appSessionId: appSessionId });
    assert.equal(
      h.calls.filter(
        (call) =>
          call.target === 'cleanup' &&
          call.method === 'browser.close' &&
          call.args[0] === appSessionId,
      ).length,
      1,
    );
  } finally {
    await h.dispose();
  }

  const shutdown = createSessionManagerTestContext();
  let shutdownDisposed = false;
  try {
    await shutdown.create({
      sessionPurpose: 'chat',
      clientRef: 'b3-shutdown',
      title: 'Browser shutdown',
      goal: 'go',
      interactionMode: 'auto',
      autonomy: 'low',
    });
    await shutdown.handle({
      type: 'browser.open',
      appSessionId: 'provider-1',
      url: 'https://example.test/shutdown',
    });
    await shutdown.dispose();
    shutdownDisposed = true;
    assert.equal(
      shutdown.calls.filter(
        (call) =>
          call.target === 'cleanup' &&
          call.method === 'browser.close' &&
          call.args[0] === 'provider-1',
      ).length,
      1,
    );
  } finally {
    if (!shutdownDisposed) await shutdown.dispose();
  }
});
