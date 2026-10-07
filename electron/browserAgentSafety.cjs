const { send, documentFrames, focusedFrame } = require('./browserFrames.cjs');
const {
  sensitiveFieldKind,
  sensitiveFieldDescription,
  inspectAuthenticationIntent,
  SENSITIVE_INPUT,
} = require('./browserFormSafety.cjs');
const {
  validateAgentAuthenticationIntent,
  approveAuthentication,
} = require('./browserAuthenticationIntent.cjs');

const INSPECT = `function (activation, requireFocus) {
  if (requireFocus) {
    let focused = this.ownerDocument.activeElement;
    while (focused?.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement;
    if (focused !== this) throw new Error('The input target lost focus.');
  }
  const sensitiveKind = (field) => (${sensitiveFieldKind})(field, ${sensitiveFieldDescription});
  return {
    sensitive: sensitiveKind(this),
    intent: activation ? (${inspectAuthenticationIntent})(this, activation, sensitiveKind) : null
  };
}`;

function createBrowserAgentSafety({ showPrompt }) {
  async function inspectNode(dbg, target, activation, dispatch, requireFocus = false) {
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
        arguments: [{ value: activation }, { value: requireFocus }],
        returnByValue: true,
      });
      if (exceptionDetails || !result?.value)
        throw new Error('The input target could not be inspected. Hand this step to the user.');
      const { sensitive, intent } = result.value;
      const inspected = {
        backendNodeId,
        sessionId,
        document,
        sensitive,
        intent: intent ? validateAgentAuthenticationIntent(intent, frame.url) : null,
      };
      // Dispatch before releasing the object or making any other CDP request.
      return dispatch ? await dispatch(inspected) : inspected;
    } finally {
      await send(dbg, sessionId, 'Runtime.releaseObject', { objectId: object.objectId }).catch(
        () => undefined,
      );
    }
  }

  async function inspectPointer(dbg, point, dispatch) {
    const { sessionId } = point;
    const local = point.local || point;
    const { cssLayoutViewport } = await send(dbg, sessionId, 'Page.getLayoutMetrics');
    const hit = await send(dbg, sessionId, 'DOM.getNodeForLocation', {
      x: Math.round(local.x + cssLayoutViewport.pageX),
      y: Math.round(local.y + cssLayoutViewport.pageY),
      includeUserAgentShadowDOM: false,
    });
    const frame = (await documentFrames(dbg)).find(
      (frame) => frame.id === hit.frameId && frame.sessionId === sessionId,
    );
    if (!frame)
      throw new Error(
        'Use a ref to click inside this frame so DROIDEX can inspect the action first.',
      );
    return inspectNode(
      dbg,
      { backendNodeId: hit.backendNodeId, document: frame.loaderId, sessionId },
      'click',
      dispatch,
    );
  }

  async function inspectFocus(dbg, activation, dispatch) {
    const focused = await focusedFrame(dbg);
    return inspectNode(dbg, focused, activation, dispatch, true);
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
