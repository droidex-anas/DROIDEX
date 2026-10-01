// The sidecar's browser requests, run here because main owns the pages. A
// request that needs its page wakes it for exactly as long as it runs: the
// renderer's Browser host keeps that page mounted and rendering until main says
// the work is over, whether or not the pane is open.

// Reading the logs or recording the viewport never needs the page itself.
const PAGELESS_ACTIONS = new Set(['resize', 'network', 'console']);
const MAX_WAITING_PER_PAGE = 8;
const LOAD_WAIT_MS = 8_000;

function createNativeBrowserRequests({ manager, notifyRenderer }) {
  const waiting = new Map(); // browserSessionId -> requests in flight

  async function perform(request) {
    try {
      if (request.action === 'close') {
        manager.close(request.browserSessionId);
        notifyRenderer('native-browser-closed', { browserSessionId: request.browserSessionId });
        return result(request, true);
      }
      if (PAGELESS_ACTIONS.has(request.action)) return performAction(request);
      return await withAwakePage(request.browserSessionId, () => performOnPage(request));
    } catch (error) {
      return result(request, false, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function withAwakePage(browserSessionId, run) {
    const count = waiting.get(browserSessionId) ?? 0;
    if (count >= MAX_WAITING_PER_PAGE) {
      throw new Error('Too many browser actions are already waiting on this page.');
    }
    waiting.set(browserSessionId, count + 1);
    notifyRenderer('native-browser-working', { browserSessionId, working: true });
    try {
      return await run();
    } finally {
      const left = (waiting.get(browserSessionId) ?? 1) - 1;
      if (left > 0) waiting.set(browserSessionId, left);
      else waiting.delete(browserSessionId);
      notifyRenderer('native-browser-working', { browserSessionId, working: false });
    }
  }

  async function performOnPage(request) {
    const { browserSessionId } = request;
    if (request.action === 'open') {
      const url = request.url ?? 'about:blank';
      await manager.open(browserSessionId, url, request.viewport);
      return result(request, true, { snapshot: await snapshotAfter(request, url) });
    }
    if (request.action === 'reload') {
      const loaded = manager.nextLoad(browserSessionId, LOAD_WAIT_MS);
      await manager.reload(browserSessionId);
      return result(request, true, { snapshot: await snapshotAfter(request, (await loaded)?.url) });
    }
    if (request.action === 'goBack' || request.action === 'goForward') {
      const loaded = manager.nextLoad(browserSessionId, LOAD_WAIT_MS);
      const moved =
        request.action === 'goBack'
          ? await manager.goBack(browserSessionId)
          : await manager.goForward(browserSessionId);
      const url = moved ? (await loaded)?.url : undefined;
      return result(request, true, { snapshot: await snapshotAfter(request, url) });
    }
    if (request.action === 'capture') {
      const image = await manager.capture(browserSessionId, request.box, {
        fullPage: request.fullPage,
        deviceScaleFactor: request.deviceScaleFactor,
      });
      return result(request, true, { image });
    }
    return performAction(request);
  }

  async function performAction(request) {
    const outcome = await manager.runAgentAction(agentAction(request));
    return result(request, outcome.ok, {
      snapshot: outcome.snapshot,
      inspection: outcome.inspection,
      networkEvents: outcome.networkEvents,
      consoleEvents: outcome.consoleEvents,
      error: outcome.error,
    });
  }

  async function snapshotAfter(request, fallbackUrl = 'about:blank') {
    const outcome = await manager
      .runAgentAction({
        requestId: `${request.requestId}:snapshot`,
        browserSessionId: request.browserSessionId,
        action: 'snapshot',
      })
      .catch(() => undefined);
    return outcome?.ok && outcome.snapshot
      ? outcome.snapshot
      : { url: fallbackUrl, scroll: { x: 0, y: 0 }, refs: [] };
  }

  return { perform };
}

// Only what an action reads goes to the page script.
function agentAction(request) {
  return {
    requestId: request.requestId,
    browserSessionId: request.browserSessionId,
    action: request.action,
    x: request.x,
    y: request.y,
    selector: request.selector,
    text: request.text,
    key: request.key,
    direction: request.direction,
    pixels: request.pixels,
    viewport: request.viewport,
    clearNetworkLog: request.clearNetworkLog,
    clearConsoleLog: request.clearConsoleLog,
  };
}

function result(request, ok, fields = {}) {
  return {
    requestId: request.requestId,
    appSessionId: request.appSessionId,
    browserSessionId: request.browserSessionId,
    ok,
    ...fields,
  };
}

module.exports = { createNativeBrowserRequests };
