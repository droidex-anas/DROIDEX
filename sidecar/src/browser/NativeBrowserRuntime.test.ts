import assert from 'node:assert/strict';
import test from 'node:test';
import { NativeBrowserRuntime } from './NativeBrowserRuntime.js';
import type { BrowserNativeRequest } from '../protocol.js';

test('NativeBrowserRuntime sends live requests with application and browser session context', async () => {
  const requests: BrowserNativeRequest[] = [];
  const runtime = new NativeBrowserRuntime({
    appSessionId: 'app-session-one',
    browserSessionId: 'browser-one',
    viewport: { width: 900, height: 700, deviceScaleFactor: 2 },
    nextRequestId: () => `req-${requests.length + 1}`,
    request: async (request) => {
      requests.push(request);
      return {
        requestId: request.requestId,
        appSessionId: request.appSessionId,
        browserSessionId: request.browserSessionId,
        ok: true,
        snapshot: {
          url: request.url ?? 'https://example.com/',
          title: 'Example',
          scroll: { x: 0, y: 0 },
        },
      };
    },
  });

  const { snapshot } = await runtime.open('https://example.com/');
  await runtime.reload();
  await runtime.goBack();
  await runtime.goForward();
  await runtime.click({ x: 12, y: 34 });
  await runtime.hover({ ref: 'e7' });
  await runtime.fill('e9', 'Canada');

  assert.equal(snapshot.url, 'https://example.com/');
  assert.deepEqual(
    requests.map((request) => request.action),
    ['open', 'reload', 'goBack', 'goForward', 'click', 'hover', 'fill'],
  );
  assert.equal(requests[0].appSessionId, 'app-session-one');
  assert.equal(requests[0].browserSessionId, 'browser-one');
  assert.deepEqual(requests[0].viewport, { width: 900, height: 700, deviceScaleFactor: 2 });
  assert.deepEqual({ x: requests[4].x, y: requests[4].y }, { x: 12, y: 34 });
  assert.equal(requests[5].ref, 'e7');
  assert.deepEqual(
    { ref: requests[6].ref, value: requests[6].value },
    { ref: 'e9', value: 'Canada' },
  );
});

type NativeSnapshot = Awaited<ReturnType<NativeBrowserRuntime['open']>>['snapshot'];

/** A runtime whose native side answers each request with the given page snapshot. */
function runtimeAnswering(
  snapshotFor: (request: BrowserNativeRequest) => NativeSnapshot | undefined,
): NativeBrowserRuntime {
  return new NativeBrowserRuntime({
    appSessionId: 'app-session-one',
    browserSessionId: 'browser-one',
    viewport: { width: 900, height: 700, deviceScaleFactor: 2 },
    request: async (request) => ({
      requestId: request.requestId,
      appSessionId: request.appSessionId,
      browserSessionId: request.browserSessionId,
      ok: true,
      snapshot: snapshotFor(request),
    }),
  });
}

test('an open answered without a DOM snapshot stays usable and drops the previous page metadata', async () => {
  const runtime = runtimeAnswering((request) =>
    request.url === 'https://example.com/first'
      ? {
          url: request.url,
          title: 'First page',
          scroll: { x: 40, y: 80 },
          canGoBack: true,
          canGoForward: true,
        }
      : undefined,
  );

  await runtime.open('https://example.com/first');
  const { snapshot } = await runtime.open('https://example.com/second');

  assert.deepEqual(snapshot, {
    url: 'https://example.com/second',
    scroll: { x: 0, y: 0 },
    canGoBack: false,
    canGoForward: false,
  });
});

test('reload, history and snapshot actions never reuse a stale page snapshot', async () => {
  const runtime = runtimeAnswering((request) =>
    request.action === 'open'
      ? {
          url: 'https://example.com/current',
          scroll: { x: 0, y: 0 },
        }
      : undefined,
  );

  await runtime.open('https://example.com/current');
  for (const navigate of [
    () => runtime.reload(),
    () => runtime.goBack(),
    () => runtime.goForward(),
  ]) {
    await assert.rejects(navigate(), /without a fresh page snapshot/);
  }
  await assert.rejects(runtime.wait({ text: 'Saved' }), /without a fresh page snapshot/);
  await assert.rejects(runtime.fillCredentials(), /without a fresh page snapshot/);
});

test('resize and diagnostic requests use dedicated native actions', async () => {
  const requests: BrowserNativeRequest[] = [];
  const runtime = new NativeBrowserRuntime({
    appSessionId: 'app-session-one',
    browserSessionId: 'browser-one',
    viewport: { width: 900, height: 700, deviceScaleFactor: 2 },
    request: async (request) => {
      requests.push(request);
      return {
        requestId: request.requestId,
        appSessionId: request.appSessionId,
        browserSessionId: request.browserSessionId,
        ok: true,
        inspection:
          request.action === 'inspect'
            ? {
                selector: '#frame',
                tagName: 'iframe',
                attributes: { src: 'https://video.example/embed' },
                box: { x: 0, y: 0, width: 640, height: 360 },
                html: '<iframe src="https://video.example/embed"></iframe>',
              }
            : undefined,
        networkEvents:
          request.action === 'network'
            ? [{ timestamp: 1, method: 'GET', url: 'https://example.com/api', status: 200 }]
            : undefined,
        consoleEvents:
          request.action === 'console'
            ? [{ timestamp: 2, level: 3, message: 'frame failed' }]
            : undefined,
      };
    },
  });

  await runtime.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 }, 'mobile');
  const inspection = await runtime.inspect({ selector: '#frame' });
  const network = await runtime.network(true);
  const consoleEvents = await runtime.console(true);

  assert.equal(inspection.tagName, 'iframe');
  assert.equal(network[0]?.status, 200);
  assert.equal(consoleEvents[0]?.message, 'frame failed');
  assert.deepEqual(
    requests.map((request) => request.action),
    ['resize', 'inspect', 'network', 'console'],
  );
  assert.equal(requests[2]?.clearNetworkLog, true);
  assert.equal(requests[3]?.clearConsoleLog, true);
});
