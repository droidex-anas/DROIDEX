// The sidecar's browser requests, run here because main owns the pages. A
// request that needs its page wakes it for exactly as long as main works on it:
// main's count of that work is the only truth, and the renderer's Browser host
// keeps the page mounted and rendering while it is above zero, whether or not
// the pane is open.

const ACTIONS = new Set([
  'open',
  'reload',
  'goBack',
  'goForward',
  'snapshot',
  'readPage',
  'readText',
  'find',
  'click',
  'hover',
  'fill',
  'type',
  'press',
  'scroll',
  'resize',
  'inspect',
  'network',
  'console',
  'capture',
  'screenshot',
  'close',
  'fillCredentials',
  'wait',
]);
// Reading the logs or recording the viewport never needs the page itself.
const PAGELESS_ACTIONS = new Set(['resize', 'network', 'console']);
const INPUT_ACTIONS = new Set(['click', 'hover', 'fill', 'type', 'press', 'scroll']);
// What moves a page on, and so takes its turn; reads run alongside.
const TURN_ACTIONS = new Set([
  ...INPUT_ACTIONS,
  'open',
  'reload',
  'goBack',
  'goForward',
  'fillCredentials',
  'wait',
]);
const LATE = 'The browser page did not finish in time.';
const MAX_WAITING_PER_PAGE = 8;
const LOAD_WAIT_MS = 8_000;
// Work still running a little past the sidecar's own timeout stops holding its
// page, and whatever it does afterwards is dropped.
const DEADLINE_MARGIN_MS = 3_000;
const DEFAULT_SIDECAR_TIMEOUT_MS = 12_000;

