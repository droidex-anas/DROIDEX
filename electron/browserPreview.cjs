// A small live picture of a page for picture in picture: a CDP screencast
// that runs only while the app's renderer says a preview is watching the page.

// Sharp at twice the preview window's 320 CSS pixels.
const MAX_WIDTH = 640;
const MAX_HEIGHT = 800;
const JPEG_QUALITY = 60;
// At most fifteen frames and 1.5 MB of JPEG a second reach the renderer.
// A still page sends its one frame at once.
const FRAME_MS = 66;
const BYTES_PER_SECOND = 1_500_000;

function createBrowserPreview({ liveContentsOf, runWithWebContentsDebugger, sendToRenderer }) {
  const watched = new Set(); // browser sessions a preview is watching
  const casts = new Map(); // browser session -> { contents, stop } of its screencast

  // Starts or stops the page's picture to match what the renderer asked for.
  // Also called when a guest is bound, so a page mounted after its preview has one,
  // and a guest that replaced another stops the old one's picture.
  function sync(browserSessionId) {
    const contents = liveContentsOf(browserSessionId);
    const cast = casts.get(browserSessionId);
    const wanted = watched.has(browserSessionId) && contents;
    if (cast && cast.contents !== wanted) {
      casts.delete(browserSessionId);
      cast.stop();
    }
    if (wanted && !casts.has(browserSessionId)) {
      casts.set(browserSessionId, { contents, stop: start(contents, browserSessionId) });
    }
  }

  function watch(browserSessionId, watching) {
    if (watching) watched.add(browserSessionId);
    else watched.delete(browserSessionId);
    sync(browserSessionId);
  }

  // The renderer that asked is gone, and its previews with it.
  function forget() {
    for (const browserSessionId of [...watched]) watch(browserSessionId, false);
  }

  function start(contents, browserSessionId) {
    const dbg = contents.debugger;
    const command = (method, params) =>
      runWithWebContentsDebugger(contents, (attached) =>
        attached.sendCommand(method, params),
      ).catch(() => undefined);
    // Frames are acked only when one is shown, so the page encodes no more
    // than its few in-flight frames between two shown ones.
    const unacked = [];
    let latest = null; // the newest frame not shown yet
    let due = 0; // when the next frame may be shown
    let timer = null;
    const show = () => {
      timer = null;
      if (contents.isDestroyed()) return;
      // Sent as bytes: the renderer decodes them off its main thread.
      const image = Buffer.from(latest.data, 'base64');
      due = Date.now() + Math.max(FRAME_MS, (image.length / BYTES_PER_SECOND) * 1000);
      sendToRenderer('native-browser-frame', {
        browserSessionId,
        image,
        // The page's own size in CSS pixels, to place the cursor on the picture.
        width: latest.metadata.deviceWidth,
        height: latest.metadata.deviceHeight,
      });
      latest = null;
      // Asked for directly: the picture goes on while an action holds the queue.
      for (const sessionId of unacked.splice(0))
        dbg.sendCommand('Page.screencastFrameAck', { sessionId }).catch(() => undefined);
    };
    const onMessage = (_event, method, params) => {
      if (method !== 'Page.screencastFrame') return;
      // Early frames wait; a newer one replaces them so the preview stays current.
      latest = params;
      unacked.push(params.sessionId);
      timer ??= setTimeout(() => show(), Math.max(0, due - Date.now()));
    };
    dbg.on('message', onMessage);
    void command('Page.startScreencast', {
      format: 'jpeg',
      quality: JPEG_QUALITY,
      maxWidth: MAX_WIDTH,
      maxHeight: MAX_HEIGHT,
    });
    return () => {
      clearTimeout(timer);
      dbg.off('message', onMessage);
      void command('Page.stopScreencast');
    };
  }

  return { watch, sync, forget };
}

module.exports = { createBrowserPreview };
