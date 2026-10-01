// Agent actions on a page, sent from main through CDP: trusted pointer and
// keyboard input that also reaches cross-site frames, and field changes made
// on a ref's own element. The page script never acts for the agent. An action
// stops before it sends anything once a new document starts loading, and one
// whose input never went out fails rather than report a navigation it did not
// cause.

const { send, frameHolds, focusedFrame } = require('./browserFrames.cjs');
const { callPageScript } = require('./browserPageScript.cjs');
const { keyOf, modifiersOf, pressOn } = require('./browserKeys.cjs');
const { observeNavigation, isNavigationError } = require('./browserNavigation.cjs');
const { createBrowserCover } = require('./browserCover.cjs');

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
  const { refuseCovered } = createBrowserCover({ reading });

  async function act(contents, entry, request) {
    if (request.action === 'snapshot') return result(request, contents, entry, Date.now());
    if (request.action === 'inspect') return inspect(contents, entry, request);
    const since = Date.now();
    const urlBefore = contents.getURL();
    const navigation = observeNavigation(contents);
    try {
      return await unthrottled(contents, async () => {
        const step = { navigation, sent: false, startBy: request.startBy };
        // The action's own input ends before it reports, even when a navigation
        // settles first, so nothing of it lands under the next one.
        let failure;
        await perform(contents, entry, request, step).catch((error) => {
          failure = error;
        });
        if (navigation.started() && !step.sent) throw new Error(PAGE_CHANGED);
        if (failure && !(navigation.started() && isNavigationError(failure))) throw failure;
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
        return reading.callOnRef(
          contents,
          entry,
          request.ref,
          [request.value, step.startBy],
          FILL,
          () => startInput(step),
        );
      case 'fillCredentials':
        startInput(step);
        return credentials.fillForAgent(contents, step.startBy);
      default:
        throw new Error(`Unsupported browser action: ${request.action}`);
    }
  }

  async function pointer(contents, entry, request, step) {
    const target = await targetOf(contents, entry, request, step);
    const { x, y } = target;
    const modifiers = modifiersOf(request.modifiers);
    await dispatchMouse(contents, step, target, [{ type: 'mouseMoved', x, y, modifiers }]);
    if (request.action !== 'click') return;
    const button = ['left', 'right', 'middle'].includes(request.button) ? request.button : 'left';
    const clicks = Math.min(MAX_CLICKS, Math.max(1, Math.round(Number(request.count) || 1)));
    for (let clickCount = 1; clickCount <= clicks; clickCount++) {
      // The pointer arriving can move the ref or open something over it, and
      // each click can change the page for the next; a click that navigates
      // is the last.
      if (clickCount > 1 && step.navigation.started()) return;
      if (request.ref) {
        const now = await reading.pointForRef(contents, entry, request.ref, () => notLate(step));
        if (Math.abs(now.x - x) > 1 || Math.abs(now.y - y) > 1)
          throw new Error(`${request.ref} moved when the pointer reached it; try again.`);
        await refuseCovered(contents, entry, request.ref, now);
      }
      const press = { x, y, button, clickCount, modifiers };
      await dispatchMouse(contents, step, target, [
        { type: 'mousePressed', ...press },
        { type: 'mouseReleased', ...press },
      ]);
    }
  }

  // A wheel turn at the ref (scrolling whatever scrolls under it) or at the
  // given point; a ref with no direction is only brought into view.
  async function scroll(contents, entry, request, step) {
    if (request.ref && !request.direction) {
      await reading.pointForRef(contents, entry, request.ref, () => startInput(step));
      return;
    }
    // No cover check: the wheel scrolls whatever is under the point.
    const target = request.ref
      ? await reading.pointForRef(contents, entry, request.ref, () => notLate(step))
      : await targetOf(contents, entry, request, step);
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
      let refNode;
      let takesText;
      if (request.ref) {
        const target = await reading.lookupRef(dbg, entry, request.ref);
        ({ document } = target);
        refNode = target.backendNodeId;
        sessionId = target.frame.sessionId;
        // Only the deadline: nothing counts as typed until text or Enter goes out.
        notLate(step);
        await send(dbg, sessionId, 'DOM.focus', { backendNodeId: target.backendNodeId });
        // A focus handler can send the focus on to another element or frame.
        ({ takesText } = await keepsFocus(dbg, sessionId, document));
        if (!(await hasFocus(dbg, sessionId, target.backendNodeId)))
          throw new Error(`${request.ref} did not keep the focus; read the page again.`);
      } else {
        ({ sessionId, document, takesText } = await focusedFrame(dbg));
      }
      // The page acknowledges text it drops, so where it goes is checked first.
      if (text && !takesText)
        throw new Error(
          request.ref
            ? `${request.ref} does not take typed text; use browser_fill or browser_click.`
            : 'Nothing that takes typed text has the focus; pass the ref of a field.',
        );
      const stillOn = onSamePage(dbg, sessionId, document);
      // The text, and then Enter, go only to the document they were aimed at.
      await inputReady(dbg, step, sessionId, document);
      if (text) await send(dbg, sessionId, 'Input.insertText', { text });
      if (request.submit) {
        await keepsFocus(dbg, sessionId, document);
        // An input handler can move the focus on to another control.
        if (request.ref && !(await hasFocus(dbg, sessionId, refNode)))
          throw new Error(`${request.ref} lost the focus before Enter; read the page again.`);
        // The page check comes last, right before the key.
        await inputReady(dbg, step, sessionId, document);
        await pressOn(dbg, sessionId, keyOf('Enter'), stillOn);
      }
    });
  }

  async function press(contents, request, step) {
    const key = keyOf(request.key);
    const repeat = Math.min(MAX_REPEAT, Math.max(1, Math.round(Number(request.repeat) || 1)));
    await runWithWebContentsDebugger(contents, async (dbg) => {
      const { sessionId, document } = await focusedFrame(dbg);
      const stillOn = onSamePage(dbg, sessionId, document);
      for (let i = 0; i < repeat; i++) {
        // A key can move the focus; the rest go only to the frame they began in.
        if (i > 0) await keepsFocus(dbg, sessionId, document);
        await inputReady(dbg, step, sessionId, document);
        await pressOn(dbg, sessionId, key, stillOn);
      }
    });
  }

  // A ref becomes the point at its middle, scrolled into view, and is refused
  // when something else would receive input there.
  async function targetOf(contents, entry, request, step) {
    if (!request.ref) {
      const x = Math.round(Number(request.x));
      const y = Math.round(Number(request.y));
      if (!Number.isFinite(x) || !Number.isFinite(y))
        throw new Error('Pass a ref from browser_read_page, or viewport x and y.');
      // A point is on the top document, which its input then has to stay on.
      const document = await reading.withPage(
        contents,
        async (dbg) => (await dbg.sendCommand('Page.getFrameTree')).frameTree.frame.loaderId,
      );
      return { x, y, document };
    }
    const target = await reading.pointForRef(contents, entry, request.ref, () => notLate(step));
    await refuseCovered(contents, entry, request.ref, target);
    return target;
  }

  // Before each event, inside the debugger queue, a new page or a replaced
  // ref document stops the gesture.
  function dispatchMouse(contents, step, target, events) {
    return runWithWebContentsDebugger(contents, async (dbg) => {
      const stillOn = onSamePage(dbg, target.sessionId, target.document);
      for (const event of events) {
        // A press that went out is always released, on the page that took it.
        if (event.type === 'mouseReleased') {
          if (await stillOn()) await dbg.sendCommand('Input.dispatchMouseEvent', event);
          continue;
        }
        await inputReady(dbg, step, target.sessionId, target.document);
        await dbg.sendCommand('Input.dispatchMouseEvent', event);
      }
    });
  }

  // Whether the page that took a press is still there, so the press can be
  // released: its document, which a navigation that aborts leaves in place.
  function onSamePage(dbg, sessionId, document) {
    return async () => !document || (await frameHolds(dbg, sessionId, document));
  }

  // Whether a node is what its own document or shadow root has focused.
  async function hasFocus(dbg, sessionId, backendNodeId) {
    const { object } = await send(dbg, sessionId, 'DOM.resolveNode', { backendNodeId });
    try {
      const { result } = await send(dbg, sessionId, 'Runtime.callFunctionOn', {
        objectId: object.objectId,
        functionDeclaration: 'function () { return this.getRootNode().activeElement === this; }',
        returnByValue: true,
      });
      return result?.value === true;
    } finally {
      await send(dbg, sessionId, 'Runtime.releaseObject', { objectId: object.objectId }).catch(
        () => undefined,
      );
    }
  }

  // Keys go on only while the frame they were aimed at still has the focus.
  async function keepsFocus(dbg, sessionId, document) {
    const focused = await focusedFrame(dbg);
    if (focused.sessionId !== sessionId || focused.document !== document)
      throw new Error('The focus moved to another frame; read the page again.');
    return focused;
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
    // if that is still the ref's, and the selector still names the ref.
    if (target.document) await reading.assertDocument(contents, target.document);
    if (request.ref) await stillSelects(contents, entry, request.ref, target.selector);
    return { requestId: request.requestId, ok: true, inspection };
  }

  async function stillSelects(contents, entry, ref, selector) {
    await reading.withPage(contents, async (dbg) => {
      const { backendNodeId } = await reading.lookupRef(dbg, entry, ref);
      const { root } = await dbg.sendCommand('DOM.getDocument', { depth: 0 });
      const { nodeId } = await dbg.sendCommand('DOM.querySelector', {
        nodeId: root.nodeId,
        selector,
      });
      const found = nodeId && (await dbg.sendCommand('DOM.describeNode', { nodeId })).node;
      if (found?.backendNodeId !== backendNodeId)
        throw new Error(`${ref} changed while it was inspected; read the page again.`);
    });
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

// Called right before an action changes the page. No input goes out once
// its caller has given up.
function startInput(step) {
  if (step.navigation.started()) throw new Error(PAGE_CHANGED);
  notLate(step);
  step.sent = true;
}

// Nothing more is done to the page once the caller has given up.
function notLate(step) {
  if (Date.now() >= step.startBy) throw new Error('The browser page did not finish in time.');
}

// Run on the ref's own element. A value goes through the element's own
// setter and the input and change events, so frameworks that track it (React
// and others) see the change; a checkbox or radio is clicked when it needs to
// change. Nothing is read back, so a masked field stays unread.
const FILL = `function (value, startBy) {
  // The page can run this late, and its focus handlers can take their time;
  // nothing changes once the caller has given up, or once a focus handler has
  // swapped the field for another.
  const inTime = () => {
    if (startBy && Date.now() >= startBy) throw new Error('The browser page did not finish in time.');
  };
  const focus = () => {
    inTime();
    this.focus();
    inTime();
    if (!this.isConnected) throw new Error('the field was replaced when it took the focus; read the page again');
  };
  inTime();
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
    focus();
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(this, String(value));
  } else if (this.isContentEditable) {
    focus();
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

module.exports = { createBrowserActions };
