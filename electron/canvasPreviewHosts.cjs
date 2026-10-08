// Main owns the attached preview guests, their watchdogs and compositor capture.
// A capture never waits for generated code: the same guest the board displays
// supplies the pixels, and main ends a hung compositor after six seconds.

const { CANVAS_PREVIEW_URL } = require('./canvasPreview.cjs');

const GENERATED_PROBE_INTERVAL_MS = 2_000;
const GENERATED_PROBE_DEADLINE_MS = 3_000;
const GENERATED_PROBE = '0';
const PREVIEW_IDENTITY_SCRIPT = 'globalThis.__droidexCanvasPreview.identity()';
const CAPTURE_DEADLINE_MS = 6_000;
const MAX_CAPTURE_DIMENSION_PX = 4_096;
const MAX_CAPTURE_PIXELS = 16_000_000;
const MAX_CAPTURE_BYTES = 8 * 1024 * 1024;
const MAX_CACHED_BYTES = 32 * 1024 * 1024;
const IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const UNAVAILABLE = 'This design could not be captured. Keep its preview open and try again.';
const TIMED_OUT = 'Capturing this design took too long. Keep its preview open and try again.';

function captureFailure(message = UNAVAILABLE) {
  return { ok: false, error: { code: 'capture_unavailable', message } };
}

function captureKey(canvasId, designId, revisionId) {
  if (
    ![canvasId, designId, revisionId].every((id) => typeof id === 'string' && IDENTIFIER.test(id))
  )
    return null;
  return JSON.stringify([canvasId, designId, revisionId]);
}

function captureBounds(width, height, scaleFactor) {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 8_192 ||
    height > 8_192 ||
    !Number.isFinite(scaleFactor) ||
    scaleFactor < 1 ||
    scaleFactor > 4
  )
    return false;
  const pixelWidth = Math.ceil(width * scaleFactor);
  const pixelHeight = Math.ceil(height * scaleFactor);
  return (
    pixelWidth <= MAX_CAPTURE_DIMENSION_PX &&
    pixelHeight <= MAX_CAPTURE_DIMENSION_PX &&
    pixelWidth * pixelHeight <= MAX_CAPTURE_PIXELS
  );
}

/** The PNG header is checked before any bytes leave main or enter its cache. */
function validPng(bytes, width, height, scaleFactor) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 33 || bytes.length > MAX_CAPTURE_BYTES)
    return false;
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE) || bytes.toString('ascii', 12, 16) !== 'IHDR')
    return false;
  const pixelWidth = bytes.readUInt32BE(16);
  const pixelHeight = bytes.readUInt32BE(20);
  return (
    pixelWidth <= MAX_CAPTURE_DIMENSION_PX &&
    pixelHeight <= MAX_CAPTURE_DIMENSION_PX &&
    pixelWidth * pixelHeight <= MAX_CAPTURE_PIXELS &&
    Math.abs(pixelWidth - width * scaleFactor) <= 1 &&
    Math.abs(pixelHeight - height * scaleFactor) <= 1
  );
}

