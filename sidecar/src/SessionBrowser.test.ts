import assert from 'node:assert/strict';
import test from 'node:test';
import { SessionBrowser } from './SessionBrowser.js';
import { BrowserSessionManager } from './browser/BrowserSessionManager.js';
import type { BrowserNativeRequest } from './protocol.js';

test('user browser commands retain their origin across awaits without granting concurrent tools user access', async () => {
  const requests: BrowserNativeRequest[] = [];
  let releaseUser = () => {};
  const userWaiting = new Promise<void>((resolve) => (releaseUser = resolve));
  let startedUser = () => {};
  const userStarted = new Promise<void>((resolve) => (startedUser = resolve));
  const browsers: BrowserSessionManager = new BrowserSessionManager({
    runtimeFactory: (id, viewport, appSessionId) =>
      controller.createRuntime(id, viewport, appSessionId),
  });
  const controller = new SessionBrowser({
    browsers,
    emit: () => {},
    framePrompt: (_id, text) => text,
    sendPrompt: async () => {},
    requestBrowser: async (request) => {
      requests.push(request);
      if (request.appSessionId === 'user-chat' && request.action === 'resize') {
        startedUser();
        await userWaiting;
      }
      return {
        ...request,
        ok: true,
        snapshot: { url: 'https://example.test/', scroll: { x: 0, y: 0 } },
      };
    },
  });
  const opening = controller.open({
    type: 'browser.open',
    appSessionId: 'user-chat',
    url: 'https://example.test/',
    viewportMode: 'desktop',
  });
  await userStarted;
  await browsers.open({ appSessionId: 'agent-chat', url: 'https://example.test/' });
  releaseUser();
  await opening;
  await controller.reload({ type: 'browser.reload', appSessionId: 'user-chat' });
  await browsers.reload('user-chat');
  assert.deepEqual(
    requests.map(({ action, initiator }) => [action, initiator]),
    [
      ['resize', 'user'],
      ['open', 'agent'],
      ['open', 'user'],
      ['reload', 'user'],
      ['reload', 'agent'],
    ],
  );
});
