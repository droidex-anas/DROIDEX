const { secretsOn, redactSecrets } = require('./nativeBrowserCredentials.cjs');
const { createBrowserReading } = require('./browserReading.cjs');
const { createBrowserScreenshot } = require('./browserScreenshot.cjs');
const { redactBrowserPageUrl } = require('./browserDiagnostics.cjs');
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
  showPrompt,
}) {
  const operationsOn = new WeakMap(); // guest contents -> { count, generation }
  const reading = createBrowserReading({
    runWithWebContentsDebugger,
    savedSecretsFor: (url) => credentials.savedSecretsFor(url),
    redactUrl: redactBrowserPageUrl,
  });
  const screenshots = createBrowserScreenshot({
    reading,
    nativeImage,
    redactUrl: redactBrowserPageUrl,
  });
  const actions = createBrowserActions({
    reading,
    runWithWebContentsDebugger,
    credentials,
    showPrompt,
    unthrottled,
    redactUrl: redactBrowserPageUrl,
    onPoint: ({ browserSessionId }, { x, y }) =>
      sendToRenderer('native-browser-agent-point', { browserSessionId, x, y }),
  });
  const waits = createBrowserWait({ reading });

  // Design mode as the app shows it: on or off, drawing or not, the scale the
  // pane draws the page at (so the overlay keeps its size on screen), the
  // numbered marks and the app's colours.
  function setDesignState(browserSessionId, state) {
    const entry = ensureEntry(browserSessionId);
    const designMode = Boolean(state?.designMode);
    // Any real scale down to fit; anything else counts as drawn at full size.
    const scale = Number(state?.scale) > 0 && Number(state?.scale) <= 1 ? Number(state.scale) : 1;
    entry.state = {
      designMode,
      pencilMode: designMode && Boolean(state?.pencilMode),
      scale,
      marks: Array.isArray(state?.marks) ? state.marks.slice(0, 100) : [],
      theme: state?.theme ?? {},
    };
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
    if (Date.now() >= request.startBy || request.runEnded?.())
      throw new Error('The browser page did not finish in time.');
    const secrets = secretsOn(entry, contents);
    try {
      const outcome = await performOnPage(contents, entry, request);
      const protectedValues = new Set([...secrets, ...(entry.credentialSecrets?.values ?? [])]);
      return redactSecrets(outcome, protectedValues);
    } catch (error) {
      const protectedValues = new Set([...secrets, ...(entry.credentialSecrets?.values ?? [])]);
      throw new Error(
        redactSecrets(error instanceof Error ? error.message : String(error), protectedValues),
      );
    }
  }

  async function performOnPage(contents, entry, request) {
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
              if (Date.now() >= request.startBy || request.runEnded())
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
    const secrets = entry.credentialSecrets?.values ?? new Set();
    if (request.action === 'network')
      return redactSecrets(
        {
          requestId: request.requestId,
          ok: true,
          networkEvents: entry.networkEvents.splice(0),
        },
        secrets,
      );
    // What a read hands over is no longer news for an action's answer.
    entry.errorTimes.length = 0;
    return redactSecrets(
      { requestId: request.requestId, ok: true, consoleEvents: entry.consoleEvents.splice(0) },
      secrets,
    );
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

  const DESIGN_CAPTURE_PADDING = 32;
  // A mark's crop is its chip's picture and the agent's view of it; a whole
  // section of a page needs no more than this many pixels across.
  const DESIGN_CAPTURE_MAX_WIDTH = 960;
  // A page draws nothing while the screen is asleep or locked, and the capture
  // then never returns; the pick goes on without its picture.
  const DESIGN_CAPTURE_MS = 6_000;
  // Pages with a capture still in flight, which may never return; later
  // picks from such a page go on without a picture rather than start another.
  const capturing = new WeakSet();
  // Crops are taken one at a time, in the order they were picked.
  let designCaptures = Promise.resolve();

  function captureDesignSelection(senderContents, selection) {
    const entry = findEntryForContents(senderContents);
    // The document the pick was made on, read as it arrives.
    const pickedOn = entry?.documents;
    const onPickedPage = () => entry.documents === pickedOn;
    const capture = designCaptures.then(() =>
      captureInTime(senderContents, entry, selection, onPickedPage),
    );
    designCaptures = capture.catch(() => undefined);
    return capture;
  }

  async function captureInTime(senderContents, entry, selection, onPickedPage) {
    if (capturing.has(senderContents)) return undefined;
    capturing.add(senderContents);
    const capture = captureSelectionRegion(entry, selection, onPickedPage).finally(() =>
      capturing.delete(senderContents),
    );
    let timer;
    const late = new Promise((resolve) => {
      timer = setTimeout(resolve, DESIGN_CAPTURE_MS, undefined);
    });
    return Promise.race([capture, late]).finally(() => clearTimeout(timer));
  }

  // Capture a picked region with some of what surrounds it, its mark drawn in.
  // It is taken as agent screenshots are, with sensitive fields painted over,
  // and only while the page is the one and at the scroll the user picked on;
  // otherwise the pick goes on without a picture.
  async function captureSelectionRegion(entry, selection, onPickedPage) {
    const box = selection?.anchor?.box;
    if (!box || !(box.width > 0) || !(box.height > 0)) return undefined;
    const contents = liveContents(entry);
    if (!contents) return undefined;
    const region = {
      x: box.x - DESIGN_CAPTURE_PADDING,
      y: box.y - DESIGN_CAPTURE_PADDING,
      width: box.width + DESIGN_CAPTURE_PADDING * 2,
      height: box.height + DESIGN_CAPTURE_PADDING * 2,
    };
    const shot = await screenshots.take(contents, entry, {
      region,
      format: 'png',
      at: { url: selection.url, scroll: selection.scroll, onPickedPage },
    });
    const image = nativeImage.createFromBuffer(Buffer.from(shot.image, 'base64'));
    // Near the viewport's edge the region is cut to it; the box is what was taken.
    if (image.getSize().width <= DESIGN_CAPTURE_MAX_WIDTH)
      return { base64: shot.image, box: shot.clip };
    const fitted = image.resize({ width: DESIGN_CAPTURE_MAX_WIDTH, quality: 'good' });
    return { base64: fitted.toPNG().toString('base64'), box: shot.clip };
  }

  return {
    setDesignState,
    applyDesignState,
    runAgentAction,
    captureDesignSelection,
    abandonOperations,
    waitForPaint,
  };
}

module.exports = { createNativeBrowserPage };
