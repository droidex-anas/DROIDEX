const { createBrowserReading } = require('./browserReading.cjs');
const { createBrowserScreenshot } = require('./browserScreenshot.cjs');
const { redactBrowserDiagnosticUrl } = require('./browserDiagnostics.cjs');
const { createBrowserActions } = require('./browserActions.cjs');
const { createBrowserWait } = require('./browserWait.cjs');
const { observeNavigation, NAVIGATION_GRACE_MS } = require('./browserNavigation.cjs');
const { callPageScript } = require('./browserPageScript.cjs');
const { useDevice } = require('./browserDevice.cjs');

const VIEWPORT_WAIT_MS = 2_000;

function createNativeBrowserPage({
  appName,
  ensureEntry,
  restoreForAction,
  liveContents,
  credentials,
  devTools,
  runWithWebContentsDebugger,
  sendToRenderer,
  findEntryForContents,
  nativeImage,
}) {
  const operationsOn = new WeakMap(); // guest contents -> { count, generation }
  const reading = createBrowserReading({
    runWithWebContentsDebugger,
    savedSecretsFor: (url) => credentials.savedSecretsFor(url),
    redactUrl: redactBrowserDiagnosticUrl,
  });
  const screenshots = createBrowserScreenshot({
    reading,
    nativeImage,
    redactUrl: redactBrowserDiagnosticUrl,
  });
  const actions = createBrowserActions({
    reading,
    runWithWebContentsDebugger,
    credentials,
    unthrottled,
    redactUrl: redactBrowserDiagnosticUrl,
    onPoint: ({ browserSessionId }, { x, y }) =>
      sendToRenderer('native-browser-agent-point', { browserSessionId, x, y }),
  });
  const waits = createBrowserWait({ reading });

  // `scale` is how large the pane draws the page; the page script keeps its
  // design labels and composer readable at it.
  function setDesignMode(browserSessionId, active, scale) {
    const entry = ensureEntry(browserSessionId);
    const next = Boolean(active);
    // Any real scale down to fit; anything else counts as drawn at full size.
    const shownAt = Number(scale) > 0 && Number(scale) <= 1 ? Number(scale) : 1;
    if (entry.state.designMode === next && entry.state.scale === shownAt) return;
    entry.state.designMode = next;
    entry.state.scale = shownAt;
    if (!entry.state.designMode) entry.state.pencilMode = false;
    return applyDesignState(entry);
  }

  function setPencilMode(browserSessionId, active) {
    const entry = ensureEntry(browserSessionId);
    const next = entry.state.designMode && Boolean(active);
    if (entry.state.pencilMode === next) return;
    entry.state.pencilMode = next;
    return applyDesignState(entry);
  }

  // A page the pane does not show never keeps the design overlay, so an agent
  // working in it is never blocked by one.
  function applyDesignState(entry) {
    const contents = liveContents(entry);
    if (!contents) return undefined;
    const designState = entry.shown
      ? entry.state
      : { ...entry.state, designMode: false, pencilMode: false };
    return callPageScript(contents, '__droidexApplyDesignState', designState).catch((err) =>
      console.error(`failed to apply browser design state: ${err.message}`),
    );
  }

  async function runAgentAction(request) {
    const pageless = runPagelessAction(request);
    if (pageless) return pageless;
    const entry = await restoreForAction(request.browserSessionId);
    const contents = liveContents(entry);
    if (!contents) throw new Error(`${appName} browser is not open.`);
    // Waking the page can outlast the caller; then nothing more is done.
    if (Date.now() >= request.startBy) throw new Error('The browser page did not finish in time.');
    if (request.action === 'find') {
      const found = await reading.find(contents, entry, request.query);
      return { requestId: request.requestId, ok: true, ...found };
    }
    if (request.action === 'readPage') {
      const text = await reading.readPage(contents, entry, {
        ref: request.ref,
        filter: request.filter,
        maxChars: request.maxChars,
      });
      return { requestId: request.requestId, ok: true, text };
    }
    if (request.action === 'readText') {
      const text = await reading.readText(contents, { maxChars: request.maxChars });
      return { requestId: request.requestId, ok: true, text };
    }
    if (request.action === 'screenshot') {
      // Capturing needs the page to keep producing frames.
      const shot = await unthrottled(contents, () => screenshots.take(contents, entry, request));
      return { requestId: request.requestId, ok: true, ...shot };
    }
    if (request.action === 'awaitViewport') {
      // The page takes its new size at full speed, shown or not.
      await unthrottled(contents, () => laidOutAt(contents, request.viewport));
      return actions.act(contents, entry, { ...request, action: 'snapshot' });
    }
    if (request.action === 'evaluate') {
      // The user's answer can outlast the browser, its guest or the caller.
      const stillOpen = () => {
        if (findEntryForContents(contents) !== entry) throw new Error('The browser page closed.');
      };
      // Watched from the moment the script runs, not while the user is still
      // being asked: only a navigation the script caused counts.
      let navigation;
      try {
        // The page runs at full speed for the script, shown or not.
        const value = await unthrottled(contents, async () => {
          const ran = await devTools
            .evaluate(contents, request.script, () => {
              stillOpen();
              if (Date.now() >= request.startBy)
                throw new Error('The browser page did not finish in time.');
              navigation = observeNavigation(contents);
            })
            .then(
              (result) => ({ result }),
              (error) => ({ error }),
            );
          // A script can send the page elsewhere. The answer then names the
          // page that led to, and the next action finds it loaded. A script
          // whose page went before it returned has only its failure to show.
          if (navigation && !navigation.started())
            await navigation.startsWithin(NAVIGATION_GRACE_MS);
          if (!navigation?.started()) {
            if (ran.error) throw ran.error;
            return ran.result;
          }
          await navigation.wait();
          return ran.error ? ran.error.message : ran.result;
        });
        stillOpen();
        const after = await actions.act(contents, entry, { ...request, action: 'snapshot' });
        return { ...after, text: `${value}\n${after.text}` };
      } finally {
        navigation?.dispose();
      }
    }
    if (request.action === 'wait') {
      // The page runs at full speed while the agent waits on it.
      await unthrottled(contents, () => waits.wait(contents, entry, request));
      return actions.act(contents, entry, { ...request, action: 'snapshot' });
    }
    return actions.act(contents, entry, request);
  }

  // Reading the logs or recording the viewport or scheme never needs the page
  // itself, so it never wakes or remounts one.
  function runPagelessAction(request) {
    if (!['resize', 'colorScheme', 'network', 'console'].includes(request.action)) return undefined;
    const entry = ensureEntry(request.browserSessionId);
    if (request.action === 'resize') {
      // The renderer sizes the page from the session's viewport; main keeps
      // the size's name for the device it asks for.
      return deviceSet(entry, request, 'viewportMode');
    }
    if (request.action === 'colorScheme') return deviceSet(entry, request, 'colorScheme');
    // A read hands over what came in since the last one, so one whose caller
    // has given up takes nothing.
    if (Date.now() >= request.startBy) throw new Error('The browser page did not finish in time.');
    if (request.action === 'network')
      return {
        requestId: request.requestId,
        ok: true,
        networkEvents: entry.networkEvents.splice(0),
      };
    // What a read hands over is no longer news for an action's answer.
    entry.errorTimes.length = 0;
    return { requestId: request.requestId, ok: true, consoleEvents: entry.consoleEvents.splice(0) };
  }

  // Records the size's name or the scheme and answers once a live guest has
  // taken it. It is recorded first, so a guest mounted meanwhile takes it too;
  // a guest that refuses it keeps what it had, and so does its entry.
  async function deviceSet(entry, request, field) {
    const contents = liveContents(entry);
    const before = entry[field];
    entry[field] = request[field];
    try {
      await useDevice(contents, { [field]: request[field] });
    } catch (error) {
      if (liveContents(entry) === contents && entry[field] === request[field])
        entry[field] = before;
      throw error;
    }
    return { requestId: request.requestId, ok: true };
  }

  // The pane resizes the page a frame or two after the sidecar sets a size; the
  // page has taken it once it reports it.
  async function laidOutAt(contents, { width, height }) {
    const until = Date.now() + VIEWPORT_WAIT_MS;
    while (Date.now() < until) {
      const size = await runWithWebContentsDebugger(contents, (dbg) =>
        dbg.sendCommand('Runtime.evaluate', {
          expression: '[innerWidth, innerHeight]',
          returnByValue: true,
        }),
      );
      const [w, h] = size?.result?.value ?? [];
      if (w === width && h === height) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('The page did not take the new size in time.');
  }

  // A design-mode crop, as PNG; agent screenshots go through browserScreenshot.
  async function capture(browserSessionId, box) {
    const entry = await restoreForAction(browserSessionId);
    const contents = liveContents(entry);
    if (!contents) throw new Error(`${appName} browser is not open.`);
    return unthrottled(contents, async () => {
      // A box crop is always already on-screen (the user just selected/sketched
      // it). Capture the composited frame directly: capturePage never re-renders
      // the page off-screen the way CDP's captureBeyondViewport does, so the live
      // pane no longer flickers on every selection or sketch.
      if (box) {
        const rect = normalizeCaptureRect(entry, box);
        if (!rect) throw new Error('Requested capture region is empty or out of bounds.');
        const cropped = await contents.capturePage(rect).catch(() => undefined);
        if (cropped && !cropped.isEmpty()) return cropped.toPNG().toString('base64');
      }
      const data = await captureViaCdp(contents, { scale: 2, box }).catch((err) => {
        console.error(`cdp capture failed, falling back to viewport: ${err.message}`);
        return undefined;
      });
      if (data) return data;
      const rect = normalizeCaptureRect(entry, box);
      // A supplied box that normalizes away is an empty/out-of-bounds crop; fail
      // rather than silently returning the full viewport (unintended content).
      if (box && !rect) throw new Error('Requested capture region is empty or out of bounds.');
      const image = rect ? await contents.capturePage(rect) : await contents.capturePage();
      return image.isEmpty() ? undefined : image.toPNG().toString('base64');
    });
  }

  // A page that has just woken drops input until it paints again, so input
  // waits for two frames first (bounded, in case the page cannot paint).
  async function waitForPaint(browserSessionId, timeoutMs = 1_000) {
    const entry = await restoreForAction(browserSessionId);
    const contents = liveContents(entry);
    if (!contents) return;
    let timer;
    await unthrottled(contents, () =>
      Promise.race([
        contents
          .executeJavaScript(
            `new Promise((painted) => {
              setTimeout(painted, ${timeoutMs});
              requestAnimationFrame(() => requestAnimationFrame(painted));
            })`,
            true,
          )
          .catch(() => undefined),
        new Promise((resolve) => {
          timer = setTimeout(resolve, timeoutMs);
        }),
      ]),
    );
    clearTimeout(timer);
  }

  // A page runs unthrottled while any operation on it is in flight. Restored as
  // soon as the last one ends, shown or not: re-enabling throttling on a guest
  // that is already hidden does not take effect, so a flag left lifted would
  // keep the page running after the pane closes.
  async function unthrottled(contents, run) {
    const operations = operationsOn.get(contents) ?? { count: 0, generation: 0 };
    operationsOn.set(contents, operations);
    operations.count += 1;
    contents.setBackgroundThrottling(false);
    const { generation } = operations;
    try {
      return await run();
    } finally {
      // Abandoned operations were already accounted for.
      if (operations.generation === generation && --operations.count === 0) throttle(contents);
    }
  }

  // Main gave up on the work in flight on this page: it stops keeping the page
  // unthrottled, and whatever it does afterwards is not counted.
  function abandonOperations(contents) {
    const operations = operationsOn.get(contents);
    if (operations) {
      operations.generation += 1;
      operations.count = 0;
    }
    throttle(contents);
  }

  function throttle(contents) {
    try {
      if (!contents.isDestroyed()) contents.setBackgroundThrottling(true);
    } catch {
      // Cleanup is best-effort when the browser closes during an action.
    }
  }

  async function captureViaCdp(contents, { scale, box }) {
    return runWithWebContentsDebugger(contents, async (dbg) => {
      const params = { format: 'png', captureBeyondViewport: Boolean(box) };
      const metrics = await dbg.sendCommand('Page.getLayoutMetrics');
      const viewport = metrics.cssVisualViewport || metrics.visualViewport;
      const content = metrics.cssContentSize || metrics.contentSize;
      if (box) {
        // Selection boxes are viewport CSS coordinates; clips beyond the
        // viewport are in page coordinates, so offset by the current scroll.
        const x = (viewport.pageX || 0) + Math.max(0, box.x);
        const y = (viewport.pageY || 0) + Math.max(0, box.y);
        const width = Math.min(box.width, content.width - x);
        const height = Math.min(box.height, content.height - y);
        if (width <= 0 || height <= 0)
          throw new Error('Requested capture region is empty or out of bounds.');
        params.clip = { x, y, width, height, scale };
      } else if (viewport.clientWidth > 0 && viewport.clientHeight > 0) {
        params.clip = {
          x: 0,
          y: 0,
          width: viewport.clientWidth,
          height: viewport.clientHeight,
          scale,
        };
      }
      const result = await dbg.sendCommand('Page.captureScreenshot', params);
      return result?.data || undefined;
    });
  }

  const DESIGN_CAPTURE_PADDING = 32;
  // A page draws nothing while the screen is asleep or locked, and the capture
  // then never returns; the prompt goes on without its picture.
  const DESIGN_CAPTURE_MS = 6_000;
  // Pages with a capture still in flight, which may never return; later
  // prompts from such a page go on without a picture rather than start another.
  const capturing = new WeakSet();

  async function captureDesignSelection(senderContents, selection) {
    if (capturing.has(senderContents)) return undefined;
    capturing.add(senderContents);
    const capture = captureSelectionRegion(senderContents, selection).finally(() =>
      capturing.delete(senderContents),
    );
    let timer;
    const late = new Promise((resolve) => {
      timer = setTimeout(resolve, DESIGN_CAPTURE_MS, undefined);
    });
    return Promise.race([capture, late]).finally(() => clearTimeout(timer));
  }

  // Capture the prompt's selection region with surrounding context while the
  // in-page annotations are still visible.
  async function captureSelectionRegion(senderContents, selection) {
    const box = selection?.anchor?.box;
    if (!box || !(box.width > 0) || !(box.height > 0)) return undefined;
    const entry = findEntryForContents(senderContents);
    const contents = liveContents(entry);
    if (!contents) return undefined;
    const padded = {
      x: Math.max(0, box.x - DESIGN_CAPTURE_PADDING),
      y: Math.max(0, box.y - DESIGN_CAPTURE_PADDING),
      width: box.width + DESIGN_CAPTURE_PADDING * 2,
      height: box.height + DESIGN_CAPTURE_PADDING * 2,
    };
    // Crop the on-screen composited frame (annotations are visible DOM overlays)
    // instead of a CDP captureBeyondViewport screenshot, which re-rasters the
    // page off-screen and flickers the pane on every send.
    const rect = normalizeCaptureRect(entry, padded);
    if (rect) {
      const image = await contents.capturePage(rect).catch(() => undefined);
      if (image && !image.isEmpty())
        return { base64: image.toPNG().toString('base64'), box: padded };
    }
    const base64 = await captureViaCdp(contents, { scale: 2, box: padded }).catch(() => undefined);
    return base64 ? { base64, box: padded } : undefined;
  }

  // Boxes are in the page's CSS pixels, which for a guest are also its view
  // pixels; capturePage clips anything past the page's edge.
  function normalizeCaptureRect(_entry, box) {
    if (!box) return undefined;
    const x = Math.max(0, Math.round(box.x));
    const y = Math.max(0, Math.round(box.y));
    const width = Math.round(box.width);
    const height = Math.round(box.height);
    if (width <= 0 || height <= 0) return undefined;
    return { x, y, width, height };
  }

  return {
    setDesignMode,
    setPencilMode,
    applyDesignState,
    runAgentAction,
    capture,
    captureDesignSelection,
    abandonOperations,
    waitForPaint,
  };
}

module.exports = { createNativeBrowserPage };
