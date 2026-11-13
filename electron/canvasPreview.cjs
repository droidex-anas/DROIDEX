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
 * bounded event shapes of canvasPreviewIntermediate.cjs, and only until its queue is full; a flood is
 * dropped and counted, never buffered. The renderer pulls that queue through the
 * webview element's `executeJavaScript`, so no guest preload exists at all.
 *
 * Main owns termination: it ends a guest through the `webContents` it attached,
 * without waiting for the guest to answer.
 *
 * Kept free of `require('electron')` so it runs under plain Node.
 */

const { GENERATED_FRAME_REPORTER } = require('./canvasPreviewReporter.cjs');
const { INTERMEDIATE_SCRIPT } = require('./canvasPreviewIntermediate.cjs');

const CANVAS_PREVIEW_SCHEME = 'droidex-canvas-preview';
/** The only URL the handler serves, and the only `src` an attachment allows. */
const CANVAS_PREVIEW_URL = `${CANVAS_PREVIEW_SCHEME}://preview/guest`;
/**
 * No network source anywhere, and `about:` frames only. Inline script and style
 * are allowed because the generated artifact is one inline-everything document
 * and an `about:srcdoc` frame inherits this policy. There is no `unsafe-eval`:
 * 03a's ruling is that runtime loading is bounded here, and esbuild's `__require`
 * shim throws in a browser.
 *
 * This policy does not bound WebRTC at all: `connect-src` does not govern ICE,
 * and Chromium never shipped the CSP3 `webrtc` directive — it logs it as
 * unrecognised. The guest's own session (canvasPreviewSession.cjs) closes that
 * path, by sending every TCP connection through a dead proxy and refusing
 * non-proxied UDP.
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

module.exports = {
  CANVAS_PREVIEW_CSP,
  CANVAS_PREVIEW_SCHEME,
  CANVAS_PREVIEW_URL,
  canvasPreviewDocument,
};
