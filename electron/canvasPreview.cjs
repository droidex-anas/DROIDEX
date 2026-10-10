/**
 * The trusted intermediate every Canvas live preview loads, and main's registry
 * of the guests it attached (spec §6).
 *
 * One `<webview>` guest per live preview holds this document; the document holds
 * the generated design in an `about:srcdoc` iframe with `sandbox="allow-scripts"`
 * and no `allow-same-origin`. Generated `top.postMessage` therefore reaches this
 * intermediate rather than the chat renderer, and the chat keeps its own process.
 *
 * Nothing here grants the generated frame a capability. The intermediate accepts
 * a message only from its own iframe, only with the instance nonce, only in the
 * bounded event shapes below, and only until its queue is full; a flood is
 * dropped and counted, never buffered. The renderer pulls that queue through the
 * webview element's `executeJavaScript`, so no guest preload exists at all.
 *
 * Main owns termination: it ends a guest through the `webContents` it attached,
 * without waiting for the guest to answer.
 *
 * Kept free of `require('electron')` so it runs under plain Node.
 */

const CANVAS_PREVIEW_SCHEME = 'droidex-canvas-preview';
/** The only URL the handler serves, and the only `src` an attachment allows. */
const CANVAS_PREVIEW_URL = `${CANVAS_PREVIEW_SCHEME}://preview/guest`;
/**
 * The guest's own in-memory partition. Not `persist:`, so it keeps no storage,
 * and separate from the default session so the preview's network stack can be
 * shut off at the socket without touching the app's.
 */
const CANVAS_PREVIEW_PARTITION = 'droidex-canvas-preview';

/**
 * A proxy that cannot be reached, with loopback explicitly not bypassed.
 * Chromium resolves every TCP connection the guest makes through this, including
 * the P2P sockets WebRTC uses for TURN over TCP, so they go nowhere. Without
 * `<-loopback>` Chromium would bypass the proxy for loopback, which is exactly
 * where a probe's listener lives.
 */
const CANVAS_PREVIEW_PROXY = {
  mode: 'fixed_servers',
  proxyRules: 'http://127.0.0.1:1',
  proxyBypassRules: '<-loopback>',
};

/**
 * No network source anywhere, and `about:` frames only. Inline script and style
 * are allowed because the generated artifact is one inline-everything document
 * and an `about:srcdoc` frame inherits this policy. There is no `unsafe-eval`:
 * 03a's ruling is that runtime loading is bounded here, and esbuild's `__require`
 * shim throws in a browser.
 *
 * This policy does not bound WebRTC at all: `connect-src` does not govern ICE,
 * and Chromium never shipped the CSP3 `webrtc` directive — it logs it as
 * unrecognised. The guest's own session is what closes that path, by sending
 * every TCP connection through a dead proxy and refusing non-proxied UDP.
 */
const CANVAS_PREVIEW_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: droidex-canvas-preview:',
  'font-src data: droidex-canvas-preview:',
  'frame-src about:',
  "connect-src 'none'",
  "worker-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

/** One message from the generated frame, as JSON. Diagnostics are the largest. */
const MAX_PREVIEW_EVENT_BYTES = 4096;
/** Events held between two polls. Over this, a message is dropped and counted. */
const MAX_PREVIEW_QUEUED_EVENTS = 64;
/** Diagnostics one message may carry, and how much text each may carry. */
const MAX_PREVIEW_DIAGNOSTICS = 8;
/**
 * Bytes, like every other cap here, and the same number the renderer's reader
 * cuts to. Both sides cut rather than refuse, so a design cannot end its own
 * preview by writing a diagnostic in a script where characters are three bytes.
 */
const MAX_PREVIEW_TEXT_BYTES = 512;
/** The nonce charset the intermediate will embed; the renderer mints hex. */
const PREVIEW_NONCE_PATTERN = '^[0-9a-f]{32}$';

/**
 * The reporter that runs inside the generated frame: readiness once it has
 * painted, its content size, and its own uncaught failures as bounded
 * diagnostics, with a root render that failed before painting marked
 * `render_failed`. It is the only code the host adds to a design, it talks to
 * its parent and nothing else, and the nonce it carries is a correlator the
 * generated code can read (spec §6), not an authorization token.
 *
 * Task 8 adds `selection` and `interaction` here; the intermediate below already
 * accepts and bounds both shapes.
 */
