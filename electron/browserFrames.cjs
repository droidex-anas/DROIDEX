// Every document in a guest page, wherever it runs. Same-process frames come
// from the frame tree; a cross-site frame runs in its own process and is
// reached through its own CDP session, attached as soon as the frame appears.
// Boxes inside such a frame are relative to it, so each session knows how to
// find its offset in the page's viewport.

const AUTO_ATTACH = { autoAttach: true, waitForDebuggerOnStart: false, flatten: true };
const PAINT_WAIT_MS = 500;
const attachments = new WeakMap(); // guest debugger -> { sessions, pending }

function send(dbg, sessionId, method, params = {}) {
  return sessionId ? dbg.sendCommand(method, params, sessionId) : dbg.sendCommand(method, params);
}

// Events for frames that already exist arrive before setAutoAttach answers,
// so awaiting the pending calls is enough to know every frame.
async function attachFrames(dbg) {
  let attached = attachments.get(dbg);
  if (!attached) {
    attached = { sessions: new Map(), pending: new Set() };
    attachments.set(dbg, attached);
    const { sessions, pending } = attached;
    const autoAttach = (sessionId) => {
      const call = send(dbg, sessionId, 'Target.setAutoAttach', AUTO_ATTACH).catch(() => undefined);
      pending.add(call);
      void call.finally(() => pending.delete(call));
    };
    const onMessage = (_event, method, params, sessionId) => {
      if (method === 'Target.attachedToTarget' && params.targetInfo.type === 'iframe') {
        sessions.set(params.sessionId, {
          frameId: params.targetInfo.targetId,
          parent: sessionId || undefined,
        });
        autoAttach(params.sessionId);
      } else if (method === 'Target.detachedFromTarget') {
        sessions.delete(params.sessionId);
      }
    };
    dbg.on('message', onMessage);
    dbg.once('detach', () => {
      dbg.removeListener('message', onMessage);
      attachments.delete(dbg);
    });
    autoAttach(undefined);
  }
  while (attached.pending.size) await Promise.all(attached.pending);
  return attached.sessions;
}

// Frames in document order within each process, each with the session to ask.
// A frame that cannot be read is skipped, or fails the call when `strict`.
async function documentFrames(dbg, { strict = false } = {}) {
  const sessions = await attachFrames(dbg);
  const frames = [];
  const visit = async (sessionId) => {
    const { frameTree } = await send(dbg, sessionId, 'Page.getFrameTree');
    const walk = (tree) => {
      frames.push({ ...tree.frame, sessionId });
      for (const child of tree.childFrames ?? []) walk(child);
    };
    walk(frameTree);
    for (const [childId, child] of sessions) {
      if (child.parent !== sessionId) continue;
      await visit(childId).catch((error) => {
        if (strict) throw error;
      });
    }
  };
  await visit(undefined);
  return frames;
}

// Maps quads from a session's own coordinates into the page's viewport,
// through every cross-site frame it sits in.
async function viewportMapping(dbg, sessionId) {
  if (!sessionId) return (quad) => quad;
  const { parent, toParent } = await frameStep(dbg, sessionId);
  const outer = await viewportMapping(dbg, parent);
  return (quad) => outer(toParent(quad));
}

