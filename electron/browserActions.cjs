// Agent actions on a page, sent from main through CDP: trusted pointer and
// keyboard input that also reaches cross-site frames, and field changes made
// on a ref's own element. The page script never acts for the agent. An action
// stops before it sends anything once a new document starts loading, and one
// whose input never went out fails rather than report a navigation it did not
// cause.

const {
  send,
  frameHolds,
  focusedSession,
  topOwner,
  documentFrames,
} = require('./browserFrames.cjs');
const { callPageScript } = require('./browserPageScript.cjs');
const { refFor } = require('./browserRefs.cjs');
const { keyOf, modifiersOf, pressOn } = require('./browserKeys.cjs');

const PAGE_CHANGED = 'The page changed before the action ran; call browser_read_page.';
const NAVIGATION_WAIT_MS = 7_000;
const NAVIGATION_GRACE_MS = 150;
const MAX_CLICKS = 3;
const MAX_REPEAT = 50;
const SCROLL_SETTLE_MS = 1_000;
const SCROLL_START_MS = 300;
const SCROLL_POLL_MS = 40;
const CONSOLE_ERROR = 3;
function createBrowserActions({
  reading,
  runWithWebContentsDebugger,
  credentials,
  unthrottled,
  redactUrl,
}) {
  async function act(contents, entry, request) {
    if (request.action === 'snapshot') return result(request, contents, entry, Date.now());
    if (request.action === 'inspect') return inspect(contents, entry, request);
    const since = Date.now();
    const urlBefore = contents.getURL();
    const navigation = observeNavigation(contents);
    try {
      return await unthrottled(contents, async () => {
        const step = { navigation, sent: false };
        const outcome = await Promise.race([
          perform(contents, entry, request, step).then(
            () => ({ type: 'done' }),
            (error) => ({ type: 'error', error }),
          ),
          navigation.wait().then(() => ({ type: 'navigation' })),
        ]);
        if (outcome.type === 'navigation' && !step.sent) throw new Error(PAGE_CHANGED);
        if (outcome.type === 'error' && !(navigation.started() && isNavigationError(outcome.error)))
          throw outcome.error;
        // An action that started a navigation reports the page it led to; a
        // click on a link starts one a moment after the input lands.
        const mayNavigate =
          ['click', 'press'].includes(request.action) ||
          (request.action === 'type' && request.submit);
        if (mayNavigate && step.sent && !navigation.started())
          await navigation.startsWithin(NAVIGATION_GRACE_MS);
        if (navigation.started()) await navigation.wait();
        return result(request, contents, entry, since, urlBefore);
      });
    } finally {
      navigation.dispose();
    }
  }

  function perform(contents, entry, request, step) {
    switch (request.action) {
      case 'click':
      case 'hover':
        return pointer(contents, entry, request, step);
      case 'scroll':
        return scroll(contents, entry, request, step);
      case 'type':
        return type(contents, entry, request, step);
      case 'press':
        return press(contents, request, step);
      case 'fill':
        if (!request.ref) throw new Error('Filling a field needs its ref from browser_read_page.');
        return reading.callOnRef(contents, entry, request.ref, [request.value], FILL, () =>
          startInput(step),
        );
      case 'fillCredentials':
        startInput(step);
        return credentials.fillForAgent(contents);
      default:
        throw new Error(`Unsupported browser action: ${request.action}`);
    }
  }

  async function pointer(contents, entry, request, step) {
    const target = await targetOf(contents, entry, request);
    const { x, y } = target;
    const modifiers = modifiersOf(request.modifiers);
    const events = [{ type: 'mouseMoved', x, y, modifiers }];
    if (request.action === 'click') {
      const button = ['left', 'right', 'middle'].includes(request.button) ? request.button : 'left';
      const clicks = Math.min(MAX_CLICKS, Math.max(1, Math.round(Number(request.count) || 1)));
      for (let clickCount = 1; clickCount <= clicks; clickCount++) {
        const press = { x, y, button, clickCount, modifiers };
        events.push({ type: 'mousePressed', ...press }, { type: 'mouseReleased', ...press });
      }
    }
    await dispatchMouse(contents, step, target, events);
  }

  // A wheel turn at the ref (scrolling whatever scrolls under it) or at the
  // given point; a ref with no direction is only brought into view.
  async function scroll(contents, entry, request, step) {
    if (request.ref && !request.direction) {
      startInput(step);
      await reading.pointForRef(contents, entry, request.ref);
      return;
    }
    // No cover check: the wheel scrolls whatever is under the point.
    const target = request.ref
      ? await reading.pointForRef(contents, entry, request.ref)
      : await targetOf(contents, entry, request);
    const pixels = Math.max(1, Math.round(Number(request.pixels) || 500));
    const sign = request.direction === 'up' || request.direction === 'left' ? -1 : 1;
    const horizontal = request.direction === 'left' || request.direction === 'right';
    const before = await scrollPosition(contents);
    await dispatchMouse(contents, step, target, [
      {
        type: 'mouseWheel',
        x: target.x,
        y: target.y,
        deltaX: horizontal ? sign * pixels : 0,
        deltaY: horizontal ? 0 : sign * pixels,
      },
    ]);
    await scrollSettled(contents, before);
  }

  // Wheel scrolling animates, so the page is read once it has moved and
  // stopped, or once nothing has moved for a moment (nothing could scroll).
  async function scrollSettled(contents, before) {
    const started = Date.now();
    let last = before;
    while (Date.now() - started < SCROLL_SETTLE_MS) {
      await new Promise((resolve) => setTimeout(resolve, SCROLL_POLL_MS));
      const now = await scrollPosition(contents);
      if (now === before && Date.now() - started > SCROLL_START_MS) return;
      if (now !== before && now === last) return;
      last = now;
    }
  }

  async function scrollPosition(contents) {
    const metrics = await runWithWebContentsDebugger(contents, (dbg) =>
      dbg.sendCommand('Page.getLayoutMetrics'),
    );
    return `${metrics?.cssVisualViewport.pageX},${metrics?.cssVisualViewport.pageY}`;
  }

  // Text goes to the session of the frame that holds the focus (a cross-site
  // frame only takes keys sent to its own session); a ref is focused first.
  async function type(contents, entry, request, step) {
    const text = String(request.text ?? '');
    await runWithWebContentsDebugger(contents, async (dbg) => {
      let sessionId;
      if (request.ref) {
        const target = await reading.lookupRef(dbg, entry, request.ref);
        sessionId = target.frame.sessionId;
        await send(dbg, sessionId, 'DOM.focus', { backendNodeId: target.backendNodeId });
      } else {
        sessionId = await focusedSession(dbg);
      }
      startInput(step);
      if (text) await send(dbg, sessionId, 'Input.insertText', { text });
      if (request.submit) await pressOn(dbg, sessionId, keyOf('Enter'));
    });
  }

  async function press(contents, request, step) {
    const key = keyOf(request.key);
    const repeat = Math.min(MAX_REPEAT, Math.max(1, Math.round(Number(request.repeat) || 1)));
    await runWithWebContentsDebugger(contents, async (dbg) => {
      const sessionId = await focusedSession(dbg);
      for (let i = 0; i < repeat; i++) {
        startInput(step);
        await pressOn(dbg, sessionId, key);
      }
    });
  }

  // A ref becomes the point at its middle, scrolled into view, and is refused
  // when something else would receive input there.
  async function targetOf(contents, entry, request) {
    if (!request.ref) {
      const x = Math.round(Number(request.x));
      const y = Math.round(Number(request.y));
      if (!Number.isFinite(x) || !Number.isFinite(y))
        throw new Error('Pass a ref from browser_read_page, or viewport x and y.');
      return { x, y };
    }
    const target = await reading.pointForRef(contents, entry, request.ref);
    const cover = await coverOf(contents, entry, request.ref, target);
    if (cover) throw new Error(`${request.ref} is covered by ${cover} there; deal with it first.`);
    return target;
  }

  // What would receive input at a ref's point instead of the ref's element,
  // described with a ref of its own; nothing when the ref would. A ref in a
  // cross-site frame is checked as far as that frame's iframe.
  function coverOf(contents, entry, ref, point) {
    return reading.withPage(contents, async (dbg) => {
      const target = await reading.lookupRef(dbg, entry, ref);
      // The hit test takes page coordinates; the point is in the viewport.
      const { cssLayoutViewport: view } = await dbg.sendCommand('Page.getLayoutMetrics');
      const hit = await dbg
        .sendCommand('DOM.getNodeForLocation', {
          x: point.x + view.pageX,
          y: point.y + view.pageY,
          includeUserAgentShadowDOM: false,
          ignorePointerEventsNone: true,
        })
        .catch(() => undefined);
      if (!hit) return undefined;
      if (target.frame.sessionId) {
        const owner = await topOwner(dbg, target.frame.sessionId);
        return owner === hit.backendNodeId ? undefined : describeCover(dbg, entry, hit);
      }
      if (hit.frameId === target.frame.id && (await holds(dbg, target.backendNodeId, hit)))
        return undefined;
      return describeCover(dbg, entry, hit);
    });
  }

  async function holds(dbg, backendNodeId, hit) {
    const [{ object: ref }, { object: other }] = await Promise.all([
      dbg.sendCommand('DOM.resolveNode', { backendNodeId }),
      dbg.sendCommand('DOM.resolveNode', { backendNodeId: hit.backendNodeId }),
    ]);
    try {
      const { result: held } = await dbg.sendCommand('Runtime.callFunctionOn', {
        objectId: ref.objectId,
        functionDeclaration: CONTAINS,
        arguments: [{ objectId: other.objectId }],
        returnByValue: true,
      });
      return held.value === true;
    } finally {
      for (const { objectId } of [ref, other])
        await dbg.sendCommand('Runtime.releaseObject', { objectId }).catch(() => undefined);
    }
  }

  async function describeCover(dbg, entry, hit) {
    const { nodes } = await dbg
      .sendCommand('Accessibility.getPartialAXTree', {
        backendNodeId: hit.backendNodeId,
        fetchRelatives: false,
      })
      .catch(() => ({ nodes: [] }));
    const node = nodes.find((candidate) => !candidate.ignored);
    const name = String(node?.name?.value ?? '').slice(0, 80);
    // An element the accessibility tree ignores is named by its tag.
    const role =
      node && (name || !['none', 'generic'].includes(node.role?.value))
        ? node.role.value
        : `<${(await dbg.sendCommand('DOM.describeNode', { backendNodeId: hit.backendNodeId })).node.localName}>`;
    const frame = (await documentFrames(dbg)).find((candidate) => candidate.id === hit.frameId);
    const ref = frame ? ` (${refFor(entry, frame.loaderId, hit.backendNodeId)})` : '';
    return `${role}${name ? ` "${name}"` : ''}${ref}`;
  }

  // Before each event, inside the debugger queue, a new page or a replaced
  // ref document stops the gesture.
  function dispatchMouse(contents, step, target, events) {
    return runWithWebContentsDebugger(contents, async (dbg) => {
      for (const event of events) {
        if (target.document && !(await frameHolds(dbg, target.sessionId, target.document)))
          throw new Error(PAGE_CHANGED);
        startInput(step);
        await dbg.sendCommand('Input.dispatchMouseEvent', event);
      }
    });
  }

  async function inspect(contents, entry, request) {
    const target = request.ref
      ? await reading.selectorForRef(contents, entry, request.ref)
      : { selector: request.selector };
    if (target.document) await reading.assertDocument(contents, target.document);
    const inspection = await callPageScript(contents, '__droidexInspect', target.selector);
    return { requestId: request.requestId, ok: true, inspection };
  }

  // The page after an action, with what the agent reads about it: what
  // changed besides the action itself, then the [Title · url] footer.
  async function result(request, contents, entry, since, urlBefore = contents.getURL()) {
    const snapshot = await pageSnapshot(contents);
    const notes = [];
    if (snapshot.url !== urlBefore) notes.push('The page went to a new address.');
    const errors = entry.consoleEvents.filter(
      (event) => event.level === CONSOLE_ERROR && event.timestamp >= since,
    ).length;
    if (errors)
      notes.push(
        `${errors} new console error${errors === 1 ? '' : 's'}; browser_console has them.`,
      );
    notes.push(`[${snapshot.title || 'Untitled'} · ${redactUrl(snapshot.url)}]`);
    return { requestId: request.requestId, ok: true, snapshot, text: notes.join('\n') };
  }

  // Where the page is, read by main rather than asked of the page.
  async function pageSnapshot(contents) {
    if (contents.isDestroyed()) throw new Error('The browser page closed.');
    const metrics = await runWithWebContentsDebugger(contents, (dbg) =>
      dbg.sendCommand('Page.getLayoutMetrics'),
    ).catch(() => undefined);
    const view = metrics?.cssVisualViewport;
    const history = contents.navigationHistory;
    return {
      url: contents.getURL(),
      title: contents.getTitle(),
      scroll: { x: Math.round(view?.pageX ?? 0), y: Math.round(view?.pageY ?? 0) },
      canGoBack: history.canGoBack(),
      canGoForward: history.canGoForward(),
    };
  }

  return { act, pageSnapshot };
}

