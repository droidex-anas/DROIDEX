// Agent actions on a page, sent from main through CDP: trusted pointer and
// keyboard input that also reaches cross-site frames, and field changes made
// on a ref's own element. The page script never acts for the agent. An action
// stops before it sends anything once a new document starts loading, and one
// whose input never went out fails rather than report a navigation it did not
// cause.

const { send, frameHolds, focusedFrame } = require('./browserFrames.cjs');
const { callPageScript } = require('./browserPageScript.cjs');
const { keyOf, modifiersOf, pressKey } = require('./browserKeys.cjs');
const { observeNavigation, NAVIGATION_GRACE_MS } = require('./browserNavigation.cjs');
const { createBrowserCover } = require('./browserCover.cjs');
const { createBrowserAgentSafety, refuseSensitiveInput } = require('./browserAgentSafety.cjs');
const { FILL } = require('./browserFill.cjs');

const PAGE_CHANGED = 'The page changed before the action ran; call browser_read_page.';
const LATE = 'The browser page did not finish in time.';
const MAX_CLICKS = 3;
const MAX_REPEAT = 50;
const SCROLL_SETTLE_MS = 1_000;
const SCROLL_START_MS = 300;
const SCROLL_POLL_MS = 40;
function createBrowserActions({
  reading,
  runWithWebContentsDebugger,
  credentials,
  showPrompt,
  unthrottled,
  redactUrl,
  onPoint,
}) {
  const safety = createBrowserAgentSafety({ showPrompt });
  const { refuseCovered } = createBrowserCover({ reading });

  async function act(contents, entry, request) {
    // After a navigation or a wait, errors count from when the request came.
    if (request.action === 'snapshot')
      return result(request, contents, entry, request.receivedAt ?? Date.now());
    if (request.action === 'inspect') return inspect(contents, entry, request);
    if (request.action === 'fillCredentials') {
      await unthrottled(contents, () => credentials.fillForAgent(contents, entry, request));
      return { requestId: request.requestId, ok: true };
    }
    const since = Date.now();
    const urlBefore = contents.getURL();
    const navigation = observeNavigation(contents);
    try {
      return await unthrottled(contents, async () => {
        const step = {
          navigation,
          sent: false,
          startBy: request.startBy,
          runEnded: request.runEnded,
          isCurrent: () => entry.contents === contents && !contents.isDestroyed(),
        };
        // The action's own input ends before it reports, even when a navigation
        // settles first, so nothing of it lands under the next one.
        let failure;
        await perform(contents, entry, request, step).catch((error) => {
          failure = error;
        });
        if (navigation.started() && !step.sent) throw new Error(PAGE_CHANGED);
        // Once its input went out, a navigation that started is the answer,
        // whatever that navigation then cut short.
        if (failure && !navigation.started()) throw failure;
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
        return press(contents, entry, request, step);
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
      default:
        throw new Error(`Unsupported browser action: ${request.action}`);
    }
  }

  async function pointer(contents, entry, request, step) {
    const target = await targetOf(contents, entry, request, step);
    const { x, y } = target;
    // Where the pane draws the agent's cursor; the input does not wait for it.
    onPoint(entry, { x, y });
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
      const inspected = await runWithWebContentsDebugger(contents, (dbg) =>
        safety.inspectPointer(dbg, target),
      );
      await safety.authorize(contents, entry, request, inspected);
      notLate(step);
      if (request.ref) await refuseCovered(contents, entry, request.ref, target);
      const dispatch = (dbg, event, holding) =>
        safety.inspectPointer(dbg, target, (current) => {
          safety.verify(inspected, current);
          if (!holding()) throw new Error(LATE);
          startInput(step);
          return dbg.sendCommand('Input.dispatchMouseEvent', event);
        });
      const press = { x, y, button, clickCount, modifiers };
      await dispatchMouse(
        contents,
        step,
        target,
        [
          { type: 'mousePressed', ...press },
          { type: 'mouseReleased', ...press },
        ],
        dispatch,
      );
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
    onPoint(entry, { x: target.x, y: target.y });
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
  // scrolled to; for a point in a cross-site frame, inside that frame too.
  async function scrollPosition(contents, target) {
    return runWithWebContentsDebugger(contents, async (dbg) => {
      const scrolled = async (sessionId, { x, y }) => {
        const { result } = await send(dbg, sessionId, 'Runtime.evaluate', {
          expression: `(${SCROLLED})(${x}, ${y})`,
          returnByValue: true,
        });
        return result?.value;
      };
      const page = await scrolled(undefined, target);
      return target.sessionId ? `${page};${await scrolled(target.sessionId, target.local)}` : page;
    });
  }

  // Text goes to the session of the frame that holds the focus (a cross-site
  // frame only takes keys sent to its own session); a ref is focused first.
  async function type(contents, entry, request, step) {
    const text = String(request.text ?? '');
    const prepared = await runWithWebContentsDebugger(contents, async (dbg, holding) => {
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
        if (!holding()) throw new Error(LATE);
        await send(dbg, sessionId, 'DOM.focus', { backendNodeId: target.backendNodeId });
        // A focus handler can send the focus on to another element or frame.
        const focused = await keepsFocus(dbg, sessionId, document);
        if (focused.backendNodeId !== target.backendNodeId)
          throw new Error(`${request.ref} did not keep the focus; read the page again.`);
        takesText = focused.takesText;
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
      const target = { sessionId, document, backendNodeId: refNode };
      const inspected = request.ref
        ? await safety.inspectNode(dbg, target, request.submit ? 'enter' : null)
        : await safety.inspectFocus(dbg, request.submit ? 'enter' : null);
      if (text) refuseSensitiveInput(inspected);
      return { sessionId, document, refNode, inspected };
    });
    await safety.authorize(contents, entry, request, prepared.inspected);
    await runWithWebContentsDebugger(contents, async (dbg, holding) => {
      const { sessionId, document, refNode, inspected } = prepared;
      const focused = await keepsFocus(dbg, sessionId, document);
      if (request.ref && focused.backendNodeId !== refNode)
        throw new Error(`${request.ref} lost the focus; read the page again.`);
      const stillOn = onSamePage(dbg, holding, sessionId, document);
      await inputReady(dbg, step, holding, sessionId, document);
      if (text)
        await safety.inspectFocus(dbg, request.submit ? 'enter' : null, (current) => {
          safety.verify(inspected, current);
          refuseSensitiveInput(current);
          if (!holding()) throw new Error(LATE);
          startInput(step);
          return send(dbg, sessionId, 'Input.insertText', { text });
        });
      if (request.submit) {
        const focused = await keepsFocus(dbg, sessionId, document);
        // An input handler can move the focus on to another control.
        if (request.ref && focused.backendNodeId !== refNode)
          throw new Error(`${request.ref} lost the focus before Enter; read the page again.`);
        await inputReady(dbg, step, holding, sessionId, document);
        await pressKey(keyOf('Enter'), stillOn, (event) =>
          safety.inspectFocus(dbg, 'enter', (current) => {
            safety.verify(inspected, current);
            if (!holding()) throw new Error(LATE);
            startInput(step);
            return send(dbg, sessionId, 'Input.dispatchKeyEvent', event);
          }),
        );
      }
    });
  }

  async function press(contents, entry, request, step) {
    const key = keyOf(request.key);
    const repeat = Math.min(MAX_REPEAT, Math.max(1, Math.round(Number(request.repeat) || 1)));
    const activation = key.key === 'Enter' ? 'enter' : key.key === ' ' ? 'click' : null;
    let initialTarget;
    for (let i = 0; i < repeat; i++) {
      if (i > 0 && step.navigation.started()) return;
      const inspected = await runWithWebContentsDebugger(contents, (dbg) =>
        safety.inspectFocus(dbg, activation),
      );
      initialTarget ??= inspected;
      if (
        inspected.sessionId !== initialTarget.sessionId ||
        inspected.document !== initialTarget.document
      )
        throw new Error('The focus moved to another frame; read the page again.');
      if (!['Tab', 'Escape', 'Enter'].includes(key.key)) refuseSensitiveInput(inspected);
      await safety.authorize(contents, entry, request, inspected);
      await runWithWebContentsDebugger(contents, async (dbg, holding) => {
        const { sessionId, document } = inspected;
        await inputReady(dbg, step, holding, sessionId, document);
        await pressKey(key, onSamePage(dbg, holding, sessionId, document), (event) =>
          safety.inspectFocus(dbg, activation, (current) => {
            if (event.type !== 'keyUp' || !['Tab', 'Escape'].includes(key.key))
              safety.verify(inspected, current);
            if (!['Tab', 'Escape', 'Enter'].includes(key.key)) refuseSensitiveInput(current);
            if (!holding()) throw new Error(LATE);
            startInput(step);
            return send(dbg, sessionId, 'Input.dispatchKeyEvent', event);
          }),
        );
      });
    }
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
  function dispatchMouse(contents, step, target, events, dispatch) {
    return runWithWebContentsDebugger(contents, async (dbg, holding) => {
      const stillOn = onSamePage(dbg, holding, target.sessionId, target.document);
      for (const event of events) {
        if (event.type === 'mouseReleased') {
          if (await stillOn()) {
            try {
              if (dispatch) await dispatch(dbg, event, holding);
              else await dbg.sendCommand('Input.dispatchMouseEvent', event);
            } catch (error) {
              // Release away from the control so a refused click does not leave the button held.
              if (await stillOn())
                await dbg.sendCommand('Input.dispatchMouseEvent', { ...event, x: -1, y: -1 });
              throw error;
            }
          }
          continue;
        }
        await inputReady(dbg, step, holding, target.sessionId, target.document);
        if (dispatch) await dispatch(dbg, event, holding);
        else {
          startInput(step);
          await dbg.sendCommand('Input.dispatchMouseEvent', event);
        }
      }
    });
  }

  // Whether the page that took a press is still there, so the press can be
  // released: its document, which a navigation that aborts leaves in place.
  // Once the debugger queue has moved on, nothing is released either.
  function onSamePage(dbg, holding, sessionId, document) {
    return async () => (!document || (await frameHolds(dbg, sessionId, document))) && holding();
  }

  // Keys go on only while the frame they were aimed at still has the focus.
  async function keepsFocus(dbg, sessionId, document) {
    const focused = await focusedFrame(dbg);
    if (focused.sessionId !== sessionId || focused.document !== document)
      throw new Error('The focus moved to another frame; read the page again.');
    return focused;
  }

  // Input goes out only while the document it was aimed at is still there,
  // and while its operation still holds the debugger.
  async function inputReady(dbg, step, holding, sessionId, document) {
    if (document && !(await frameHolds(dbg, sessionId, document))) throw new Error(PAGE_CHANGED);
    if (!holding()) throw new Error(LATE);
    if (step.navigation.started()) throw new Error(PAGE_CHANGED);
    notLate(step);
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
    const errors = entry.errorTimes.filter((at) => at >= since).length;
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

// Nothing more is done to the page once the caller has given up, or once the
// sidecar run that asked has ended.
function notLate(step) {
  if (!step.isCurrent()) throw new Error('The browser page closed or was replaced.');
  if (Date.now() >= step.startBy || step.runEnded()) throw new Error(LATE);
}

// The scroll offsets of the page and of each element around the one at a
// viewport point.
const SCROLLED = `(x, y) => {
  const offsets = [scrollX, scrollY];
  for (let node = document.elementFromPoint(x, y); node; node = node.parentElement)
    offsets.push(node.scrollLeft, node.scrollTop);
  return offsets.join();
}`;

module.exports = { createBrowserActions };