// One step out of a cross-site frame: the iframe that owns it, in its parent's
// session, and how points in the frame land in the parent, through that
// iframe's content box, which may be scaled or rotated. Points are flat
// [x, y, ...] lists, such as a quad.
async function frameStep(dbg, sessionId) {
  const frame = attachments.get(dbg)?.sessions.get(sessionId);
  if (!frame) throw new Error('The frame closed.');
  const { backendNodeId: owner } = await send(dbg, frame.parent, 'DOM.getFrameOwner', {
    frameId: frame.frameId,
  });
  const { model } = await send(dbg, frame.parent, 'DOM.getBoxModel', { backendNodeId: owner });
  const [x0, y0, x1, y1, x2, y2, x3, y3] = model.content;
  // Only an affine transform keeps the box a parallelogram.
  if (Math.abs(x0 + x2 - x1 - x3) > 1 || Math.abs(y0 + y2 - y1 - y3) > 1)
    throw new Error('A frame on this page is drawn in perspective, which this tool cannot map.');
  const [bx0, by0, bx1, by1, , , bx3, by3] = model.border;
  // The box model's width and height are before any transform; along each
  // edge the content box keeps its share of the border box.
  const width = (model.width * Math.hypot(x1 - x0, y1 - y0)) / Math.hypot(bx1 - bx0, by1 - by0);
  const height = (model.height * Math.hypot(x3 - x0, y3 - y0)) / Math.hypot(bx3 - bx0, by3 - by0);
  const toParent = (points) =>
    points.map((_, i) => {
      const u = points[i - (i % 2)] / width;
      const v = points[i - (i % 2) + 1] / height;
      return i % 2 ? y0 + u * (y1 - y0) + v * (y3 - y0) : x0 + u * (x1 - x0) + v * (x3 - x0);
    });
  return { parent: frame.parent, owner, toParent };
}

// Whether a session's frames still hold a document, asked of that session
// alone so nothing else runs between the answer and what follows it.
async function frameHolds(dbg, sessionId, loaderId) {
  const { frameTree } = await send(dbg, sessionId, 'Page.getFrameTree');
  const holds = (tree) => tree.frame.loaderId === loaderId || (tree.childFrames ?? []).some(holds);
  return holds(frameTree);
}

// The frame that has the keyboard focus, followed down from the top through
// every iframe that holds it: the session to send keys on (a same-process
// frame takes them through its parent's session) and that frame's document.
async function focusedFrame(dbg) {
  const sessions = await attachFrames(dbg);
  let sessionId;
  let frameId; // the same-process frame in the session that holds the focus
  const held = [];
  const documentOf = async (session) => {
    const { result } = await send(dbg, session, 'Runtime.evaluate', { expression: 'document' });
    if (!result?.objectId)
      throw new Error('The page changed before the action ran; call browser_read_page.');
    held.push({ sessionId: session, objectId: result.objectId });
    return result.objectId;
  };
  let documentId = await documentOf(undefined); // the document walked, as a remote object
  try {
    for (;;) {
      const node = await activeElement(dbg, sessionId, documentId);
      if (node?.localName !== 'iframe' && node?.localName !== 'frame') break;
      const child = await crossSiteChild(dbg, sessions, sessionId, node.backendNodeId);
      if (child) {
        [sessionId, frameId, documentId] = [child, undefined, await documentOf(child)];
        continue;
      }
      const { node: owner } = await send(dbg, sessionId, 'DOM.describeNode', {
        backendNodeId: node.backendNodeId,
        pierce: true,
      });
      if (!owner.contentDocument) break;
      const { object } = await send(dbg, sessionId, 'DOM.resolveNode', {
        backendNodeId: owner.contentDocument.backendNodeId,
      });
      held.push({ sessionId, objectId: object.objectId });
      [frameId, documentId] = [owner.frameId, object.objectId];
    }
    const { frameTree } = await send(dbg, sessionId, 'Page.getFrameTree');
    const document = loaderOf(frameTree, frameId) ?? frameTree.frame.loaderId;
    // That loader is the walked document's only if the document is still in
    // its frame once the loader has been read.
    const { result } = await send(dbg, sessionId, 'Runtime.callFunctionOn', {
      objectId: documentId,
      functionDeclaration: FOCUS_TAKES_TEXT,
      returnByValue: true,
    });
    if (typeof result?.value !== 'boolean')
      throw new Error('The page changed before the action ran; call browser_read_page.');
    return { sessionId, document, takesText: result.value };
  } finally {
    for (const object of held)
      await send(dbg, object.sessionId, 'Runtime.releaseObject', {
        objectId: object.objectId,
      }).catch(() => undefined);
  }
}

