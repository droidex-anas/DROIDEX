// What browser_screenshot returns: one image of the viewport, the full page, a
// ref or a region, at one image pixel per CSS pixel unless the long edge would
// pass 1568, with the geometry stated so a point in the image converts
// exactly. Sensitive fields are painted over here, in main, so the page the
// user sees is never touched; the capture fails rather than leak one.

const { settleFrames } = require('./browserFrames.cjs');

const MAX_EDGE = 1568;
const JPEG_QUALITY = 80;
const REF_PADDING = 8;
const MASK_PADDING = 2;
// Opaque mid grey, in the bitmap's BGRA order.
const MASK_PIXEL = Buffer.from([0x80, 0x80, 0x80, 0xff]);

function createBrowserScreenshot({ reading, nativeImage, redactUrl }) {
  async function take(contents, entry, options = {}) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const shot = await reading.withPage(contents, (dbg) =>
        attemptShot(dbg, contents, entry, options),
      );
      if (shot) return shot;
    }
    throw new Error('The page kept changing while it was captured; no screenshot was taken.');
  }

  // Undefined when the page moved, navigated or changed its fields between
  // the mask and the capture.
  async function attemptShot(dbg, contents, entry, options) {
    const box = options.ref ? await reading.refBox(dbg, entry, options.ref) : undefined;
    if (box) await settleFrames(dbg, box.sessionId);
    const view = await viewOf(dbg);
    const clip = clipFor(view, options, box);
    const masks = await masksFor(dbg, contents, view, options);
    const scale = Math.min(1, MAX_EDGE / Math.max(clip.width, clip.height));
    let image = await capture(dbg, contents, view, clip, scale, options);
    const after = await viewOf(dbg);
    if (after.key !== view.key) return undefined;
    if (JSON.stringify(await masksFor(dbg, contents, after, options)) !== JSON.stringify(masks))
      return undefined;
    if (masks.length) image = paint(nativeImage, image, masks, clip, scale);
    const png = options.format === 'png';
    const { width, height } = image.getSize();
    return {
      image: (png ? image.toPNG() : image.toJPEG(JPEG_QUALITY)).toString('base64'),
      mimeType: png ? 'image/png' : 'image/jpeg',
      text: `${geometry(options, clip, scale, view, width, height)}\n${footer(contents)}`,
    };
  }

  // The full page goes through CDP, which renders beyond the viewport; the
  // viewport and crops are copied from what is already composited.
  async function capture(dbg, contents, view, clip, scale, options) {
    if (options.fullPage) {
      const { data } = await dbg.sendCommand('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
        clip: { ...clip, scale: scale / view.dpr },
      });
      return nativeImage.createFromBuffer(Buffer.from(data, 'base64'));
    }
    const captured = await contents.capturePage(clip);
    if (captured.isEmpty()) throw new Error('The browser page has nothing to capture yet.');
    return captured.resize({
      width: Math.max(1, Math.round(clip.width * scale)),
      height: Math.max(1, Math.round(clip.height * scale)),
      quality: 'good',
    });
  }

  async function masksFor(dbg, contents, view, options) {
    const boxes = await reading.sensitiveBoxes(dbg, contents.getURL());
    // Full-page clips are in page coordinates; the boxes are in the viewport's.
    const shift = options.fullPage ? { x: view.pageX, y: view.pageY } : { x: 0, y: 0 };
    return boxes.map((box) => ({
      x: Math.round(box.x + shift.x - MASK_PADDING),
      y: Math.round(box.y + shift.y - MASK_PADDING),
      width: Math.round(box.width + MASK_PADDING * 2),
      height: Math.round(box.height + MASK_PADDING * 2),
    }));
  }

  function footer(contents) {
    return `[${contents.getTitle() || 'Untitled'} · ${redactUrl(contents.getURL())}]`;
  }

  return { take };
}

async function viewOf(dbg) {
  const metrics = await dbg.sendCommand('Page.getLayoutMetrics');
  const css = metrics.cssVisualViewport;
  const { frameTree } = await dbg.sendCommand('Page.getFrameTree');
  return {
    width: Math.floor(css.clientWidth),
    height: Math.floor(css.clientHeight),
    pageX: css.pageX,
    pageY: css.pageY,
    dpr: metrics.visualViewport.clientWidth / css.clientWidth || 1,
    contentWidth: Math.ceil(metrics.cssContentSize.width),
    contentHeight: Math.ceil(metrics.cssContentSize.height),
    key: `${frameTree.frame.loaderId}:${css.pageX}:${css.pageY}:${css.clientWidth}:${css.clientHeight}`,
  };
}

// The captured rectangle in CSS pixels: the viewport, the page, or a crop of
// the viewport, rounded out to whole pixels.
function clipFor(view, options, box) {
  if (options.fullPage) return { x: 0, y: 0, width: view.contentWidth, height: view.contentHeight };
  const wanted = box
    ? {
        x: box.x - REF_PADDING,
        y: box.y - REF_PADDING,
        width: box.width + REF_PADDING * 2,
        height: box.height + REF_PADDING * 2,
      }
    : (options.region ?? { x: 0, y: 0, width: view.width, height: view.height });
  const x = Math.max(0, Math.floor(wanted.x));
  const y = Math.max(0, Math.floor(wanted.y));
  const right = Math.min(view.width, Math.ceil(wanted.x + wanted.width));
  const bottom = Math.min(view.height, Math.ceil(wanted.y + wanted.height));
  if (right - x < 1 || bottom - y < 1)
    throw new Error('That region is outside the visible page; scroll to it or pass a ref.');
  return { x, y, width: right - x, height: bottom - y };
}

// Fills each mask with flat grey in the image's own pixels.
function paint(nativeImage, image, masks, clip, scale) {
  const { width, height } = image.getSize();
  const pixels = image.toBitmap();
  for (const mask of masks) {
    const left = Math.max(0, Math.floor((mask.x - clip.x) * scale));
    const top = Math.max(0, Math.floor((mask.y - clip.y) * scale));
    const right = Math.min(width, Math.ceil((mask.x + mask.width - clip.x) * scale));
    const bottom = Math.min(height, Math.ceil((mask.y + mask.height - clip.y) * scale));
    for (let row = top; row < bottom; row++) {
      const start = (row * width + left) * 4;
      if (right > left) pixels.fill(MASK_PIXEL, start, start + (right - left) * 4);
    }
  }
  return nativeImage.createFromBitmap(pixels, { width, height });
}

function geometry(options, clip, scale, view, width, height) {
  const what = options.fullPage
    ? 'the full page'
    : options.ref
      ? options.ref
      : options.region
        ? 'a region'
        : 'the viewport';
  const ratio = Number(scale.toFixed(4));
  const origin = clip.x || clip.y ? `(${clip.x}, ${clip.y}) + ` : '';
  const convert =
    ratio === 1 && !origin
      ? '1 image px per CSS px'
      : `CSS point = ${origin}image point${ratio === 1 ? '' : ` ÷ ${ratio}`}`;
  return `Screenshot of ${what}: ${width}×${height} px for ${clip.width}×${clip.height} CSS px at (${clip.x}, ${clip.y}); ${convert}. Viewport ${view.width}×${view.height} CSS px.`;
}

module.exports = { createBrowserScreenshot };