// Called right before an action changes the page.
function startInput(step) {
  if (step.navigation.started()) throw new Error(PAGE_CHANGED);
  step.sent = true;
}

function observeNavigation(contents) {
  let started = false;
  let settled = false;
  let timeout;
  let resolveCompletion;
  let resolveStart;
  const completion = new Promise((resolve) => {
    resolveCompletion = resolve;
  });
  const start = new Promise((resolve) => {
    resolveStart = resolve;
  });
  const finish = () => {
    if (settled) return;
    settled = true;
    resolveCompletion();
  };
  // Only a new document counts: hash and History changes keep the page.
  const onStart = (_event, _url, isInPlace, isMainFrame) => {
    if (!isMainFrame || isInPlace || started) return;
    started = true;
    resolveStart();
    timeout = setTimeout(finish, NAVIGATION_WAIT_MS);
  };
  const onFinish = () => {
    if (started) finish();
  };
  const onFail = (_event, errorCode, _description, _url, isMainFrame) => {
    if (isMainFrame && errorCode !== -3) finish();
  };
  contents.on('did-start-navigation', onStart);
  contents.on('did-finish-load', onFinish);
  contents.on('did-fail-load', onFail);
  contents.on('destroyed', finish);
  return {
    started: () => started,
    wait: () => completion,
    startsWithin: (ms) => {
      let timer;
      return Promise.race([
        start,
        new Promise((resolve) => {
          timer = setTimeout(resolve, ms);
        }),
      ]).finally(() => clearTimeout(timer));
    },
    dispose: () => {
      clearTimeout(timeout);
      contents.removeListener('did-start-navigation', onStart);
      contents.removeListener('did-finish-load', onFinish);
      contents.removeListener('did-fail-load', onFail);
      contents.removeListener('destroyed', finish);
    },
  };
}

