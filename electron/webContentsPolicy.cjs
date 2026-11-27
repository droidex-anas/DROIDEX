const { app, session } = require('electron');
const canvasPreview = require('./canvasPreview.cjs');
const canvasPreviewSession = require('./canvasPreviewSession.cjs');
const { previewGuestSession } = require('./appProtocols.cjs');
const { getMainWindow } = require('./mainWindow.cjs');

function createWebContentsPolicy({ nativeBrowserManager, canvasPreviewHosts }) {
  // Claims each <webview> guest in the same dispatch that creates it: a Canvas
  // preview whose attach was just hardened, or a Browser page for the session
  // main reserved it for (see installWebviewAttachment).
  let attachingCanvasPreview = false;
  const canvasPreviewGuests = new WeakSet();
  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() === 'webview' && attachingCanvasPreview) {
      attachingCanvasPreview = false;
      canvasPreviewGuests.add(contents);
      return;
    }
    nativeBrowserManager.handleCreated(contents);
  });
  /**
   * Routes each <webview> attachment to its one owner by the source it asks for:
   * the owned Canvas preview source gets the preview hardening, and every other
   * guest must carry a Browser reservation. Guests are created synchronously after
   * the attach is accepted, so the created guest is claimed in the same dispatch.
   */
  function installWebviewAttachment(contents) {
    contents.on('will-attach-webview', (event, preferences, params) => {
      if (params.src !== canvasPreview.CANVAS_PREVIEW_URL) {
        attachingCanvasPreview = false;
        nativeBrowserManager.handleWillAttach(event, preferences, params, contents);
        return;
      }
      attachingCanvasPreview = hardenCanvasPreviewGuest(event, preferences, params);
    });
    contents.on('did-attach-webview', (_event, guest) => {
      if (canvasPreviewGuests.has(guest)) canvasPreviewHosts.attach(guest);
      else nativeBrowserManager.handleAttached(guest);
    });
  }

  /**
   * The attachment boundary for Canvas preview guests (spec §6): any requested
   * preload is deleted, and Node, nested Node and nested guests stay off while
   * context isolation, the guest sandbox and web security stay on.
   */
  function hardenCanvasPreviewGuest(event, preferences, params) {
    // Before the guest session is configured it routes DIRECT, so a guest that
    // attached then would have a live network however correct its partition is.
    if (!canvasPreviewSession.canvasPreviewSessionReady(previewGuestSession(session))) {
      console.warn('[canvas-preview] Refused a guest before its session was configured');
      event.preventDefault();
      return false;
    }
    delete preferences.preload;
    delete params.preload;
    // The guest's own in-memory session: no storage, every TCP connection to a
    // dead proxy, no permissions. A `<webview>` may name any partition, so this
    // is forced here rather than trusted from the element.
    params.partition = canvasPreviewSession.CANVAS_PREVIEW_PARTITION;
    preferences.partition = canvasPreviewSession.CANVAS_PREVIEW_PARTITION;
    preferences.nodeIntegration = false;
    preferences.nodeIntegrationInSubFrames = false;
    preferences.contextIsolation = true;
    preferences.sandbox = true;
    preferences.webSecurity = true;
    preferences.webviewTag = false;
    return true;
  }

  // Voice mode records only while the user holds a conversation open, and only
  // the app's own window may ask. Every other permission stays denied, and the
  // Browser pane's partition is untouched, so a web page there cannot reach the
  // microphone.
  // The app had no permission handler until voice needed the microphone, so
  // everything a page asked for was granted by default. Adding one closes that,
  // which means the app's own needs have to be named here: the microphone for a
  // voice conversation, the clipboard for copy and paste, and notifications for
  // a finished turn. Everything else is refused, and so is every window that is
  // not the app's own, including the pages the embedded browser loads.
  const WINDOW_PERMISSIONS = new Set([
    'clipboard-read',
    'clipboard-sanitized-write',
    'notifications',
  ]);

  function registerMediaPermissions() {
    const isOwnWindow = (contents) =>
      getMainWindow() !== null &&
      !getMainWindow().isDestroyed() &&
      contents === getMainWindow().webContents;
    // An empty list is not audio: legacy capture requests arrive with no types
    // and can still end up with a video device once approved.
    const isAudioOnly = (types) =>
      Array.isArray(types) && types.length > 0 && types.every((type) => type === 'audio');
    session.defaultSession.setPermissionRequestHandler(
      (contents, permission, callback, details) => {
        if (!isOwnWindow(contents)) {
          callback(false);
          return;
        }
        if (permission === 'audioCapture') {
          callback(true);
          return;
        }
        if (permission === 'media') {
          callback(isAudioOnly(details?.mediaTypes));
          return;
        }
        callback(WINDOW_PERMISSIONS.has(permission));
      },
    );
    session.defaultSession.setPermissionCheckHandler((contents, permission, _origin, details) => {
      if (contents === null || !isOwnWindow(contents)) return false;
      if (permission === 'audioCapture') return true;
      if (permission === 'media') return details?.mediaType === 'audio';
      return WINDOW_PERMISSIONS.has(permission);
    });
  }
  return { installWebviewAttachment, registerMediaPermissions };
}

module.exports = { createWebContentsPolicy };