const GENERATED_FRAME_REPORTER = `(() => {
  const nonce = '__CANVAS_PREVIEW_NONCE__';
  const post = (event, payload) => {
    try {
      parent.postMessage(Object.assign({ canvasPreview: nonce, event: event }, payload), '*');
    } catch {}
  };
  const report = (message, code = 'preview_error') => {
    post('diagnostics', {
      diagnostics: [{ code: code, message: String(message) }],
    });
  };
  addEventListener('error', (event) => report(event.message || 'The preview stopped with an error.'));
  addEventListener('unhandledrejection', (event) => report('Unhandled rejection: ' + String(event.reason)));
  const root = document.getElementById('canvas-root') || document.body;
  let lastWidth = -1;
  let lastHeight = -1;
  let ready = false;
  let reportedError = false;
  const measure = () => {
    const width = Math.ceil(root.scrollWidth);
    const height = Math.ceil(root.scrollHeight);
    if (width === lastWidth && height === lastHeight) return;
    lastWidth = width;
    lastHeight = height;
    post('resize', { width: width, height: height });
  };
  const renderState = () => {
    const result = globalThis.__droidexCanvasRenderState;
    if (result?.state === 'failed') {
      if (!reportedError) report(result.message || 'The preview stopped with an error.', 'render_failed');
      reportedError = true;
      return;
    }
    if (result?.state !== 'committed' || ready) return;
    ready = true;
    requestAnimationFrame(() => {
      if (globalThis.__droidexCanvasRenderState?.state !== 'committed') return;
      new ResizeObserver(measure).observe(root);
      measure();
      post('ready', {});
    });
  };
  addEventListener('droidex-canvas-render-state', renderState);
  renderState();
})();`;

/**
 * The intermediate's own script: the receiver, the bounded queue, and the two
 * calls the renderer drives through `executeJavaScript`. `start` installs one
 * instance and nothing can replace it, so a second start reaches a fresh guest
 * or nothing; `drain` throws when this document was never started, which the
 * renderer reads as a guest it no longer owns.
 */
const INTERMEDIATE_SCRIPT = `(() => {
  const REPORTER = __CANVAS_PREVIEW_REPORTER__;
  const frame = document.querySelector('iframe');
  const queue = [];
  let instance = null;
  let dropped = 0;

  const encoder = new TextEncoder();
  const bytes = (value) => encoder.encode(value).length;
  // Cut on a code point boundary, to the same byte cap the renderer cuts to.
  const text = (value) => {
    if (typeof value !== 'string') return '';
    if (bytes(value) <= ${String(MAX_PREVIEW_TEXT_BYTES)}) return value;
    let cut = '';
    for (const character of value) {
      if (bytes(cut + character) > ${String(MAX_PREVIEW_TEXT_BYTES)}) break;
      cut += character;
    }
    return cut;
  };
  const size = (value) =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.ceil(value) : null;

  // Only these shapes leave the intermediate, rebuilt field by field so no
  // getter, prototype or extra property from generated code ever travels.
  const normalize = (data) => {
    if (data.event === 'ready') return { event: 'ready' };
    if (data.event === 'resize') {
      const width = size(data.width);
      const height = size(data.height);
      return width === null || height === null ? null : { event: 'resize', width, height };
    }
    if (data.event === 'diagnostics') {
      if (!Array.isArray(data.diagnostics)) return null;
      const diagnostics = data.diagnostics
        .slice(0, ${String(MAX_PREVIEW_DIAGNOSTICS)})
        .filter((entry) => entry && typeof entry === 'object')
        .map((entry) => ({ code: text(entry.code) || 'preview_error', message: text(entry.message) }));
      return { event: 'diagnostics', diagnostics };
    }
    if (data.event === 'selection') {
      return {
        event: 'selection',
        elementId: text(data.elementId),
        instancePath: text(data.instancePath),
      };
    }
    if (data.event === 'interaction') return { event: 'interaction', kind: text(data.kind) };
    return null;
  };

  addEventListener('message', (message) => {
    if (!instance || message.source !== frame.contentWindow) return;
    const data = message.data;
    if (!data || typeof data !== 'object' || data.canvasPreview !== instance.nonce) return;
    let encoded;
    try {
      encoded = JSON.stringify(data);
    } catch {
      return;
    }
    // Bytes, not code units: a string of astral characters is four times its
    // length and would otherwise pass a cap named in bytes.
    if (typeof encoded !== 'string' || bytes(encoded) > ${String(MAX_PREVIEW_EVENT_BYTES)}) {
      dropped += 1;
      return;
    }
    const event = normalize(data);
    if (!event) return;
    // Full queue drops the newest: the queue never grows under a flood.
    if (queue.length >= ${String(MAX_PREVIEW_QUEUED_EVENTS)}) {
      dropped += 1;
      return;
    }
    queue.push(event);
  });

  globalThis.__droidexCanvasPreview = {
    start(request) {
      if (instance) return 'already_started';
      if (!request || typeof request !== 'object') return 'invalid_request';
      if (typeof request.nonce !== 'string' || !/${PREVIEW_NONCE_PATTERN}/.test(request.nonce))
        return 'invalid_request';
      if (typeof request.html !== 'string') return 'invalid_request';
      instance = {
        nonce: request.nonce,
        designId: String(request.designId),
        revisionId: String(request.revisionId),
        generation: Number(request.generation),
      };
      // Written with JS escapes so the HTML parser never sees a tag here.
      frame.srcdoc =
        request.html +
        '\\u003cscript>' +
        REPORTER.replace('__CANVAS_PREVIEW_NONCE__', request.nonce) +
        '\\u003c/script>';
      return 'started';
    },
    drain() {
      if (!instance) throw new Error('This Canvas preview guest was never started.');
      const events = queue.splice(0, queue.length);
      const lost = dropped;
      dropped = 0;
      return JSON.stringify({
        nonce: instance.nonce,
        designId: instance.designId,
        revisionId: instance.revisionId,
        generation: instance.generation,
        events,
        dropped: lost,
      });
    },
    identity() {
      if (!instance) return null;
      return {
        designId: instance.designId,
        revisionId: instance.revisionId,
        generation: instance.generation,
      };
    },
  };
})();`;

