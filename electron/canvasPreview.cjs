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
  'img-src data:',
  'font-src data:',
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
 * How often main asks the generated frame whether it is still running, and how
 * long one of those questions may take. The renderer's poll bounds the
 * intermediate; this bounds the design, which is a process of its own and so is
 * invisible to those polls once it has reported `ready`.
 *
 * The question is a literal no-op evaluated in the frame, never a heartbeat the
 * design emits: generated code cannot be asked to report on itself.
 */
const GENERATED_PROBE_INTERVAL_MS = 2_000;
const GENERATED_PROBE_DEADLINE_MS = 3_000;
/** The whole probe: a literal with no reachable identifier. */
const GENERATED_PROBE = '0';

/**
 * The reporter that runs inside the generated frame: readiness once it has
 * painted, its content size, and its own uncaught failures as bounded
 * diagnostics. It is the only code the host adds to a design, it talks to its
 * parent and nothing else, and the nonce it carries is a correlator the
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
  const report = (message) => {
    post('diagnostics', {
      diagnostics: [{ code: 'preview_error', message: String(message) }],
    });
  };
  addEventListener('error', (event) => report(event.message || 'The preview stopped with an error.'));
  addEventListener('unhandledrejection', (event) => report('Unhandled rejection: ' + String(event.reason)));
  const root = document.getElementById('canvas-root') || document.body;
  let lastWidth = -1;
  let lastHeight = -1;
  const measure = () => {
    const width = Math.ceil(root.scrollWidth);
    const height = Math.ceil(root.scrollHeight);
    if (width === lastWidth && height === lastHeight) return;
    lastWidth = width;
    lastHeight = height;
    post('resize', { width: width, height: height });
  };
  new ResizeObserver(measure).observe(root);
  requestAnimationFrame(() => {
    measure();
    post('ready', {});
  });
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
 * The guests main attached, and the only way one is ended.
 *
 * `terminate` crashes the guest's renderer through main's own handle, which also
 * takes the generated frame's process with it: spec §6 requires main to end the
 * queue owner, because killing only the generated sender leaves the intermediate
 * holding a backlog. A guest ID main did not attach is refused.
 */
function createCanvasPreviewHosts({ log, clock = realClock }) {
  const guests = new Map();

  /** Drops a guest that is already gone, releasing its probe timers. */
  function forget(guestId) {
    const guest = guests.get(guestId);
    if (!guest) return;
    guests.delete(guestId);
    guest.stopProbing();
  }

  function end(guestId, reason) {
    const guest = guests.get(guestId);
    if (!guest) return false;
    guests.delete(guestId);
    guest.stopProbing();
    if (guest.contents.isDestroyed()) return true;
    log(`Ending preview guest ${String(guestId)}: ${reason}`);
    // Synchronous and main-owned: it waits for no guest reply.
    guest.contents.forcefullyCrashRenderer();
    return true;
  }

  /**
   * Main's own liveness check on the design. A guest whose intermediate answers
   * every poll can still hold a design that stopped running after it reported
   * `ready`: that frame is a separate process, so nothing the renderer measures
   * sees it. One probe is in flight at a time and a probe that misses its
   * deadline ends the guest, without waiting for the probe to settle.
   */
  function watchGeneratedFrame(guestId, contents) {
    let releaseDeadline = null;
    let probing = false;

    const tick = () => {
      if (probing) return;
      const frame = generatedFrameOf(contents);
      // No design mounted yet; the next tick looks again.
      if (!frame) return;
      probing = true;
      releaseDeadline = clock.schedule(() => {
        releaseDeadline = null;
        end(guestId, 'its design stopped responding');
      }, GENERATED_PROBE_DEADLINE_MS);
      const settle = () => {
        probing = false;
        releaseDeadline?.();
        releaseDeadline = null;
      };
      frame.executeJavaScript(GENERATED_PROBE).then(settle, settle);
    };

    const releaseInterval = clock.repeat(tick, GENERATED_PROBE_INTERVAL_MS);
    return () => {
      releaseInterval();
      releaseDeadline?.();
      releaseDeadline = null;
    };
  }

  return {
    /** Registers one attached guest and installs main's own watchdogs on it. */
    attach(contents) {
      const guestId = contents.id;
      // No UDP that is not proxied, and the guest's session proxies to nowhere,
      // so ICE has neither a datagram path nor a TCP one.
      contents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
      contents.setWindowOpenHandler(() => ({ action: 'deny' }));
      contents.on('will-navigate', (event, url) => {
        if (url !== CANVAS_PREVIEW_URL) event.preventDefault();
      });
      // Main's independent watchdogs: a wedged guest and a wedged design are
      // both ended here, with no renderer request and no guest cooperation.
      contents.on('unresponsive', () => end(guestId, 'unresponsive'));
      contents.on('render-process-gone', (_event, details) => {
        log(`Preview guest ${String(guestId)} is gone: ${details.reason}`);
        forget(guestId);
      });
      contents.on('destroyed', () => forget(guestId));
      guests.set(guestId, { contents, stopProbing: watchGeneratedFrame(guestId, contents) });
    },

    /** Ends a guest the renderer asked about. False when main does not own it. */
    terminate(guestId) {
      return end(guestId, 'the renderer asked for it');
    },
  };
}

/** The design's frame inside one guest, once the intermediate has mounted it. */
function generatedFrameOf(contents) {
  if (contents.isDestroyed()) return null;
  return contents.mainFrame.frames[0] ?? null;
}

const realClock = {
  schedule(task, delayMs) {
    const timer = setTimeout(task, delayMs);
    timer.unref?.();
    return () => clearTimeout(timer);
  },
  repeat(task, everyMs) {
    const timer = setInterval(task, everyMs);
    timer.unref?.();
    return () => clearInterval(timer);
  },
};

/**
 * Shuts the guest session's network off and takes every capability away from it.
 * The owned scheme is served here as well as on the default session, because a
 * guest in its own partition cannot see the default session's handlers.
 */
function configureCanvasPreviewSession(guestSession, serve) {
  guestSession.protocol.handle(CANVAS_PREVIEW_SCHEME, serve);
  guestSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
  guestSession.setPermissionCheckHandler(() => false);
  return guestSession.setProxy(CANVAS_PREVIEW_PROXY);
}

module.exports = {
  CANVAS_PREVIEW_CSP,
  CANVAS_PREVIEW_PARTITION,
  CANVAS_PREVIEW_PROXY,
  CANVAS_PREVIEW_SCHEME,
  configureCanvasPreviewSession,
  CANVAS_PREVIEW_URL,
  canvasPreviewDocument,
  createCanvasPreviewHosts,
};