/** The guests main attached, their independent watchdogs and capture requests. */
function createCanvasPreviewHosts({ log, clock = realClock, canCapture = () => true }) {
  const guests = new Map();
  const captures = new Map();
  const thumbnails = new Map();
  let cachedBytes = 0;

  function captureAvailable() {
    try {
      return canCapture();
    } catch {
      return false;
    }
  }

  function forget(guestId) {
    const guest = guests.get(guestId);
    if (!guest) return;
    guests.delete(guestId);
    guest.stopProbing();
    for (const capture of captures.values()) {
      if (capture.guestId !== guestId) continue;
      capture.settle(captureFailure());
      capture.finish();
    }
    for (const [key, thumbnail] of thumbnails) {
      if (thumbnail.guestId === guestId) releaseThumbnail(key);
    }
  }

  function end(guestId, reason) {
    const guest = guests.get(guestId);
    if (!guest) return false;
    forget(guestId);
    if (guest.contents.isDestroyed()) return true;
    log(`Ending preview guest ${String(guestId)}: ${reason}`);
    guest.contents.forcefullyCrashRenderer();
    return true;
  }

  function watchGeneratedFrame(guestId, contents) {
    let releaseDeadline = null;
    let probing = false;
    const tick = () => {
      if (probing) return;
      const frame = generatedFrameOf(contents);
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

  function releaseThumbnail(key) {
    const thumbnail = thumbnails.get(key);
    if (!thumbnail) return;
    cachedBytes -= thumbnail.bytes.length;
    thumbnails.delete(key);
  }

  function cache(key, bytes, guestId) {
    releaseThumbnail(key);
    thumbnails.set(key, { bytes, guestId });
    cachedBytes += bytes.length;
    while (cachedBytes > MAX_CACHED_BYTES) {
      const oldest = thumbnails.keys().next().value;
      releaseThumbnail(oldest);
    }
  }

  return {
    attach(contents) {
      const guestId = contents.id;
      contents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
      contents.setWindowOpenHandler(() => ({ action: 'deny' }));
      contents.on('will-navigate', (event, url) => {
        if (url !== CANVAS_PREVIEW_URL) event.preventDefault();
      });
      contents.on('unresponsive', () => end(guestId, 'unresponsive'));
      contents.on('render-process-gone', (_event, details) => {
        log(`Preview guest ${String(guestId)} is gone: ${details.reason}`);
        forget(guestId);
      });
      contents.on('destroyed', () => forget(guestId));
      guests.set(guestId, { contents, stopProbing: watchGeneratedFrame(guestId, contents) });
    },

    terminate(guestId) {
      return end(guestId, 'the renderer asked for it');
    },

    clear() {
      for (const guestId of guests.keys()) forget(guestId);
    },

    /** Caller settlement cannot release the deadline of unfinished native work. */
    cancelCapture(requestId) {
      const capture = captures.get(requestId);
      if (!capture) return false;
      return capture.settle(captureFailure());
    },

    capture(request) {
      if (!request || typeof request !== 'object') return Promise.resolve(captureFailure());
      const {
        requestId,
        guestId,
        canvasId,
        designId,
        revisionId,
        generation,
        width,
        height,
        scaleFactor,
      } = request;
      const key = captureKey(canvasId, designId, revisionId);
      const guest = guests.get(guestId);
      if (
        typeof requestId !== 'string' ||
        !IDENTIFIER.test(requestId) ||
        captures.has(requestId) ||
        !key ||
        !guest ||
        guest.capture ||
        guest.contents.isDestroyed() ||
        !captureAvailable() ||
        !Number.isSafeInteger(generation) ||
        generation < 1 ||
        !captureBounds(width, height, scaleFactor)
      )
        return Promise.resolve(captureFailure());

      return new Promise((resolve) => {
        let releaseDeadline = null;
        let settled = false;
        const settle = (result) => {
          if (settled) return false;
          settled = true;
          resolve(result);
          return true;
        };
        const finish = () => {
          if (captures.get(requestId)?.settle !== settle) return;
          captures.delete(requestId);
          guest.capture = null;
          releaseDeadline?.();
        };
        const complete = (result) => {
          finish();
          settle(result);
        };
        const isCurrent = () =>
          !settled && captures.get(requestId)?.settle === settle && guests.get(guestId) === guest;
        const capture = { guestId, settle, finish };
        captures.set(requestId, capture);
        guest.capture = capture;
        releaseDeadline = clock.schedule(() => {
          settle(captureFailure(TIMED_OUT));
          end(guestId, 'its capture took too long');
        }, CAPTURE_DEADLINE_MS);
        void Promise.resolve()
          .then(() => guest.contents.executeJavaScript(PREVIEW_IDENTITY_SCRIPT))
          .then((identity) => {
            if (!isCurrent()) return;
            if (
              !identity ||
              identity.designId !== designId ||
              identity.revisionId !== revisionId ||
              identity.generation !== generation
            ) {
              complete(captureFailure());
              return;
            }
            return guest.contents.capturePage({ x: 0, y: 0, width, height }, { stayHidden: true });
          })
          .then((image) => {
            if (!isCurrent()) return;
            if (!image) return;
            if (image.isEmpty()) return complete(captureFailure());
            const bytes = image.toPNG({ scaleFactor });
            if (!captureAvailable() || !validPng(bytes, width, height, scaleFactor))
              return complete(captureFailure());
            return guest.contents.executeJavaScript(PREVIEW_IDENTITY_SCRIPT).then((identity) => {
              if (!isCurrent()) return;
              if (
                !identity ||
                identity.designId !== designId ||
                identity.revisionId !== revisionId ||
                identity.generation !== generation
              ) {
                complete(captureFailure());
                return;
              }
              cache(key, bytes, guestId);
              complete({ ok: true, mediaType: 'image/png', bytes });
            });
          })
          .catch(() => complete(captureFailure()))
          .finally(finish);
      });
    },

    readThumbnail(canvasId, designId, revisionId) {
      const key = captureKey(canvasId, designId, revisionId);
      if (!key) return null;
      const thumbnail = thumbnails.get(key);
      if (!thumbnail) return null;
      thumbnails.delete(key);
      thumbnails.set(key, thumbnail);
      return thumbnail.bytes;
    },
  };
}

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

module.exports = { createCanvasPreviewHosts, validPng, MAX_CAPTURE_BYTES };
