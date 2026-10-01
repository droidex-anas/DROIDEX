// Every document in a guest page, wherever it runs. Same-process frames come
// from the frame tree; a cross-site frame runs in its own process and is
// reached through its own CDP session, attached as soon as the frame appears.
// Boxes inside such a frame are relative to it, so each session knows how to
// find its offset in the page's viewport.

const AUTO_ATTACH = { autoAttach: true, waitForDebuggerOnStart: false, flatten: true };
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

// Where a session's (0, 0) sits in the page's viewport: the content box of
// the iframe that owns it, added up through every cross-site parent.
async function frameOffset(dbg, sessionId) {
  if (!sessionId) return { x: 0, y: 0 };
  const frame = attachments.get(dbg)?.sessions.get(sessionId);
  if (!frame) throw new Error('The frame closed.');
  const { backendNodeId } = await send(dbg, frame.parent, 'DOM.getFrameOwner', {
    frameId: frame.frameId,
  });
  const { model } = await send(dbg, frame.parent, 'DOM.getBoxModel', { backendNodeId });
  const parent = await frameOffset(dbg, frame.parent);
  return { x: parent.x + model.content[0], y: parent.y + model.content[1] };
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

// A quad from a frame's own coordinates moved into the page's viewport.
function inViewport(quad, offset) {
  return quad.map((value, i) => value + (i % 2 ? offset.y : offset.x));
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
  frameOffset,
  scrollFrameIntoView,
  axTree,
  inViewport,
  boundsOf,
};
