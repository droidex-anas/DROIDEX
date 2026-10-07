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
  'colorScheme',
  'inspect',
  'network',
  'console',
  'screenshot',
  'close',
  'fillCredentials',
  'wait',
  'awaitViewport',
  'evaluate',
]);
// Reading the logs or recording the viewport or scheme never needs the page itself.
const PAGELESS_ACTIONS = new Set(['resize', 'colorScheme', 'network', 'console']);
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
  'awaitViewport',
  'evaluate',
]);
const LATE = 'The browser page did not finish in time.';
const CLOSED = 'The browser was closed.';
const MAX_WAITING_PER_PAGE = 8;
const LOAD_WAIT_MS = 8_000;
// Work still running a little past the sidecar's own timeout stops holding its
// page, and whatever it does afterwards is dropped.
const DEADLINE_MARGIN_MS = 3_000;
const DEFAULT_SIDECAR_TIMEOUT_MS = 12_000;
// The sidecar's longest timeout, 60 s, and the longest wait it adds to one.
const MAX_SIDECAR_TIMEOUT_MS = 75_000;

function createNativeBrowserRequests({ manager, notifyRenderer }) {
  const waiting = new Map(); // browserSessionId -> requests in flight
  const painting = new Map(); // browserSessionId -> its first paint after waking
  const queues = new Map(); // browserSessionId -> { over, closed } for the actions queued on it

  // A message from the sidecar; only a well-formed browser request is answered.
  // `runEnded` says whether the sidecar run that sent it has exited or been
  // stopped: its work then never navigates or sends input, so a page restored
  // for a later run is left alone.
  async function handle(message, reply, runEnded) {
    const request = browserRequestFrom(message);
    if (!request || runEnded()) return;
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
      result: await perform({ ...request, receivedAt, startBy, runEnded }, timeoutMs),
    });
  }

  async function perform(request, timeoutMs) {
    try {
      if (request.action === 'close') {
        // Actions still queued on it never start.
        const queue = queues.get(request.browserSessionId);
        if (queue) queue.closed = true;
        queues.delete(request.browserSessionId);
        manager.close(request.browserSessionId);
        notifyRenderer('native-browser-closed', { browserSessionId: request.browserSessionId });
        return result(request, true);
      }
      if (PAGELESS_ACTIONS.has(request.action)) return await performAction(request);
      return await withAwakePage(request.browserSessionId, timeoutMs, async (woke) => {
        if (woke) startPaintWait(request.browserSessionId);
        // A screenshot of a ref scrolls the page to it, so it takes a turn too.
        const takesTurn =
          TURN_ACTIONS.has(request.action) || (request.action === 'screenshot' && request.ref);
        if (!takesTurn) return performOnPage(request);
        const releaseBy = request.receivedAt + timeoutMs + DEADLINE_MARGIN_MS;
        return inTurn(request.browserSessionId, request.startBy, releaseBy, async () => {
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
  // once the one ahead has finished, even past its own deadline, until main
  // gives up on it (`releaseBy`). One whose caller has given up, or whose
  // browser was closed, never starts.
  function inTurn(browserSessionId, startBy, releaseBy, run) {
    const queue = queues.get(browserSessionId) ?? { over: Promise.resolve(), closed: false };
    const turn = queue.over.then(() => {
      if (queue.closed) throw new Error(CLOSED);
      if (Date.now() >= startBy) throw new Error(LATE);
      return run();
    });
    // Counted from its own turn, so one that never starts frees nothing ahead.
    let timer;
    const over = queue.over
      .then(() =>
        Promise.race([
          turn.catch(() => undefined),
          new Promise((resolve) => {
            timer = setTimeout(resolve, Math.max(0, releaseBy - Date.now()));
          }),
        ]),
      )
      .finally(() => clearTimeout(timer));
    queue.over = over;
    queues.set(browserSessionId, queue);
    void over.then(() => {
      if (queue.over === over && queues.get(browserSessionId) === queue)
        queues.delete(browserSessionId);
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
      if (Date.now() >= request.startBy || request.runEnded()) throw new Error(LATE);
    };
    if (request.action === 'open') {
      const url = request.url ?? 'about:blank';
      await manager.waitForPage(browserSessionId);
      stillWanted();
      await manager.open(
        browserSessionId,
        url,
        stillWanted,
        request.source === 'user' ? 'user' : 'agent',
      );
      return result(request, true, await snapshotAfter(request, url));
    }
    if (request.action === 'reload') {
      await manager.waitForPage(browserSessionId);
      const loaded = manager.nextLoad(browserSessionId, LOAD_WAIT_MS);
      await manager.reload(
        browserSessionId,
        stillWanted,
        request.source === 'user' ? 'user' : 'agent',
      );
      return result(request, true, await snapshotAfter(request, (await loaded)?.url));
    }
    if (request.action === 'goBack' || request.action === 'goForward') {
      const loaded = manager.nextLoad(browserSessionId, LOAD_WAIT_MS);
      const moved =
        request.action === 'goBack'
          ? await manager.goBack(browserSessionId, stillWanted, 'agent')
          : await manager.goForward(browserSessionId, stillWanted, 'agent');
      const url = moved ? (await loaded)?.url : undefined;
      return result(request, true, await snapshotAfter(request, url));
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
        // New console errors count from when the request came.
        receivedAt: request.receivedAt,
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
    ? Math.min(Math.max(value, 1_000), MAX_SIDECAR_TIMEOUT_MS)
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
    runEnded: request.runEnded,
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
    viewportMode: request.viewportMode,
    colorScheme: request.colorScheme,
    script: request.script,
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
