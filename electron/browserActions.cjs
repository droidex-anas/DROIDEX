// Agent actions on a page, sent from main through CDP: trusted pointer and
// keyboard input that also reaches cross-site frames, and field changes made
// on a ref's own element. The page script never acts for the agent. An action
// stops before it sends anything once a new document starts loading, and one
// whose input never went out fails rather than report a navigation it did not
// cause.

const {
  send,
  frameHolds,
  focusedFrame,
  frameStep,
  documentFrames,
} = require('./browserFrames.cjs');
const { callPageScript } = require('./browserPageScript.cjs');
const { refFor } = require('./browserRefs.cjs');
const { keyOf, modifiersOf, pressOn } = require('./browserKeys.cjs');
const { observeNavigation, isNavigationError } = require('./browserNavigation.cjs');
const { labelOf } = require('./browserText.cjs');
const { isField } = require('./browserMasking.cjs');

const PAGE_CHANGED = 'The page changed before the action ran; call browser_read_page.';
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
        if (navigation.started() && !step.sent) throw new Error(PAGE_CHANGED);
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
    await dispatchMouse(contents, step, target, [{ type: 'mouseMoved', x, y, modifiers }]);
    if (request.action !== 'click') return;
    // The pointer arriving can move the ref, or open something over it.
    if (request.ref) {
      const now = await reading.pointForRef(contents, entry, request.ref);
      if (Math.abs(now.x - x) > 1 || Math.abs(now.y - y) > 1)
        throw new Error(`${request.ref} moved when the pointer reached it; try again.`);
      await refuseCovered(contents, entry, request.ref, now);
    }
    const button = ['left', 'right', 'middle'].includes(request.button) ? request.button : 'left';
    const clicks = Math.min(MAX_CLICKS, Math.max(1, Math.round(Number(request.count) || 1)));
    const events = [];
    for (let clickCount = 1; clickCount <= clicks; clickCount++) {
      const press = { x, y, button, clickCount, modifiers };
      events.push({ type: 'mousePressed', ...press }, { type: 'mouseReleased', ...press });
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
    const before = await scrollPosition(contents, target);
    await dispatchMouse(contents, step, target, [
      {
        type: 'mouseWheel',
        x: target.x,
        y: target.y,
        deltaX: horizontal ? sign * pixels : 0,
        deltaY: horizontal ? 0 : sign * pixels,
      },
    ]);
    await scrollSettled(contents, target, before);
  }

  // Wheel scrolling animates, so the page is read once it has moved and
  // stopped, or once nothing has moved for a moment (nothing could scroll).
  async function scrollSettled(contents, point, before) {
    const started = Date.now();
    let last = before;
    while (Date.now() - started < SCROLL_SETTLE_MS) {
      await new Promise((resolve) => setTimeout(resolve, SCROLL_POLL_MS));
      const now = await scrollPosition(contents, point);
      if (now === before && Date.now() - started > SCROLL_START_MS) return;
      if (now !== before && now === last) return;
      last = now;
    }
  }

  // Where the page and every box around the element at the point are
  // scrolled to.
  async function scrollPosition(contents, { x, y }) {
    const { result } = await runWithWebContentsDebugger(contents, (dbg) =>
      dbg.sendCommand('Runtime.evaluate', {
        expression: `(${SCROLLED})(${x}, ${y})`,
        returnByValue: true,
      }),
    );
    return result?.value;
  }

  // Text goes to the session of the frame that holds the focus (a cross-site
  // frame only takes keys sent to its own session); a ref is focused first.
  async function type(contents, entry, request, step) {
    const text = String(request.text ?? '');
    await runWithWebContentsDebugger(contents, async (dbg) => {
      let sessionId;
      let document;
      if (request.ref) {
        const target = await reading.lookupRef(dbg, entry, request.ref);
        ({ document } = target);
        sessionId = target.frame.sessionId;
        await send(dbg, sessionId, 'DOM.focus', { backendNodeId: target.backendNodeId });
        // A focus handler can send the focus on to another frame.
        await keepsFocus(dbg, sessionId, document);
      } else {
        ({ sessionId, document } = await focusedFrame(dbg));
      }
      // The text, and then Enter, go only to the document they were aimed at.
      await inputReady(dbg, step, sessionId, document);
      if (text) await send(dbg, sessionId, 'Input.insertText', { text });
      if (request.submit) {
        await inputReady(dbg, step, sessionId, document);
        await keepsFocus(dbg, sessionId, document);
        await pressOn(dbg, sessionId, keyOf('Enter'));
      }
    });
  }

  async function press(contents, request, step) {
    const key = keyOf(request.key);
    const repeat = Math.min(MAX_REPEAT, Math.max(1, Math.round(Number(request.repeat) || 1)));
    await runWithWebContentsDebugger(contents, async (dbg) => {
      const { sessionId, document } = await focusedFrame(dbg);
      for (let i = 0; i < repeat; i++) {
        await inputReady(dbg, step, sessionId, document);
        // A key can move the focus; the rest go only to the frame they began in.
        if (i > 0) await keepsFocus(dbg, sessionId, document);
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
    await refuseCovered(contents, entry, request.ref, target);
    return target;
  }

  async function refuseCovered(contents, entry, ref, point) {
    const cover = await coverOf(contents, entry, ref, point);
    if (cover) throw new Error(`${ref} is covered by ${cover} there; deal with it first.`);
  }

  // What would receive input at a ref's point instead of the ref's element,
  // described with a ref of its own; nothing when the ref would. The point is
  // checked in the ref's own frame, then, for a ref in a cross-site frame, in
  // each frame outside it, where the iframe it sits in must take the input.
  function coverOf(contents, entry, ref, point) {
    return reading.withPage(contents, async (dbg) => {
      const target = await reading.lookupRef(dbg, entry, ref);
      let { sessionId } = target.frame;
      let at = [point.local.x, point.local.y];
      const hit = await hitAt(dbg, sessionId, at);
      if (
        hit &&
        !(
          hit.frameId === target.frame.id &&
          (await holds(dbg, sessionId, target.backendNodeId, hit))
        )
      )
        return describeCover(dbg, sessionId, entry, hit);
      while (sessionId) {
        const { parent, owner, toParent } = await frameStep(dbg, sessionId);
        at = toParent(at);
        const outer = await hitAt(dbg, parent, at);
        if (outer && outer.backendNodeId !== owner) return describeCover(dbg, parent, entry, outer);
        sessionId = parent;
      }
      return undefined;
    });
  }

  // The node that takes input at [x, y] in a frame's own viewport; the hit
  // test takes that frame's page coordinates.
  async function hitAt(dbg, sessionId, [x, y]) {
    const { cssLayoutViewport: view } = await send(dbg, sessionId, 'Page.getLayoutMetrics');
    return send(dbg, sessionId, 'DOM.getNodeForLocation', {
      x: x + view.pageX,
      y: y + view.pageY,
      includeUserAgentShadowDOM: false,
    }).catch(() => undefined);
  }

  async function holds(dbg, sessionId, backendNodeId, hit) {
    const [{ object: ref }, { object: other }] = await Promise.all([
      send(dbg, sessionId, 'DOM.resolveNode', { backendNodeId }),
      send(dbg, sessionId, 'DOM.resolveNode', { backendNodeId: hit.backendNodeId }),
    ]);
    try {
      const { result: held } = await send(dbg, sessionId, 'Runtime.callFunctionOn', {
        objectId: ref.objectId,
        functionDeclaration: CONTAINS,
        arguments: [{ objectId: other.objectId }],
        returnByValue: true,
      });
      return held.value === true;
    } finally {
      for (const { objectId } of [ref, other])
        await send(dbg, sessionId, 'Runtime.releaseObject', { objectId }).catch(() => undefined);
    }
  }

  async function describeCover(dbg, sessionId, entry, hit) {
    const { nodes } = await send(dbg, sessionId, 'Accessibility.getPartialAXTree', {
      backendNodeId: hit.backendNodeId,
      fetchRelatives: false,
    }).catch(() => ({ nodes: [] }));
    const node = nodes.find((candidate) => !candidate.ignored);
    // Only a label the page gave it, and never a field's: a name built from
    // content, or a field's own, can hold what a masked field holds.
    const name = node && !isField(node) ? labelOf(node).slice(0, 80) : '';
    // An element the accessibility tree ignores is named by its tag.
    const role =
      node && (name || !['none', 'generic'].includes(node.role?.value))
        ? node.role.value
        : `<${(await send(dbg, sessionId, 'DOM.describeNode', { backendNodeId: hit.backendNodeId })).node.localName}>`;
    const frame = (await documentFrames(dbg)).find((candidate) => candidate.id === hit.frameId);
    const ref = frame ? ` (${refFor(entry, frame.loaderId, hit.backendNodeId)})` : '';
    return `${role}${name ? ` "${name}"` : ''}${ref}`;
  }

  // Before each event, inside the debugger queue, a new page or a replaced
  // ref document stops the gesture.
  function dispatchMouse(contents, step, target, events) {
    return runWithWebContentsDebugger(contents, async (dbg) => {
      for (const event of events) {
        await inputReady(dbg, step, target.sessionId, target.document);
        await dbg.sendCommand('Input.dispatchMouseEvent', event);
      }
    });
  }

  // Keys go on only while the frame they were aimed at still has the focus.
  async function keepsFocus(dbg, sessionId, document) {
    const focused = await focusedFrame(dbg);
    if (focused.sessionId !== sessionId || focused.document !== document)
      throw new Error('The focus moved to another frame; read the page again.');
  }

  // Input goes out only while the document it was aimed at is still there.
  async function inputReady(dbg, step, sessionId, document) {
    if (document && !(await frameHolds(dbg, sessionId, document))) throw new Error(PAGE_CHANGED);
    startInput(step);
  }

  async function inspect(contents, entry, request) {
    const target = request.ref
      ? await reading.selectorForRef(contents, entry, request.ref)
      : { selector: request.selector };
    const inspection = await callPageScript(contents, '__droidexInspect', target.selector);
    // The selector ran on whatever document was there; the answer counts only
    // if that is still the ref's.
    if (target.document) await reading.assertDocument(contents, target.document);
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
    if (this.checked !== checked)
      throw new Error(this.type === 'radio' ? 'a radio turns off when another one is chosen' : 'the page kept it as it was');
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

// The scroll offsets of the page and of each element around the one at a
// viewport point.
const SCROLLED = `(x, y) => {
  const offsets = [scrollX, scrollY];
  for (let node = document.elementFromPoint(x, y); node; node = node.parentElement)
    offsets.push(node.scrollLeft, node.scrollTop);
  return offsets.join();
}`;

// Run on a ref's element: whether a hit node is that element or inside it,
// shadow roots included.
const CONTAINS = `function (other) {
  for (let node = other; node; node = node.parentNode || node.host) if (node === this) return true;
  return false;
}`;

module.exports = { createBrowserActions };
