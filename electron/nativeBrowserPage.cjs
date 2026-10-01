const { createBrowserReading } = require('./browserReading.cjs');
const { redactBrowserDiagnosticUrl } = require('./browserDiagnostics.cjs');

function createNativeBrowserPage({
  appName,
  ensureEntry,
  restoreForAction,
  liveContents,
  normalizeBrowserViewport,
  credentials,
  runWithWebContentsDebugger,
  findEntryForContents,
}) {
  const operationsOn = new WeakMap(); // guest contents -> { count, generation }
  const reading = createBrowserReading({
    runWithWebContentsDebugger,
    savedSecretsFor: (url) => credentials.savedSecretsFor(url),
    redactUrl: redactBrowserDiagnosticUrl,
  });

  function setDesignMode(browserSessionId, active) {
    const entry = ensureEntry(browserSessionId);
    const next = Boolean(active);
    if (entry.state.designMode === next) return;
    entry.state.designMode = next;
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
    return contents
      .executeJavaScript(
        `window.__DROIDMAXX_APPLY_DESIGN_STATE?.(${JSON.stringify(designState)});`,
        true,
      )
      .catch((err) => console.error(`failed to apply browser design state: ${err.message}`));
  }

  async function runAgentAction(request) {
    const pageless = runPagelessAction(request);
    if (pageless) return pageless;
    const entry = await restoreForAction(request.browserSessionId);
    const contents = liveContents(entry);
    if (!contents) throw new Error(`${appName} browser is not open.`);
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
    const navigation = observeAgentNavigation(contents);
    const operation = liftBackgroundThrottling(contents);
    try {
      if (request.action === 'fillCredentials') {
        return withNativeBrowserHistory(
          contents,
          await credentials.fillForAgent(contents, request),
        );
      }
      // Once a navigation starts, an action still resolving its target gives
      // up rather than act on the next page.
      const execution = withRefTarget(contents, entry, request)
        .then(async (target) => {
          if (target.document) await reading.assertDocument(contents, target.document);
          return executeAgentAction(contents, target, navigation);
        })
        .then(
          (result) => ({ type: 'result', result }),
          (error) => ({ type: 'error', error }),
        );
      const outcome = await Promise.race([
        execution,
        navigation.wait().then(() => ({ type: 'navigation' })),
      ]);
      if (outcome.type === 'navigation') {
        return await snapshotAfterNavigation(contents, request);
      }
      if (outcome.type === 'error') {
        const navigated = outcome.error?.navigated || isNavigationExecutionError(outcome.error);
        if (!navigation.started() || !navigated) throw outcome.error;
        await navigation.wait();
        return await snapshotAfterNavigation(contents, request);
      }
      return withNativeBrowserHistory(contents, outcome.result);
    } finally {
      navigation.dispose();
      restoreBackgroundThrottling(contents, operation);
    }
  }

  // Reading the logs or recording the viewport never needs the page itself,
  // so it never wakes or remounts one.
  function runPagelessAction(request) {
    if (!['resize', 'network', 'console'].includes(request.action)) return undefined;
    const entry = ensureEntry(request.browserSessionId);
    if (request.action === 'resize') {
      // The renderer sizes the page from the session's viewport.
      entry.viewport = normalizeBrowserViewport(request.viewport);
      return { requestId: request.requestId, ok: true };
    }
    if (request.action === 'network') {
      const networkEvents = entry.networkEvents.slice();
      if (request.clearNetworkLog) entry.networkEvents.length = 0;
      return { requestId: request.requestId, ok: true, networkEvents };
    }
    const consoleEvents = entry.consoleEvents.slice();
    if (request.clearConsoleLog) entry.consoleEvents.length = 0;
    return { requestId: request.requestId, ok: true, consoleEvents };
  }

  // A ref from browser_read_page becomes the point or selector the action needs.
  async function withRefTarget(contents, entry, request) {
    if (!request.ref) return request;
    if (request.action === 'selectOption') {
      await reading.selectOption(contents, entry, request.ref, request.text ?? '');
      return { ...request, action: 'snapshot' };
    }
    if (request.action === 'inspect')
      return { ...request, ...(await reading.selectorForRef(contents, entry, request.ref)) };
    const { x, y, document } = await reading.pointForRef(contents, entry, request.ref);
    return { ...request, x, y, document, selector: undefined };
  }

  function ensureCurrent(navigation) {
    if (!navigation.started()) return;
    const error = new Error('The page changed before the action ran; call browser_read_page.');
    error.navigated = true;
    throw error;
  }

  async function executeAgentAction(contents, request, navigation) {
    ensureCurrent(navigation);
    if (
      request.action === 'scroll' &&
      Number.isFinite(Number(request.x)) &&
      Number.isFinite(Number(request.y))
    ) {
      const x = Math.round(Number(request.x));
      const y = Math.round(Number(request.y));
      const pixels = Math.max(1, Math.round(Number(request.pixels) || 500));
      const horizontal = request.direction === 'left' || request.direction === 'right';
      ensureCurrent(navigation);
      contents.sendInputEvent({
        type: 'mouseWheel',
        x,
        y,
        deltaX: horizontal ? (request.direction === 'left' ? -pixels : pixels) : 0,
        deltaY: horizontal ? 0 : request.direction === 'up' ? -pixels : pixels,
        canScroll: true,
      });
      return contents.executeJavaScript(
        `window.__DROIDMAXX_AGENT_ACTION?.(${JSON.stringify({
          ...request,
          action: 'snapshot',
        })});`,
        true,
      );
    }
    if (request.action === 'click' || request.action === 'hover') {
      const x = Math.round(Number(request.x));
      const y = Math.round(Number(request.y));
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new Error('Browser pointer interaction requires finite viewport coordinates.');
      }
      ensureCurrent(navigation);
      contents.sendInputEvent({ type: 'mouseMove', x, y, movementX: 0, movementY: 0 });
      if (request.action === 'click') {
        contents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
        contents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
      }
      return contents.executeJavaScript(
        `window.__DROIDMAXX_AGENT_ACTION?.(${JSON.stringify({
          ...request,
          action: 'snapshot',
        })});`,
        true,
      );
    }
    return contents.executeJavaScript(
      `window.__DROIDMAXX_AGENT_ACTION?.(${JSON.stringify(request)});`,
      true,
    );
  }

  async function snapshotAfterNavigation(contents, request) {
    try {
      const result = await contents.executeJavaScript(
        `window.__DROIDMAXX_AGENT_ACTION?.(${JSON.stringify({
          requestId: request.requestId,
          action: 'snapshot',
        })});`,
        true,
      );
      return withNativeBrowserHistory(contents, result);
    } catch {
      return withNativeBrowserHistory(contents, { requestId: request.requestId, ok: true });
    }
  }

  function withNativeBrowserHistory(contents, result) {
    if (!result || typeof result !== 'object') return result;
    if (contents.isDestroyed()) return result;
    const history = contents.navigationHistory;
    if (!history || !result.snapshot) return result;
    return {
      ...result,
      snapshot: {
        ...result.snapshot,
        canGoBack: history.canGoBack(),
        canGoForward: history.canGoForward(),
      },
    };
  }

  function observeAgentNavigation(contents, timeoutMs = 7_000) {
    let didStart = false;
    let settled = false;
    let timeout;
    let resolveCompletion;
    const completion = new Promise((resolve) => {
      resolveCompletion = resolve;
    });
    const finish = () => {
      if (settled) return;
      settled = true;
      resolveCompletion();
    };
    const onStart = (_event, _url, _isInPlace, isMainFrame) => {
      if (!isMainFrame || didStart) return;
      didStart = true;
      timeout = setTimeout(finish, timeoutMs);
    };
    const onFinish = () => {
      if (didStart) finish();
    };
    const onFail = (_event, errorCode, _description, _url, isMainFrame) => {
      if (isMainFrame && errorCode !== -3) finish();
    };
    const onDestroyed = () => finish();
    contents.on('did-start-navigation', onStart);
    contents.on('did-finish-load', onFinish);
    contents.on('did-fail-load', onFail);
    contents.on('destroyed', onDestroyed);
    return {
      started: () => didStart,
      wait: () => completion,
      dispose: () => {
        clearTimeout(timeout);
        contents.removeListener('did-start-navigation', onStart);
        contents.removeListener('did-finish-load', onFinish);
        contents.removeListener('did-fail-load', onFail);
        contents.removeListener('destroyed', onDestroyed);
      },
    };
  }

  function isNavigationExecutionError(err) {
    const message = String(err?.message || err).toLowerCase();
    return (
      message.includes('script execution was interrupted') ||
      message.includes('execution context was destroyed') ||
      message.includes('frame was disposed') ||
      message.includes('object has been destroyed')
    );
  }

  async function capture(browserSessionId, box, options = {}) {
    const entry = await restoreForAction(browserSessionId);
    const contents = liveContents(entry);
    if (!contents) throw new Error(`${appName} browser is not open.`);
    const operation = liftBackgroundThrottling(contents);
    try {
      const fullPage = Boolean(options?.fullPage);
      const scale =
        typeof options?.deviceScaleFactor === 'number' && options.deviceScaleFactor > 0
          ? options.deviceScaleFactor
          : 2;
      // A box crop is always already on-screen (the user just selected/sketched
      // it). Capture the composited frame directly: capturePage never re-renders
      // the page off-screen the way CDP's captureBeyondViewport does, so the live
      // pane no longer flickers on every selection or sketch.
      if (box && !fullPage) {
        const rect = normalizeCaptureRect(entry, box);
        if (!rect) throw new Error('Requested capture region is empty or out of bounds.');
        const cropped = await contents.capturePage(rect).catch(() => undefined);
        if (cropped && !cropped.isEmpty()) return cropped.toPNG().toString('base64');
      }
      const data = await captureViaCdp(contents, { fullPage, scale, box }).catch((err) => {
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
    } finally {
      restoreBackgroundThrottling(contents, operation);
    }
  }

  // A page that has just woken drops input until it paints again, so input
  // waits for two frames first (bounded, in case the page cannot paint).
  async function waitForPaint(browserSessionId, timeoutMs = 1_000) {
    const entry = await restoreForAction(browserSessionId);
    const contents = liveContents(entry);
    if (!contents) return;
    const operation = liftBackgroundThrottling(contents);
    let timer;
    try {
      await Promise.race([
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
      ]);
    } finally {
      clearTimeout(timer);
      restoreBackgroundThrottling(contents, operation);
    }
  }

  // A page runs unthrottled while any operation on it is in flight. Restored as
  // soon as the last one ends, shown or not: re-enabling throttling on a guest
  // that is already hidden does not take effect, so a flag left lifted would
  // keep the page running after the pane closes.
  function liftBackgroundThrottling(contents) {
    const operations = operationsOn.get(contents) ?? { count: 0, generation: 0 };
    operations.count += 1;
    operationsOn.set(contents, operations);
    contents.setBackgroundThrottling(false);
    return operations.generation;
  }

  function restoreBackgroundThrottling(contents, generation) {
    const operations = operationsOn.get(contents);
    // Abandoned operations were already accounted for.
    if (!operations || operations.generation !== generation) return;
    operations.count -= 1;
    if (operations.count > 0) return;
    throttle(contents);
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

  async function captureViaCdp(contents, { fullPage, scale, box }) {
    return runWithWebContentsDebugger(contents, async (dbg) => {
      const params = { format: 'png', captureBeyondViewport: Boolean(fullPage) || Boolean(box) };
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
      } else if (fullPage) {
        if (content.width > 0 && content.height > 0) {
          params.clip = { x: 0, y: 0, width: content.width, height: content.height, scale };
        }
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

  // Capture the prompt's selection region with surrounding context while the
  // in-page annotations are still visible.
  async function captureDesignSelection(senderContents, selection) {
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
