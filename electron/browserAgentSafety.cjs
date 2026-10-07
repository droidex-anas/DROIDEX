const { send, documentFrames, focusedFrame } = require('./browserFrames.cjs');
const {
  sensitiveFieldKind,
  inspectAuthenticationIntent,
  SENSITIVE_INPUT,
} = require('./browserFormSafety.cjs');
const {
  validateAgentAuthenticationIntent,
  approveAuthentication,
} = require('./browserAuthenticationIntent.cjs');

const INSPECT = `function (activation) {
  const sensitiveKind = ${sensitiveFieldKind};
  return {
    sensitive: sensitiveKind(this),
    intent: activation ? (${inspectAuthenticationIntent})(this, activation, sensitiveKind) : null
  };
}`;

function createBrowserAgentSafety({ reading, showPrompt }) {
  async function inspectNode(dbg, target, activation) {
    const { backendNodeId, sessionId, document } = target;
    if (!backendNodeId || target.closedShadow)
      throw new Error(
        'The focused field could not be inspected. Use a field ref or hand this step to the user.',
      );
    const frame = (await documentFrames(dbg)).find(
      (frame) => frame.loaderId === document && frame.sessionId === sessionId,
    );
    if (!frame) throw new Error('The page changed before the action ran; call browser_read_page.');
    const { executionContextId } = await send(dbg, sessionId, 'Page.createIsolatedWorld', {
      frameId: frame.id,
      worldName: 'droidex-agent-safety',
    });
    const { object } = await send(dbg, sessionId, 'DOM.resolveNode', {
      backendNodeId,
      executionContextId,
    });
    try {
      const { result, exceptionDetails } = await send(dbg, sessionId, 'Runtime.callFunctionOn', {
        objectId: object.objectId,
        functionDeclaration: INSPECT,
        arguments: [{ value: activation }],
        returnByValue: true,
      });
      if (exceptionDetails || !result?.value)
        throw new Error('The input target could not be inspected. Hand this step to the user.');
      const { sensitive, intent } = result.value;
      return {
        backendNodeId,
        sessionId,
        document,
        sensitive,
        intent: intent ? validateAgentAuthenticationIntent(intent, frame.url) : null,
      };
    } finally {
      await send(dbg, sessionId, 'Runtime.releaseObject', { objectId: object.objectId }).catch(
        () => undefined,
      );
    }
  }

  async function inspectPointer(dbg, entry, request, point) {
    if (request.ref) {
      const target = await reading.lookupRef(dbg, entry, request.ref);
      return inspectNode(dbg, { ...target, sessionId: target.frame.sessionId }, 'click');
    }
    const { cssLayoutViewport } = await dbg.sendCommand('Page.getLayoutMetrics');
    const hit = await dbg.sendCommand('DOM.getNodeForLocation', {
      x: Math.round(point.x + cssLayoutViewport.pageX),
      y: Math.round(point.y + cssLayoutViewport.pageY),
    });
    const frame = (await documentFrames(dbg)).find((frame) => frame.id === hit.frameId);
    if (!frame || frame.sessionId)
      throw new Error(
        'Use a ref to click inside this frame so DROIDEX can inspect the action first.',
      );
    return inspectNode(
      dbg,
      { backendNodeId: hit.backendNodeId, document: frame.loaderId },
      'click',
    );
  }

  async function inspectFocus(dbg, activation) {
    const focused = await focusedFrame(dbg);
    return inspectNode(dbg, focused, activation);
  }

  async function authorize(contents, entry, request, inspected) {
    if (inspected.intent)
      await approveAuthentication(showPrompt, contents, entry, request, inspected.intent);
  }

  function verify(approved, current) {
    if (JSON.stringify(approved) !== JSON.stringify(current))
      throw new Error(
        'The input target changed while approval was open. Read the page and try again.',
      );
  }

  return { inspectNode, inspectPointer, inspectFocus, authorize, verify };
}

function refuseSensitiveInput(inspected) {
  if (inspected.sensitive) throw new Error(SENSITIVE_INPUT);
}

module.exports = { createBrowserAgentSafety, refuseSensitiveInput };