/** A JS string literal safe to inline in HTML: `<` can never open a tag. */
function scriptLiteral(text) {
  return JSON.stringify(text).replaceAll('<', '\\u003c');
}

/** The one document the preview scheme serves. */
function canvasPreviewDocument() {
  const script = INTERMEDIATE_SCRIPT.replace(
    '__CANVAS_PREVIEW_REPORTER__',
    scriptLiteral(GENERATED_FRAME_REPORTER),
  );
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Canvas preview</title>
<style>
html,body{margin:0;height:100%;background:transparent}
iframe{display:block;width:100%;height:100%;border:0}
</style>
</head>
<body>
<iframe sandbox="allow-scripts" referrerpolicy="no-referrer" title="Design preview"></iframe>
<script>
${script}
</script>
</body>
</html>
`;
}

/**
 * The sessions whose network has actually been shut off. An unconfigured session
 * routes `DIRECT`, which is the one state this whole boundary rests on not
 * existing, so the module that does the configuring is what answers whether a
 * given session is safe to attach a guest into.
 */
const configuredSessions = new WeakSet();

function canvasPreviewSessionReady(guestSession) {
  return configuredSessions.has(guestSession);
}

/**
 * Shuts the guest session's network off and takes every capability away from it.
 * The owned scheme is served here as well as on the default session, because a
 * guest in its own partition cannot see the default session's handlers. Only
 * once the proxy is in place does a guest become attachable.
 */
async function configureCanvasPreviewSession(guestSession, serve) {
  guestSession.protocol.handle(CANVAS_PREVIEW_SCHEME, serve);
  guestSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
  guestSession.setPermissionCheckHandler(() => false);
  await guestSession.setProxy(CANVAS_PREVIEW_PROXY);
  configuredSessions.add(guestSession);
}

module.exports = {
  CANVAS_PREVIEW_CSP,
  CANVAS_PREVIEW_PARTITION,
  CANVAS_PREVIEW_PROXY,
  CANVAS_PREVIEW_SCHEME,
  canvasPreviewSessionReady,
  configureCanvasPreviewSession,
  CANVAS_PREVIEW_URL,
  canvasPreviewDocument,
};
