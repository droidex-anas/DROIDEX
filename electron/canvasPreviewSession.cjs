/**
 * The session every Canvas preview guest attaches into, with its network shut
 * off and every capability taken away (spec §6). The document it serves is
 * canvasPreview.cjs.
 *
 * Kept free of `require('electron')` so it runs under plain Node.
 */

const { CANVAS_PREVIEW_SCHEME } = require('./canvasPreview.cjs');

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
  guestSession.setDevicePermissionHandler(() => false);
  await guestSession.setProxy(CANVAS_PREVIEW_PROXY);
  configuredSessions.add(guestSession);
}

module.exports = {
  CANVAS_PREVIEW_PARTITION,
  canvasPreviewSessionReady,
  configureCanvasPreviewSession,
};
