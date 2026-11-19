const path = require('node:path');
const localImages = require('./localImages.cjs');
const favicons = require('./favicons.cjs');
const canvasPreview = require('./canvasPreview.cjs');
const canvasPreviewSession = require('./canvasPreviewSession.cjs');
const { mayRequestPreviewAsset, readCanvasPreviewAsset } = require('./canvasPreviewAssets.cjs');

function previewGuestSession(session) {
  return session.fromPartition(canvasPreviewSession.CANVAS_PREVIEW_PARTITION);
}

function kitStoreRoot(app) {
  return path.join(app.getPath('userData'), 'canvases', 'design-systems');
}

function createAppProtocols({ app, session, sidecarSupervisor, canvasPreviewHosts }) {
  function registerLocalImageProtocol() {
    session.defaultSession.protocol.handle(localImages.LOCAL_IMAGE_SCHEME, async (request) => {
      try {
        const filePath = localImages.localImageRequestPath(request.url);
        const { mime, data } = await localImages.readLocalImage(filePath);
        // no-store: an attachment path can be rewritten in place by a crop, and a
        // cached body would keep showing the superseded pixels.
        // The scheme is fetchable and serves image/svg+xml, so the response denies
        // every subresource and script: an SVG is inert in an <img>, but this keeps
        // it inert if a body is ever navigated to or embedded directly. nosniff
        // stops Chromium from re-typing a body as something executable.
        return new Response(data, {
          headers: {
            'content-type': mime,
            'cache-control': 'no-store',
            'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
            'x-content-type-options': 'nosniff',
          },
        });
      } catch (error) {
        // The renderer degrades to an "image unavailable" chip; the reason is only
        // useful when debugging, so keep it out of the UI and in the log.
        console.warn('Could not serve local image %s:', request.url, error);
        return new Response('Image unavailable', { status: 404 });
      }
    });
  }
  function registerFaviconProtocol() {
    const store = favicons.createFaviconStore({
      cacheDir: path.join(app.getPath('userData'), 'favicons'),
      userAgent: session.defaultSession.getUserAgent(),
      logError: (message) => console.warn('[favicon] %s', message),
    });
    session.defaultSession.protocol.handle(favicons.FAVICON_SCHEME, async (request) => {
      try {
        const icon = await store.load(favicons.faviconRequestTarget(request.url));
        if (!icon) return new Response('No icon', { status: 404 });
        // The same inert-body headers as local images: a third-party SVG stays an
        // image even if something navigates to it directly.
        return new Response(icon.data, {
          headers: {
            'content-type': icon.mime,
            'cache-control': 'max-age=86400',
            'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
            'x-content-type-options': 'nosniff',
          },
        });
      } catch {
        console.warn('Could not serve icon: invalid request or unavailable image');
        return new Response('Icon unavailable', { status: 404 });
      }
    });
  }
  function registerCanvasPreviewProtocol() {
    const document = canvasPreview.canvasPreviewDocument();
    const assetRequest = /^droidex-canvas-preview:\/\/preview\/(?:asset|kit-asset|font)\//;
    const serve = async (request) => {
      if (assetRequest.test(request.url)) {
        const asset = await readCanvasPreviewAsset(request.url, {
          canvasRoot: path.join(app.getPath('userData'), 'canvases'),
          kitRoot: kitStoreRoot(app),
          fontRoot: path.join(app.getPath('userData'), 'canvas-fonts'),
          secret: sidecarSupervisor.canvasAssetSecret(),
        });
        if (!asset) return new Response('Not found', { status: 404 });
        // The inert-body policy local images use: a sanitised SVG stays an image
        // even if something navigates to it or embeds it directly.
        return new Response(asset.data, {
          headers: {
            'content-type': asset.mime,
            'cache-control':
              asset.mime === 'font/woff2' ? 'public, max-age=31536000, immutable' : 'no-store',
            'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
            'x-content-type-options': 'nosniff',
            ...(asset.mime === 'font/woff2' ? { 'access-control-allow-origin': '*' } : {}),
          },
        });
      }
      if (request.url === 'droidex-canvas-preview://preview/not-found')
        return new Response('Not found', { status: 404 });
      if (request.url !== canvasPreview.CANVAS_PREVIEW_URL) {
        console.warn('Refused a Canvas preview request for %s', request.url);
        return new Response('Forbidden', {
          status: 403,
          headers: { 'content-type': 'text/plain' },
        });
      }
      return new Response(document, {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'content-security-policy': canvasPreview.CANVAS_PREVIEW_CSP,
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        },
      });
    };
    // The default session can load the owned document for a failed attachment,
    // but it has no bound frame and may never read an asset.
    session.defaultSession.protocol.handle(canvasPreview.CANVAS_PREVIEW_SCHEME, (request) => {
      if (assetRequest.test(request.url)) return new Response('Not found', { status: 404 });
      return serve(request);
    });
    const guestSession = previewGuestSession(session);
    guestSession.webRequest.onBeforeRequest(
      { urls: ['droidex-canvas-preview://preview/*'] },
      (details, callback) => {
        if (!assetRequest.test(details.url)) return callback({});
        const binding = canvasPreviewHosts.bindingForFrame(details.webContentsId, details.frame);
        if (mayRequestPreviewAsset(binding, details.url)) return callback({});
        callback({ redirectURL: 'droidex-canvas-preview://preview/not-found' });
      },
    );
    return canvasPreviewSession.configureCanvasPreviewSession(guestSession, serve);
  }
  return { registerLocalImageProtocol, registerFaviconProtocol, registerCanvasPreviewProtocol };
}

module.exports = { createAppProtocols, previewGuestSession, kitStoreRoot };
