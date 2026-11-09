// Main owns the attached preview guests, their watchdogs and compositor capture.
// A capture never waits for generated code: the same guest the board displays
// supplies the pixels, and main ends a hung compositor after six seconds.

const { CANVAS_PREVIEW_URL } = require('./canvasPreview.cjs');

const GENERATED_PROBE_INTERVAL_MS = 2_000;
const GENERATED_PROBE_DEADLINE_MS = 3_000;
const GENERATED_PROBE = '0';
const PREVIEW_IDENTITY_SCRIPT = 'globalThis.__droidexCanvasPreview.identity()';
// Read in the guest's own top frame, which generated code cannot reach.
const DISPLAY_SCALE_SCRIPT = 'devicePixelRatio';
const CAPTURE_DEADLINE_MS = 6_000;
const MAX_CAPTURE_DIMENSION_PX = 4_096;
const MAX_CAPTURE_PIXELS = 16_000_000;
const MAX_CAPTURE_BYTES = 8 * 1024 * 1024;
const MAX_CACHED_BYTES = 32 * 1024 * 1024;
const MAX_RETAINED_CAPTURES = 4;
const IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const UNAVAILABLE = 'This design could not be captured. Keep its preview open and try again.';
const TIMED_OUT = 'Capturing this design took too long. Keep its preview open and try again.';

function captureFailure(message = UNAVAILABLE) {
  return { ok: false, error: { code: 'capture_unavailable', message } };
}

function isIdentifier(id) {
  return typeof id === 'string' && IDENTIFIER.test(id);
}

function captureKey(canvasId, designId, revisionId) {
  if (![canvasId, designId, revisionId].every(isIdentifier)) return null;
  return JSON.stringify([canvasId, designId, revisionId]);
}

/** A kit preview names no canvas; its capture is stored with the kit, so main keeps none. */
function isKitCapture(guest, canvasId, designId, revisionId) {
  return (
    canvasId === null &&
    guest?.binding?.kind === 'kit' &&
    isIdentifier(designId) &&
    isIdentifier(revisionId)
  );
}

function validSize(width, height, scaleFactor) {
  return (
    Number.isSafeInteger(width) &&
    Number.isSafeInteger(height) &&
    width >= 1 &&
    height >= 1 &&
    width <= 8_192 &&
    height <= 8_192 &&
    Number.isFinite(scaleFactor) &&
    scaleFactor >= 1 &&
    scaleFactor <= 4
  );
}

function fitsCaps(width, height, scaleFactor) {
  const pixelWidth = Math.ceil(width * scaleFactor);
  const pixelHeight = Math.ceil(height * scaleFactor);
  return (
    pixelWidth <= MAX_CAPTURE_DIMENSION_PX &&
    pixelHeight <= MAX_CAPTURE_DIMENSION_PX &&
    pixelWidth * pixelHeight <= MAX_CAPTURE_PIXELS
  );
}

/** Names the largest whole scale under the caps, so a refusal says what would work. */
function tooLarge(width, height, scaleFactor) {
  let fits = Math.ceil(scaleFactor) - 1;
  while (fits >= 1 && !fitsCaps(width, height, fits)) fits -= 1;
  const asked = `${String(scaleFactor)}x`;
  return captureFailure(
    fits >= 1
      ? `Too large at ${asked}; try ${String(fits)}x.`
      : `Too large to capture at ${asked}.`,
  );
}

/**
 * The compositor answers at the display's own scale, and its PNG cannot be
 * scaled up without blurring, so another scale is drawn again by Chromium.
 */
function atScale(contents, bytes, width, height, scaleFactor) {
  const native = pngSize(bytes);
  if (!native || isAtScale(native, width, height, scaleFactor)) return bytes;
  return redraw(contents, width, height, scaleFactor / (native.pixelWidth / width));
}

/** Chromium's own drawing of the page at `scale` times the display's scale. */
async function redraw(contents, width, height, scale) {
  const debuggerClient = contents.debugger;
  const wasAttached = debuggerClient.isAttached();
  if (!wasAttached) debuggerClient.attach('1.3');
  try {
    const { data } = await debuggerClient.sendCommand('Page.captureScreenshot', {
      format: 'png',
      clip: { x: 0, y: 0, width, height, scale },
    });
    return Buffer.from(data, 'base64');
  } finally {
    if (!wasAttached && !contents.isDestroyed()) debuggerClient.detach();
  }
}

/** A PNG's pixel size from its header, or null for bytes that are not a PNG. */
function pngSize(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 33) return null;
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE) || bytes.toString('ascii', 12, 16) !== 'IHDR')
    return null;
  return { pixelWidth: bytes.readUInt32BE(16), pixelHeight: bytes.readUInt32BE(20) };
}

function isAtScale({ pixelWidth, pixelHeight }, width, height, scaleFactor) {
  return (
    Math.abs(pixelWidth - width * scaleFactor) <= 1 &&
    Math.abs(pixelHeight - height * scaleFactor) <= 1
  );
}

