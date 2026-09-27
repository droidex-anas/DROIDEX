// The document that runs inside an App frame: the sandboxed HTML shell, its
// content policy, the host-facing style reset, and the bootstrap script that
// speaks the bridge protocol. The host side of that protocol lives in
// appBlockRuntime.
import { DEFAULT_APP_THEME, MAX_APP_ERROR_CHARS, type AppBlockTheme } from './appBlockRuntime';

export function createAppDocument(
  source: string,
  instanceId: string,
  theme: AppBlockTheme = DEFAULT_APP_THEME,
  bridgeToken = instanceId,
): string {
  const serializedId = JSON.stringify(instanceId).replaceAll('<', '\\u003c');
  const serializedBridgeToken = JSON.stringify(bridgeToken).replaceAll('<', '\\u003c');
  const componentCdns = 'https://cdn.jsdelivr.net https://cdnjs.cloudflare.com';
  const contentSecurityPolicy = [
    "default-src 'none'",
    `script-src 'unsafe-inline' ${componentCdns}`,
    `style-src 'unsafe-inline' https://fonts.googleapis.com ${componentCdns}`,
    `font-src data: https://fonts.gstatic.com ${componentCdns}`,
    `img-src data: blob: ${componentCdns}`,
    'media-src data: blob:',
    // Some components fetch icons or other assets from their own CDN.
    `connect-src ${componentCdns}`,
    "worker-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy}">
<style>
:root {
  color-scheme: ${theme.colorScheme};
  --app-background: ${theme.background};
  --app-surface: ${theme.surface};
  --app-foreground: ${theme.foreground};
  --app-muted: ${theme.muted};
  --app-border: ${theme.border};
  --app-accent: ${theme.accent};
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
html, body { margin: 0; min-width: 0; background: transparent; }
body { box-sizing: border-box; padding: 0; color: var(--app-foreground); overflow-wrap: anywhere; }
*, *::before, *::after { box-sizing: inherit; }
img, svg, canvas, video { display: block; max-width: 100%; height: auto; }
:where(pre) { max-width: 100%; overflow-x: auto; }
:where([data-droidex-app-root]) { border-radius: 12px; }
:where(canvas[data-droidex-managed-canvas]) { width: 100%; }
a { color: var(--app-accent); }
button, input, select, textarea {
  border: 1px solid var(--app-border);
  border-radius: 8px;
  background: var(--app-surface);
  color: var(--app-foreground);
  font: inherit;
}
::selection { background: color-mix(in srgb, var(--app-accent) 24%, transparent); }
</style>
<script>
(() => {
  const instanceId = ${serializedId};
  const bridgeToken = ${serializedBridgeToken};
  let currentTheme = Object.freeze(${JSON.stringify(theme).replaceAll('<', '\\u003c')});
  const themeColors = ['background', 'surface', 'foreground', 'muted', 'border', 'accent'];
  const updateTheme = (theme) => {
    if (!theme || !['light', 'dark'].includes(theme.colorScheme) ||
      !themeColors.every((key) => typeof theme[key] === 'string' && CSS.supports('color', theme[key]))) return;
    currentTheme = Object.freeze(Object.fromEntries(
      ['colorScheme', ...themeColors].map((key) => [key, theme[key]])
    ));
    const style = document.documentElement.style;
    style.colorScheme = currentTheme.colorScheme;
    for (const key of themeColors) style.setProperty('--app-' + key, currentTheme[key]);
    window.dispatchEvent(new CustomEvent('droidex:themechange', { detail: currentTheme }));
    reportHeight();
  };
  const createCanvas = (target, draw) => {
    const canvas = typeof target === 'string' ? document.querySelector(target) : target;
    if (!(canvas instanceof HTMLCanvasElement) || typeof draw !== 'function') {
      throw new TypeError('createCanvas requires a canvas and a draw callback.');
    }
    const context = canvas.getContext('2d');
    if (!context) throw new Error('A 2D canvas context is unavailable.');
    canvas.setAttribute('data-droidex-managed-canvas', '');
    // Preserve the CSS box's ratio before bitmap dimensions change for HiDPI.
    if (getComputedStyle(canvas).aspectRatio.startsWith('auto')) {
      canvas.style.aspectRatio = String((canvas.width || 300) / (canvas.height || 150));
    }
    let stopped = false;
    let timer = 0;
    const redraw = () => {
      if (stopped) return;
      if (timer) clearTimeout(timer);
      timer = 0;
      const style = getComputedStyle(canvas);
      const width = Math.max(0, canvas.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight));
      const height = Math.max(0, canvas.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom));
      if (!width || !height) return;
      const pixelRatio = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.save();
      try {
        draw({ context, width, height, pixelRatio, theme: currentTheme });
      } finally {
        context.restore();
      }
    };
    const schedule = () => {
      if (!stopped && !timer) timer = setTimeout(redraw);
    };
    const observer = new ResizeObserver(schedule);
    const dispose = () => {
      if (stopped) return;
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = 0;
      observer.disconnect();
      window.removeEventListener('droidex:themechange', schedule);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('pagehide', dispose);
    };
    observer.observe(canvas);
    window.addEventListener('droidex:themechange', schedule);
    window.addEventListener('resize', schedule);
    window.addEventListener('pagehide', dispose, { once: true });
    try {
      redraw();
    } catch (error) {
      dispose();
      throw error;
    }
    return { redraw, dispose };
  };
  const pendingMath = new Map();
  let mathSequence = 0;
  let heightTimer = 0;
  let lastHeight = -1;
  let lastError = '';
  let initialRenderComplete = false;
  let disposed = false;
  const postError = (message) => {
    const reported = typeof message === 'string' ? message.trim() : '';
    const normalized = (reported || 'The interactive App failed to start.').slice(0, ${String(MAX_APP_ERROR_CHARS)});
    if (normalized === lastError) return;
    lastError = normalized;
    parent.postMessage({
      type: 'droidex:app-error',
      instanceId,
      bridgeToken,
      message: normalized,
    }, '*');
  };
  const onRuntimeError = (event) => {
    postError(event?.message || 'The interactive App failed to start.');
  };
  const onUnhandledRejection = (event) => {
    const reason = event?.reason;
    const message = reason && typeof reason === 'object' && 'message' in reason
      ? String(reason.message)
      : String(reason || '');
    postError(message);
  };
  addEventListener('error', onRuntimeError);
  addEventListener('unhandledrejection', onUnhandledRejection);
  // The host shows a started App at its first reported height, so that report
  // has to describe the finished layout: math is rendered by the host and lands
  // later, and nothing is worth reporting once the document is going away.
  // Reports coalesce on a timer, never an animation frame: the frame is hidden
  // until this first report arrives, and a hidden frame runs no animation
  // frames, so rAF would deadlock the report that reveals it.
  // The root element always fills the frame viewport, so its scrollHeight can
  // never fall below the height the host already applied. Measuring it turns
  // every report into a ratchet: compact content is padded out to the default
  // height and an App that shrinks keeps its taller frame forever. The body
  // content height is the real measurement; the root is only the fallback for a
  // document whose body reports nothing.
  const measureHeight = () => {
    const content = document.body?.scrollHeight ?? 0;
    return content > 0 ? content : document.documentElement.scrollHeight;
  };
  // Fixed-size SVG without a viewBox is cropped, not scaled, when the frame is
  // narrower than its width attribute. A viewBox matching those attributes
  // draws identically at full size; it follows later attribute changes.
  const makeSvgScalable = () => {
    const unscalable = 'svg:not(svg svg):not([viewBox]), svg[data-droidex-viewbox]';
    for (const svg of document.querySelectorAll(unscalable)) {
      const width = Number(svg.getAttribute('width'));
      const height = Number(svg.getAttribute('height'));
      const viewBox = '0 0 ' + width + ' ' + height;
      if (!(width > 0 && height > 0) || svg.getAttribute('viewBox') === viewBox) continue;
      svg.setAttribute('viewBox', viewBox);
      svg.setAttribute('data-droidex-viewbox', '');
    }
  };
  // Content wider than the frame is scaled down to fit instead of being clipped
  // by the host's overflow lock. Past the smallest legible scale the frame
  // scrolls sideways instead of shrinking text further.
  const minimumFitScale = 0.7;
  let appRoot = null;
  const fitToWidth = () => {
    makeSvgScalable();
    if (!appRoot) return;
    appRoot.style.removeProperty('zoom');
    const available = document.documentElement.clientWidth;
    const natural = appRoot.scrollWidth;
    const scale = natural > available + 1 ? Math.max(minimumFitScale, available / natural) : 1;
    if (scale < 1) appRoot.style.setProperty('zoom', String(scale), 'important');
    document.documentElement.toggleAttribute('data-droidex-scroll-x', natural * scale > available + 1);
  };
  const reportHeight = () => {
    if (!initialRenderComplete || disposed || heightTimer) return;
    heightTimer = setTimeout(() => {
      heightTimer = 0;
      fitToWidth();
      const height = measureHeight();
      if (height === lastHeight) return;
      lastHeight = height;
      parent.postMessage({ type: 'droidex:app-height', instanceId, bridgeToken, height }, '*');
    });
  };
  let resolveMathReady;
  const mathReady = new Promise((resolve) => { resolveMathReady = resolve; });
  const renderMath = async (target, latex, options = {}) => {
    const element = typeof target === 'string' ? document.querySelector(target) : target;
    if (!(element instanceof Element) || typeof latex !== 'string') return false;
    // Inline scripts can request math before the host accepts document work.
    await mathReady;
    if (disposed) return false;
    const requestId = instanceId + '-math-' + String(++mathSequence);
    return new Promise((resolve) => {
      pendingMath.set(requestId, { element, resolve });
      parent.postMessage({
        type: 'droidex:render-math',
        instanceId,
        bridgeToken,
        requestId,
        latex,
        displayMode: options.displayMode === true || element.hasAttribute('data-display'),
      }, '*');
    });
  };
  const renderAllMath = (root = document) => Promise.all(
    [...root.querySelectorAll('[data-latex]')].map((element) =>
      renderMath(element, element.getAttribute('data-latex') ?? '')
    )
  );
  const postReady = () => {
    parent.postMessage({ type: 'droidex:app-ready', instanceId, bridgeToken }, '*');
    resolveMathReady();
  };
  const onHostMessage = (event) => {
    const data = event.data;
    if (
      event.source !== parent ||
      !data ||
      data.instanceId !== instanceId ||
      data.bridgeToken !== bridgeToken
    ) return;
    if (data.type === 'droidex:theme-update') {
      updateTheme(data.theme);
      return;
    }
    if (data.type === 'droidex:host-ready') {
      postReady();
      return;
    }
    if (data.type !== 'droidex:math-rendered' || typeof data.requestId !== 'string') return;
    const pending = pendingMath.get(data.requestId);
    if (!pending) return;
    pendingMath.delete(data.requestId);
    if (typeof data.html === 'string') {
      pending.element.innerHTML = data.html;
      pending.resolve(true);
    } else {
      pending.element.textContent = 'Unable to render this expression.';
      pending.resolve(false);
    }
    reportHeight();
  };
  addEventListener('message', onHostMessage);
  window.droidex = Object.freeze({
    renderMath, renderAllMath, createCanvas,
    get theme() { return currentTheme; },
  });
  addEventListener('DOMContentLoaded', () => {
    const root = document.querySelector('[data-droidex-app-root]') ??
      [...document.body.children].find((element) => !['SCRIPT', 'STYLE'].includes(element.tagName));
    root?.setAttribute('data-droidex-app-root', '');
    appRoot = root ?? null;
    postReady();
    // Registered after the App's own scripts ran, so an Escape the App handles
    // (closing its own menu, say) is already default-prevented here.
    const onKeyDown = (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      parent.postMessage({ type: 'droidex:escape', instanceId, bridgeToken }, '*');
    };
    addEventListener('keydown', onKeyDown);
    const observer = new ResizeObserver(reportHeight);
    observer.observe(document.body);
    if (root && root !== document.body) observer.observe(root);
    void renderAllMath().finally(() => {
      initialRenderComplete = true;
      reportHeight();
    });
    addEventListener('pagehide', () => {
      disposed = true;
      if (heightTimer) clearTimeout(heightTimer);
      observer.disconnect();
      removeEventListener('keydown', onKeyDown);
      removeEventListener('message', onHostMessage);
      removeEventListener('error', onRuntimeError);
      removeEventListener('unhandledrejection', onUnhandledRejection);
      for (const pending of pendingMath.values()) pending.resolve(false);
      pendingMath.clear();
    }, { once: true });
  }, { once: true });
})();
</script>
</head>
<body>
${source}
<style data-droidex-app-host>
html, body {
  overflow: hidden !important;
  height: auto !important;
  margin: 0 !important;
  padding: 0 !important;
  background: transparent !important;
}
body { min-height: 0 !important; }
html[data-droidex-scroll-x] body { overflow-x: auto !important; }
[data-droidex-app-root] {
  width: 100% !important;
  max-width: none !important;
}
</style>
</body>
</html>`;
}
