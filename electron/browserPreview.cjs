// A small live picture of a page for the transcript's Browser card: a CDP
// screencast, small and slow by design, that runs only while the app's renderer
// says a card is watching the page.

const MAX_WIDTH = 480;
const MAX_HEIGHT = 960;
const JPEG_QUALITY = 50;
// At most four frames and 150 KB a second reach the renderer. The page is
// asked for its next frame only once the last has had its time, and a frame
// that still comes early is dropped. A still page sends its one frame at once.
const FRAME_MS = 250;
const BYTES_PER_SECOND = 150_000;

function createBrowserPreview({ liveContentsOf, runWithWebContentsDebugger, sendToRenderer }) {
  const watched = new Set(); // browser sessions a card is watching
  const casts = new WeakMap(); // guest contents -> stop its screencast

  // Starts or stops the page's picture to match what the renderer asked for.
  // Also called when a guest is bound, so a page mounted after its card has one.
  function sync(browserSessionId) {
    const contents = liveContentsOf(browserSessionId);
    if (!contents) return;
    const stop = casts.get(contents);
    if (watched.has(browserSessionId) && !stop) {
      casts.set(contents, start(contents, browserSessionId));
    } else if (!watched.has(browserSessionId) && stop) {
      casts.delete(contents);
      stop();
    }
  }

  function watch(browserSessionId, watching) {
    if (watching) watched.add(browserSessionId);
    else watched.delete(browserSessionId);
    sync(browserSessionId);
  }

  // The renderer that asked is gone, and its cards with it.
  function forget() {
    for (const browserSessionId of [...watched]) watch(browserSessionId, false);
  }

  function start(contents, browserSessionId) {
    const dbg = contents.debugger;
    const command = (method, params) =>
      runWithWebContentsDebugger(contents, (attached) =>
        attached.sendCommand(method, params),
      ).catch(() => undefined);
    const acks = new Set();
    // When the next frame may be shown.
    let due = 0;
    const onMessage = (_event, method, params) => {
      if (method !== 'Page.screencastFrame') return;
      const now = Date.now();
      if (now >= due) {
        const bytes = params.data.length * 0.75;
        due = now + Math.max(FRAME_MS, (bytes / BYTES_PER_SECOND) * 1000);
        sendToRenderer('native-browser-frame', {
          browserSessionId,
          image: params.data,
          // The page's own width in CSS pixels, to place the cursor on the picture.
          width: params.metadata.deviceWidth,
        });
      }
      // Asked for directly: the picture goes on while an action holds the queue.
      const ack = setTimeout(() => {
        acks.delete(ack);
        if (contents.isDestroyed()) return;
        dbg
          .sendCommand('Page.screencastFrameAck', { sessionId: params.sessionId })
          .catch(() => undefined);
      }, due - now);
      acks.add(ack);
    };
    dbg.on('message', onMessage);
    void command('Page.startScreencast', {
      format: 'jpeg',
      quality: JPEG_QUALITY,
      maxWidth: MAX_WIDTH,
      maxHeight: MAX_HEIGHT,
    });
    return () => {
      for (const ack of acks) clearTimeout(ack);
      dbg.off('message', onMessage);
      void command('Page.stopScreencast');
    };
  }

  return { watch, sync, forget };
}

module.exports = { createBrowserPreview };