function createNativeBrowserRequests({ manager, notifyRenderer }) {
  const waiting = new Map(); // browserSessionId -> requests in flight
  const painting = new Map(); // browserSessionId -> its first paint after waking
  const turns = new Map(); // browserSessionId -> when the last action queued on it is over

  // A message from the sidecar; only a well-formed browser request is answered.
  async function handle(message, reply) {
    const request = browserRequestFrom(message);
    if (!request) return;
    const timeoutMs = sidecarTimeoutMs(message.timeoutMs);
    const receivedAt = Date.now();
    // Nothing starts once the caller has given up, by its own expiry when it
    // sent one.
    const startBy = Math.min(
      receivedAt + timeoutMs,
      Number.isFinite(message.expiresAt) ? message.expiresAt : Infinity,
    );
    reply({
      type: 'browser.result',
      id: request.requestId,
      result: await perform({ ...request, receivedAt, startBy }, timeoutMs),
    });
  }

  async function perform(request, timeoutMs) {
    try {
      if (request.action === 'close') {
        manager.close(request.browserSessionId);
        notifyRenderer('native-browser-closed', { browserSessionId: request.browserSessionId });
        return result(request, true);
      }
      if (PAGELESS_ACTIONS.has(request.action)) return await performAction(request);
      return await withAwakePage(request.browserSessionId, timeoutMs, async (woke) => {
        if (woke) startPaintWait(request.browserSessionId);
        if (!TURN_ACTIONS.has(request.action)) return performOnPage(request);
        return inTurn(request.browserSessionId, request.startBy, async () => {
          if (INPUT_ACTIONS.has(request.action)) await painting.get(request.browserSessionId);
          return performOnPage(request);
        });
      });
    } catch (error) {
      return result(request, false, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // The work runs while the sidecar still waits for it, and a little past that.
  async function withAwakePage(browserSessionId, timeoutMs, run) {
    if ((waiting.get(browserSessionId) ?? 0) >= MAX_WAITING_PER_PAGE) {
      throw new Error('Too many browser actions are already waiting on this page.');
    }
    const woke = !waiting.has(browserSessionId);
    setWaiting(browserSessionId, 1);
    let timer;
    try {
      const work = run(woke);
      work.catch(() => undefined);
      return await Promise.race([
        work,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(LATE)), timeoutMs + DEADLINE_MARGIN_MS);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      setWaiting(browserSessionId, -1);
    }
  }

  // Actions on one page run one at a time, in the order they came, each only
  // once the one ahead has finished, even past its own deadline. One whose
  // caller has given up never starts.
  function inTurn(browserSessionId, startBy, run) {
    const previous = turns.get(browserSessionId) ?? Promise.resolve();
    const turn = previous.then(() => {
      if (Date.now() >= startBy) throw new Error(LATE);
      return run();
    });
    const over = turn.catch(() => undefined);
    turns.set(browserSessionId, over);
    void over.then(() => {
      if (turns.get(browserSessionId) === over) turns.delete(browserSessionId);
    });
    return turn;
  }

  // A page that has just woken drops input until it paints again; every input
  // that arrives meanwhile waits for the same paint.
  function startPaintWait(browserSessionId) {
    const paint = manager
      .waitForPaint(browserSessionId)
      .catch(() => undefined)
      .finally(() => {
        if (painting.get(browserSessionId) === paint) painting.delete(browserSessionId);
      });
    painting.set(browserSessionId, paint);
  }

  function setWaiting(browserSessionId, delta) {
    const before = waiting.get(browserSessionId) ?? 0;
    const after = before + delta;
    if (after > 0) waiting.set(browserSessionId, after);
    else waiting.delete(browserSessionId);
    if (before > 0 === after > 0) return;
    // With no request left on the page, operations still running belong to
    // work main gave up on: they stop keeping the page unthrottled.
    if (after === 0) manager.abandonWork(browserSessionId);
    notifyRenderer('native-browser-working', { browserSessionId, working: after > 0 });
  }

  async function performOnPage(request) {
    const { browserSessionId } = request;
    // A navigation goes out only while its caller still waits for it.
    const stillWanted = () => {
      if (Date.now() >= request.startBy) throw new Error(LATE);
    };
    if (request.action === 'open') {
      const url = request.url ?? 'about:blank';
      await manager.waitForPage(browserSessionId);
      stillWanted();
      await manager.open(browserSessionId, url, request.viewport);
      return result(request, true, await snapshotAfter(request, url));
    }
    if (request.action === 'reload') {
      await manager.waitForPage(browserSessionId);
      stillWanted();
      const loaded = manager.nextLoad(browserSessionId, LOAD_WAIT_MS);
      await manager.reload(browserSessionId);
      return result(request, true, await snapshotAfter(request, (await loaded)?.url));
    }
    if (request.action === 'goBack' || request.action === 'goForward') {
      await manager.waitForPage(browserSessionId);
      stillWanted();
      const loaded = manager.nextLoad(browserSessionId, LOAD_WAIT_MS);
      const moved =
        request.action === 'goBack'
          ? await manager.goBack(browserSessionId)
          : await manager.goForward(browserSessionId);
      const url = moved ? (await loaded)?.url : undefined;
      return result(request, true, await snapshotAfter(request, url));
    }
    if (request.action === 'capture') {
      const image = await manager.capture(browserSessionId, request.box);
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
      text: outcome.text,
      matches: outcome.matches,
      image: outcome.image,
      mimeType: outcome.mimeType,
      error: outcome.error,
    });
  }

  // Where a navigation left the page, with the footer the agent reads.
  async function snapshotAfter(request, fallbackUrl = 'about:blank') {
    const outcome = await manager
      .runAgentAction({
        requestId: `${request.requestId}:snapshot`,
        browserSessionId: request.browserSessionId,
        action: 'snapshot',
      })
      .catch(() => undefined);
    return outcome?.ok && outcome.snapshot
      ? { snapshot: outcome.snapshot, text: outcome.text }
      : { snapshot: { url: fallbackUrl, scroll: { x: 0, y: 0 } } };
  }

  return { handle, workingSessions: () => [...waiting.keys()] };
}

function sidecarTimeoutMs(value) {
  return Number.isFinite(value)
    ? Math.min(Math.max(value, 1_000), 60_000)
    : DEFAULT_SIDECAR_TIMEOUT_MS;
}

function browserRequestFrom(message) {
  if (message?.type !== 'browser.request' || typeof message.id !== 'string') return undefined;
  const request = message.request;
  if (!request || typeof request !== 'object') return undefined;
  const { requestId, appSessionId, browserSessionId, action } = request;
  if (requestId !== message.id || typeof appSessionId !== 'string') return undefined;
  if (typeof browserSessionId !== 'string' || !browserSessionId || !ACTIONS.has(action))
    return undefined;
  return request;
}

// Only what an action reads goes to the page script.
function agentAction(request) {
  return {
    requestId: request.requestId,
    browserSessionId: request.browserSessionId,
    action: request.action,
    ref: request.ref,
    filter: request.filter,
    maxChars: request.maxChars,
    query: request.query,
    region: request.region,
    fullPage: request.fullPage,
    format: request.format,
    x: request.x,
    y: request.y,
    selector: request.selector,
    text: request.text,
    textGone: request.textGone,
    urlIncludes: request.urlIncludes,
    waitMs: request.waitMs,
    receivedAt: request.receivedAt,
    startBy: request.startBy,
    value: request.value,
    submit: request.submit,
    key: request.key,
    repeat: request.repeat,
    button: request.button,
    count: request.count,
    modifiers: request.modifiers,
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
