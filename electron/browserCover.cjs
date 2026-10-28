// What would take input at a ref's point instead of the ref's own element: a
// dialog, a banner, a menu that opened, or, for a ref in a cross-site frame,
// anything over that frame in a frame outside it. A click or hover by ref that
// something covers is refused, naming the cover with a ref of its own.

const { send, frameStep, documentFrames } = require('./browserFrames.cjs');
const { refFor, forgetRefs } = require('./browserRefs.cjs');
const { labelOf } = require('./browserText.cjs');
const { isField } = require('./browserMasking.cjs');

function createBrowserCover({ reading }) {
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
      x: Math.round(x + view.pageX),
      y: Math.round(y + view.pageY),
      includeUserAgentShadowDOM: false,
    }).catch((error) => {
      // Nothing is drawn there; any other failure leaves the point unchecked.
      if (/no node found/i.test(String(error?.message))) return undefined;
      throw error;
    });
  }

  // Each node is resolved inside the `try`, so one that fails still lets the
  // other go.
  async function holds(dbg, sessionId, backendNodeId, hit) {
    const objectIds = [];
    try {
      for (const id of [backendNodeId, hit.backendNodeId]) {
        const { object } = await send(dbg, sessionId, 'DOM.resolveNode', { backendNodeId: id });
        objectIds.push(object.objectId);
      }
      const [ref, other] = objectIds;
      const { result: held } = await send(dbg, sessionId, 'Runtime.callFunctionOn', {
        objectId: ref,
        functionDeclaration: CONTAINS,
        arguments: [{ objectId: other }],
        returnByValue: true,
      });
      return held.value === true;
    } finally {
      for (const objectId of objectIds)
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
      node?.role?.value && (name || !['none', 'generic'].includes(node.role.value))
        ? node.role.value
        : `<${(await send(dbg, sessionId, 'DOM.describeNode', { backendNodeId: hit.backendNodeId })).node.localName}>`;
    const frame = (await documentFrames(dbg)).find((candidate) => candidate.id === hit.frameId);
    const ref = frame ? ` (${refFor(entry, frame.loaderId, hit.backendNodeId)})` : '';
    // The new ref was issued last, so it outlives the ones forgotten.
    forgetRefs(entry);
    return `${role}${name ? ` "${name}"` : ''}${ref}`;
  }

  return { refuseCovered };
}

// Run on a ref's element: whether a hit node is that element or inside it,
// shadow roots included.
const CONTAINS = `function (other) {
  for (let node = other; node; node = node.parentNode || node.host) if (node === this) return true;
  return false;
}`;

module.exports = { createBrowserCover };
