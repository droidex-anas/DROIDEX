import { useEffect, useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import { useIsPresent } from 'framer-motion';
import { isDesktop } from '../../lib/desktop';
import { useBrowserSlot } from '../../lib/browserHost';
import {
  attachIframeDesignMode,
  clickIframe,
  hoverIframe,
  keypressIframe,
  scrollIframe,
  selectOptionIframe,
  snapshotIframe,
  typeIntoIframe,
} from '../../lib/iframeDesignMode';
import {
  onNativeBrowserDesignPrompt,
  onNativeBrowserLoadFailed,
  onNativeBrowserLoaded,
  onNativeBrowserSelection,
  setNativeBrowserDesignMode,
  setNativeBrowserPencilMode,
  type NativeBrowserDesignPrompt,
  type NativeBrowserLoadFailed,
  type NativeBrowserLoaded,
  type NativeBrowserSelection,
} from '../../lib/nativeBrowser';
import { registerNativeBrowserController } from '../../lib/nativeBrowserAgent';
import type {
  BrowserNativeRequest,
  BrowserNativeResult,
  BrowserViewport,
  BrowserViewportMode,
} from '../../types/bridge';
import type { Size } from './browserGeometry';

interface NativeBrowserSurfaceProps {
  browserKey: string;
  visibleBrowserSessionId?: string;
  url: string;
  viewport: BrowserViewport;
  viewportMode: BrowserViewportMode;
  designMode: boolean;
  pencilMode: boolean;
  expanded?: boolean;
  frameSize: Size;
  onLoaded: (event: NativeBrowserLoaded) => void;
  onSelection: (selection: NativeBrowserSelection) => void;
  onPrompt: (prompt: NativeBrowserDesignPrompt) => void;
  onLoadFailed?: (failure: NativeBrowserLoadFailed) => void;
  onViewportSizeChange: (size: Size) => void;
}

// The pane's slot for the chat's browser page. In the desktop app the page
// itself lives in the Browser host, which lays it over this slot; outside it
// (the web build) the slot holds an iframe.
export function NativeBrowserSurface({
  browserKey,
  visibleBrowserSessionId,
  url,
  viewport,
  viewportMode,
  designMode,
  pencilMode,
  expanded = false,
  frameSize,
  onLoaded,
  onSelection,
  onPrompt,
  onLoadFailed,
  onViewportSizeChange,
}: NativeBrowserSurfaceProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const surfaceReady = frameSize.width > 8 && frameSize.height > 8;
  const onLoadedRef = useRef(onLoaded);
  const onSelectionRef = useRef(onSelection);
  const onPromptRef = useRef(onPrompt);
  const onLoadFailedRef = useRef(onLoadFailed);
  const urlRef = useRef(url);
  urlRef.current = url;
  const native = isDesktop();
  // While the pane animates out, the page must not linger over what replaces it.
  const leaving = !useIsPresent();
  const anchor = useBrowserSlot(native ? visibleBrowserSessionId : undefined, {
    hidden: leaving || !surfaceReady,
    rounded: !expanded,
  });
  const surface = useMemo(
    () => surfaceLayout(frameSize, viewport, viewportMode, expanded),
    [expanded, frameSize, viewport, viewportMode],
  );

  useEffect(() => {
    onLoadedRef.current = onLoaded;
    onSelectionRef.current = onSelection;
    onPromptRef.current = onPrompt;
    onLoadFailedRef.current = onLoadFailed;
  }, [onLoadFailed, onLoaded, onPrompt, onSelection]);

  useEffect(() => {
    onViewportSizeChange({ width: Math.round(surface.width), height: Math.round(surface.height) });
  }, [onViewportSizeChange, surface.height, surface.width]);

  useEffect(() => {
    if (!visibleBrowserSessionId) return;
    Promise.all([
      setNativeBrowserDesignMode(visibleBrowserSessionId, designMode),
      setNativeBrowserPencilMode(visibleBrowserSessionId, designMode && pencilMode),
    ]).catch(() => {});
  }, [designMode, pencilMode, visibleBrowserSessionId]);

  useEffect(() => {
    let disposed = false;
    const unlisteners: (() => void)[] = [];
    const track = (promise: Promise<() => void>) => {
      void promise.then((unlisten) => {
        if (disposed) {
          unlisten();
          return;
        }
        unlisteners.push(unlisten);
      });
    };

    track(
      onNativeBrowserSelection((selection) => {
        if (selection.browserSessionId && selection.browserSessionId !== visibleBrowserSessionId)
          return;
        onSelectionRef.current(selection);
      }),
    );
    track(
      onNativeBrowserDesignPrompt((prompt) => {
        if (
          prompt.selection.browserSessionId &&
          prompt.selection.browserSessionId !== visibleBrowserSessionId
        )
          return;
        onPromptRef.current(prompt);
      }),
    );
    track(
      onNativeBrowserLoaded((event) => {
        if (event.browserSessionId && event.browserSessionId !== visibleBrowserSessionId) return;
        onLoadedRef.current(event);
      }),
    );
    track(
      onNativeBrowserLoadFailed((failure) => {
        if (failure.browserSessionId && failure.browserSessionId !== visibleBrowserSessionId)
          return;
        onLoadFailedRef.current?.(failure);
      }),
    );

    return () => {
      disposed = true;
      unlisteners.forEach((unlisten) => { unlisten(); });
    };
  }, [visibleBrowserSessionId]);

  useEffect(() => {
    if (native) return;
    const iframe = iframeRef.current;
    if (!iframe) return;
    let detachDesignMode = () => {};
    const attach = () => {
      detachDesignMode();
      try {
        detachDesignMode = attachIframeDesignMode(iframe, {
          designMode,
          pencilMode,
          onSelection: (selection) => { onSelectionRef.current(selection); },
        });
        onLoadedRef.current({
          browserSessionId: visibleBrowserSessionId ?? browserKey,
          url: readIframeUrl(iframe) ?? url,
        });
      } catch {
        detachDesignMode = () => {};
      }
    };
    attach();
    iframe.addEventListener('load', attach);
    return () => {
      iframe.removeEventListener('load', attach);
      detachDesignMode();
    };
  }, [browserKey, designMode, native, pencilMode, url, visibleBrowserSessionId]);

  useEffect(() => {
    if (native) return;
    return registerNativeBrowserController({
      perform: (request) =>
        performIframeRequest(request, {
          currentUrl: urlRef.current,
          iframe: iframeRef,
          onLoaded: (url) =>
            { onLoadedRef.current({ browserSessionId: request.browserSessionId, url }); },
        }),
    });
  }, [native]);

  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden bg-droid-bg">
      <div
        className={`absolute overflow-hidden bg-white ${
          expanded ? 'rounded-none' : 'rounded-[6px] shadow-droid ring-1 ring-droid-border-hover'
        }`}
        style={{
          left: surface.left,
          top: surface.top,
          width: surface.width,
          height: surface.height,
          anchorName: anchor,
        }}
      >
        {!native && (
          <iframe
            ref={iframeRef}
            src={url}
            title="Browser"
            className="h-full w-full border-0 bg-white"
            sandbox="allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts"
          />
        )}
      </div>
    </div>
  );
}

