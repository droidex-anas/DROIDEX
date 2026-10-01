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
    dbg.on('message', (_event, method, params, sessionId) => {
      if (method === 'Target.attachedToTarget' && params.targetInfo.type === 'iframe') {
        sessions.set(params.sessionId, {
          frameId: params.targetInfo.targetId,
          parent: sessionId || undefined,
        });
        autoAttach(params.sessionId);
      } else if (method === 'Target.detachedFromTarget') {
        sessions.delete(params.sessionId);
      }
    });
    dbg.on('detach', () => attachments.delete(dbg));
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
// through the content box of the iframe that owns it, which may be scaled or
// rotated, and on through every cross-site parent.
async function viewportMapping(dbg, sessionId) {
  if (!sessionId) return (quad) => quad;
  const frame = attachments.get(dbg)?.sessions.get(sessionId);
  if (!frame) throw new Error('The frame closed.');
  const { backendNodeId } = await send(dbg, frame.parent, 'DOM.getFrameOwner', {
    frameId: frame.frameId,
  });
  const { model } = await send(dbg, frame.parent, 'DOM.getBoxModel', { backendNodeId });
  const [x0, y0, x1, y1, , , x3, y3] = model.content;
  const [bx0, by0, bx1, by1, , , bx3, by3] = model.border;
  // The box model's width and height are before any transform; along each
  // edge the content box keeps its share of the border box.
  const width = (model.width * Math.hypot(x1 - x0, y1 - y0)) / Math.hypot(bx1 - bx0, by1 - by0);
  const height = (model.height * Math.hypot(x3 - x0, y3 - y0)) / Math.hypot(bx3 - bx0, by3 - by0);
  const parent = await viewportMapping(dbg, frame.parent);
  return (quad) =>
    parent(
      quad.map((_, i) => {
        const u = quad[i - (i % 2)] / width;
        const v = quad[i - (i % 2) + 1] / height;
        return i % 2 ? y0 + u * (y1 - y0) + v * (y3 - y0) : x0 + u * (x1 - x0) + v * (x3 - x0);
      }),
    );
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
  scrollFrameIntoView,
  axTree,
  boundsOf,
};
