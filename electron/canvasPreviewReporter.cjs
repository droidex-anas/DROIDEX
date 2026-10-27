// The reporter the Canvas preview intermediate (canvasPreview.cjs) adds to
// every generated design. It runs inside the sandboxed design frame, so it is
// kept as source text here and installed by the intermediate.
//
// Kept free of `require('electron')` so it runs under plain Node.

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

module.exports = { GENERATED_FRAME_REPORTER };