// Null once the document has left its frame; otherwise whether the element
// with its focus, inside shadow roots too, takes typed text.
const FOCUS_TAKES_TEXT = `function () {
  if (this.defaultView === null) return null;
  let a = this.activeElement;
  while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement;
  if (!a || a.matches(':disabled') || a.readOnly) return false;
  if (a.isContentEditable || a.localName === 'textarea') return true;
  const notText = ['button', 'checkbox', 'color', 'date', 'datetime-local', 'file', 'hidden', 'image', 'month', 'radio', 'range', 'reset', 'submit', 'time', 'week'];
  return a.localName === 'input' && !notText.includes(a.type);
}`;

// The element with the focus in the given document, inside shadow roots.
async function activeElement(dbg, sessionId, documentId) {
  const { result } = await send(dbg, sessionId, 'Runtime.callFunctionOn', {
    objectId: documentId,
    // Through shadow roots too: a frame focused inside one shows as its host.
    functionDeclaration:
      'function () { let a = this.activeElement; while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement; return a; }',
  });
  if (!result?.objectId) return undefined;
  try {
    return (await send(dbg, sessionId, 'DOM.describeNode', { objectId: result.objectId })).node;
  } finally {
    await send(dbg, sessionId, 'Runtime.releaseObject', { objectId: result.objectId }).catch(
      () => undefined,
    );
  }
}

// The cross-site frame whose iframe element in this session is the given node.
async function crossSiteChild(dbg, sessions, sessionId, backendNodeId) {
  for (const [childId, child] of sessions) {
    if (child.parent !== sessionId) continue;
    const owner = await send(dbg, sessionId, 'DOM.getFrameOwner', {
      frameId: child.frameId,
    }).catch(() => undefined);
    if (owner?.backendNodeId === backendNodeId) return childId;
  }
  return undefined;
}

function loaderOf(tree, frameId) {
  if (tree.frame.id === frameId) return tree.frame.loaderId;
  for (const child of tree.childFrames ?? []) {
    const loaderId = loaderOf(child, frameId);
    if (loaderId) return loaderId;
  }
  return undefined;
}

// Whether a frame painted twice within a short wait, so a copy of the screen
// shows what its DOM says now.
async function framePainted(dbg, sessionId) {
  const painted = 'new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))';
  let timer;
  return Promise.race([
    send(dbg, sessionId, 'Runtime.evaluate', { expression: painted, awaitPromise: true }).then(
      (result) => !result.exceptionDetails,
      () => false,
    ),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(false), PAINT_WAIT_MS);
    }),
  ]).finally(() => clearTimeout(timer));
}

// Scrolls the owners of a cross-site frame into view, outermost first, so a
// node inside it can then be scrolled into the visible page.
async function scrollFrameIntoView(dbg, sessionId) {
  const frame = sessionId && attachments.get(dbg)?.sessions.get(sessionId);
  if (!frame) return;
  await scrollFrameIntoView(dbg, frame.parent);
  const { backendNodeId } = await send(dbg, frame.parent, 'DOM.getFrameOwner', {
    frameId: frame.frameId,
  });
  await send(dbg, frame.parent, 'DOM.scrollIntoViewIfNeeded', { backendNodeId });
}

function axTree(dbg, frame) {
  return send(dbg, frame.sessionId, 'Accessibility.getFullAXTree', { frameId: frame.id });
}

function boundsOf(quad) {
  const xs = [quad[0], quad[2], quad[4], quad[6]];
  const ys = [quad[1], quad[3], quad[5], quad[7]];
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

module.exports = {
  send,
  documentFrames,
  viewportMapping,
  framePainted,
  frameHolds,
  focusedFrame,
  frameStep,
  scrollFrameIntoView,
  axTree,
  boundsOf,
};