/** The PNG header is checked against the caps before any bytes leave main or enter its cache. */
function validPng(bytes, width, height, scaleFactor) {
  const size = pngSize(bytes);
  if (!size || bytes.length > MAX_CAPTURE_BYTES) return false;
  const { pixelWidth, pixelHeight } = size;
  return (
    pixelWidth <= MAX_CAPTURE_DIMENSION_PX &&
    pixelHeight <= MAX_CAPTURE_DIMENSION_PX &&
    pixelWidth * pixelHeight <= MAX_CAPTURE_PIXELS &&
    isAtScale(size, width, height, scaleFactor)
  );
}

/** The guests main attached, their independent watchdogs and capture requests. */
function createCanvasPreviewHosts({ log, clock = realClock, canCapture = () => true }) {
  const guests = new Map();
  const captures = new Map();
  const thumbnails = new Map();
  // Captures kept for a save, by request: the thumbnail of a revision is
  // whichever capture landed last, so a save never reads it.
  const retained = new Map();
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
    // A thumbnail outlives its guest: it is what the board shows for a frame
    // that lost its live slot. The byte bound and window close release them.
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

  function retain(requestId, bytes) {
    retained.set(requestId, bytes);
    if (retained.size > MAX_RETAINED_CAPTURES) retained.delete(retained.keys().next().value);
  }

  function cache(key, bytes) {
    releaseThumbnail(key);
    thumbnails.set(key, { bytes });
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
      guests.set(guestId, {
        contents,
        binding: null,
        stopProbing: watchGeneratedFrame(guestId, contents),
      });
    },

    /**
     * Binds a guest once, before its code runs: to the one canvas whose images
     * it may read, or to a kit, which reads fonts only.
     */
    bind(guestId, binding) {
      const guest = guests.get(guestId);
      const requested = previewBinding(binding);
      if (!requested || !guest || guest.contents.isDestroyed()) return false;
      if (guest.binding !== null) return sameBinding(guest.binding, requested);
      guest.binding = requested;
      return true;
    },

    /** The binding of a request's own generated frame, or null. */
    bindingForFrame(guestId, frame) {
      const guest = guests.get(guestId);
      if (!guest || guest.contents.isDestroyed()) return null;
      if (frame !== generatedFrameOf(guest.contents)) return null;
      return guest.binding;
    },

    terminate(guestId) {
      return end(guestId, 'the renderer asked for it');
    },

    clear() {
      for (const guestId of guests.keys()) forget(guestId);
      for (const key of [...thumbnails.keys()]) releaseThumbnail(key);
      retained.clear();
    },

    /**
     * Releases a kept capture, or settles one in flight. Caller settlement
     * cannot release the deadline of unfinished native work.
     */
    cancelCapture(requestId) {
      if (retained.delete(requestId)) return true;
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
        retain: isRetained,
      } = request;
      const guest = guests.get(guestId);
      const isKit = isKitCapture(guest, canvasId, designId, revisionId);
      const key = isKit ? null : captureKey(canvasId, designId, revisionId);
      if (
        typeof requestId !== 'string' ||
        !IDENTIFIER.test(requestId) ||
        captures.has(requestId) ||
        retained.has(requestId) ||
        typeof isRetained !== 'boolean' ||
        (!isKit && !key) ||
        !guest ||
        guest.capture ||
        guest.contents.isDestroyed() ||
        !captureAvailable() ||
        !Number.isSafeInteger(generation) ||
        generation < 1 ||
        !validSize(width, height, scaleFactor)
      )
        return Promise.resolve(captureFailure());
      if (!fitsCaps(width, height, scaleFactor))
        return Promise.resolve(tooLarge(width, height, scaleFactor));

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
            return guest.contents.executeJavaScript(DISPLAY_SCALE_SCRIPT);
          })
          .then((displayScale) => {
            if (!isCurrent()) return;
            if (!Number.isFinite(displayScale) || displayScale <= 0)
              return complete(captureFailure());
            // A native image over the caps is never made: a Poster at 1x on a
            // 3x display is drawn by Chromium at the asked scale instead.
            if (!fitsCaps(width, height, displayScale))
              return redraw(guest.contents, width, height, scaleFactor / displayScale);
            const rect = { x: 0, y: 0, width, height };
            return guest.contents.capturePage(rect, { stayHidden: true }).then((image) => {
              if (!isCurrent() || !image) return;
              if (image.isEmpty()) return complete(captureFailure());
              return atScale(guest.contents, image.toPNG(), width, height, scaleFactor);
            });
          })
          .then((bytes) => {
            if (!isCurrent() || !bytes) return;
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
              if (key) cache(key, bytes);
              if (isRetained) retain(requestId, bytes);
              complete({ ok: true, mediaType: 'image/png', bytes });
            });
          })
          .catch(() => complete(captureFailure()))
          .finally(finish);
      });
    },

    /** The capture kept for this request, handed over once. */
    takeCapture(requestId) {
      const bytes = retained.get(requestId) ?? null;
      retained.delete(requestId);
      return bytes;
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

function previewBinding(value) {
  if (value?.kind === 'kit') return { kind: 'kit' };
  if (value?.kind !== 'canvas') return null;
  const { canvasId } = value;
  return typeof canvasId === 'string' && IDENTIFIER.test(canvasId)
    ? { kind: 'canvas', canvasId }
    : null;
}

function sameBinding(bound, requested) {
  if (bound.kind === 'kit') return requested.kind === 'kit';
  return requested.kind === 'canvas' && requested.canvasId === bound.canvasId;
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