function isNavigationError(error) {
  const message = String(error?.message || error).toLowerCase();
  return [
    'script execution was interrupted',
    'execution context was destroyed',
    'frame was disposed',
    'object has been destroyed',
    'cannot find context',
  ].some((part) => message.includes(part));
}

// Run on the ref's own element. A value goes through the element's own
// setter and the input and change events, so frameworks that track it (React
// and others) see the change; a checkbox or radio is clicked when it needs to
// change. Nothing is read back, so a masked field stays unread.
const FILL = `function (value) {
  if (this instanceof HTMLSelectElement) {
    const wanted = String(value);
    const options = [...this.options];
    const option =
      options.find((candidate) => candidate.value === wanted) ??
      options.find((candidate) => candidate.label.trim() === wanted || candidate.text.trim() === wanted);
    if (!option) throw new Error('no option "' + wanted + '"');
    this.value = option.value;
  } else if (this instanceof HTMLInputElement && (this.type === 'checkbox' || this.type === 'radio')) {
    const checked = value === true || ['true', 'on', 'checked', 'yes'].includes(String(value).toLowerCase());
    if (this.checked !== checked) this.click();
    return;
  } else if (this instanceof HTMLInputElement || this instanceof HTMLTextAreaElement) {
    if (this.type === 'file') throw new Error('file inputs need the user');
    const proto = this instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    this.focus();
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(this, String(value));
  } else if (this.isContentEditable) {
    this.focus();
    this.textContent = String(value);
  } else {
    throw new Error('not a field');
  }
  this.dispatchEvent(new Event('input', { bubbles: true }));
  this.dispatchEvent(new Event('change', { bubbles: true }));
}`;

// Run on a ref's element: whether a hit node is that element or inside it,
// shadow roots included.
const CONTAINS = `function (other) {
  for (let node = other; node; node = node.parentNode || node.host) if (node === this) return true;
  return false;
}`;

module.exports = { createBrowserActions };