function readIframeUrl(iframe: HTMLIFrameElement): string | undefined {
  try {
    return iframe.contentWindow?.location.href;
  } catch {
    return undefined;
  }
}

async function performIframeRequest(
  request: BrowserNativeRequest,
  options: {
    currentUrl: string;
    iframe: RefObject<HTMLIFrameElement | null>;
    onLoaded: (url: string) => void;
  },
): Promise<BrowserNativeResult> {
  try {
    const iframe = options.iframe.current;
    if (!iframe) throw new Error('The browser pane is not open yet.');
    if (request.action === 'close') {
      iframe.src = 'about:blank';
      options.onLoaded('about:blank');
      return {
        requestId: request.requestId,
        appSessionId: request.appSessionId,
        browserSessionId: request.browserSessionId,
        ok: true,
      };
    }
    if (request.action === 'open') {
      const targetUrl = request.url ?? options.currentUrl;
      await loadIframe(iframe, targetUrl);
      options.onLoaded(readIframeUrl(iframe) ?? targetUrl);
      return {
        requestId: request.requestId,
        appSessionId: request.appSessionId,
        browserSessionId: request.browserSessionId,
        ok: true,
        snapshot: safeIframeSnapshot(iframe, targetUrl),
      };
    }
    if (request.action === 'reload') {
      await loadIframe(iframe, readIframeUrl(iframe) ?? options.currentUrl);
      options.onLoaded(readIframeUrl(iframe) ?? options.currentUrl);
      return {
        requestId: request.requestId,
        appSessionId: request.appSessionId,
        browserSessionId: request.browserSessionId,
        ok: true,
        snapshot: safeIframeSnapshot(iframe, options.currentUrl),
      };
    }
    if (request.action === 'click') {
      await clickIframe(iframe, Number(request.x), Number(request.y));
    } else if (request.action === 'hover') {
      await hoverIframe(iframe, Number(request.x), Number(request.y), request.selector);
    } else if (request.action === 'selectOption') {
      if (!request.selector) throw new Error('A selector is required to select an option.');
      await selectOptionIframe(iframe, request.selector, request.text ?? '');
    } else if (request.action === 'type') {
      await typeIntoIframe(iframe, request.text ?? '');
    } else if (request.action === 'keypress') {
      await keypressIframe(iframe, request.key ?? '');
    } else if (request.action === 'scroll') {
      await scrollIframe(iframe, request.direction ?? 'down', request.pixels);
    } else if (request.action === 'capture') {
      return {
        requestId: request.requestId,
        appSessionId: request.appSessionId,
        browserSessionId: request.browserSessionId,
        ok: true,
      };
    } else if (request.action !== 'snapshot') {
      throw new Error(`Unsupported browser action: ${request.action}`);
    }
    await settleFrame();
    return {
      requestId: request.requestId,
      appSessionId: request.appSessionId,
      browserSessionId: request.browserSessionId,
      ok: true,
      snapshot: safeIframeSnapshot(iframe, options.currentUrl),
    };
  } catch (err) {
    return {
      requestId: request.requestId,
      appSessionId: request.appSessionId,
      browserSessionId: request.browserSessionId,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function loadIframe(iframe: HTMLIFrameElement, url: string): Promise<void> {
  return new Promise((resolve) => {
    const targetUrl = absolutizeUrl(url);
    const startedAt = Date.now();
    iframe.src = url;
    const poll = () => {
      if (!iframe.isConnected) {
        resolve();
        return;
      }
      const currentUrl = readIframeUrl(iframe);
      if (currentUrl && currentUrl === targetUrl) {
        resolve();
        return;
      }
      if (Date.now() - startedAt > 5_000) {
        resolve();
        return;
      }
      window.setTimeout(poll, 50);
    };
    poll();
  });
}

function absolutizeUrl(url: string): string {
  try {
    return new URL(url, window.location.href).href;
  } catch {
    return url;
  }
}

function safeIframeSnapshot(iframe: HTMLIFrameElement, fallbackUrl: string) {
  try {
    return snapshotIframe(iframe, fallbackUrl);
  } catch {
    return { url: readIframeUrl(iframe) ?? fallbackUrl, scroll: { x: 0, y: 0 }, refs: [] };
  }
}

function settleFrame(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => { resolve(); })),
  );
}

function surfaceLayout(
  frame: Size,
  viewport: BrowserViewport,
  mode: BrowserViewportMode,
  expanded = false,
) {
  if (expanded && mode === 'fit') {
    return {
      width: Math.max(1, Math.round(frame.width)),
      height: Math.max(1, Math.round(frame.height)),
      left: 0,
      top: 0,
    };
  }
  const padding = 18;
  const availableWidth = Math.max(1, frame.width - padding * 2);
  const availableHeight = Math.max(1, frame.height - padding * 2);
  const width = mode === 'fit' ? availableWidth : Math.min(viewport.width, availableWidth);
  const height = mode === 'fit' ? availableHeight : Math.min(viewport.height, availableHeight);
  return {
    width: Math.round(width),
    height: Math.round(height),
    left: Math.round((frame.width - width) / 2),
    top: Math.round((frame.height - height) / 2),
  };
}
