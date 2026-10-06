import { useEffect, useMemo, useRef, useState } from 'react';
import { useIsPresent } from 'framer-motion';
import { isDesktop } from '../../lib/desktop';
import { useBrowserSlot } from '../../lib/browserHost';
import {
  onNativeBrowserDesignEvent,
  onNativeBrowserLoadFailed,
  onNativeBrowserLoaded,
  setNativeBrowserDesignState,
  type DesignOverlayTheme,
  type NativeBrowserLoadFailed,
  type NativeBrowserLoaded,
} from '../../lib/nativeBrowser';
import type { BrowserViewport, BrowserViewportMode, DesignReference } from '../../types/bridge';
import type { Size } from './browserGeometry';
import { pageLayout } from './browserViewport';
import { designMarkColor } from './designMarks';

interface NativeBrowserSurfaceProps {
  visibleBrowserSessionId?: string;
  url: string;
  viewport: BrowserViewport;
  viewportMode: BrowserViewportMode;
  designMode: boolean;
  pencilMode: boolean;
  designMarks: readonly DesignReference[];
  expanded?: boolean;
  frameSize: Size;
  onLoaded: (event: NativeBrowserLoaded) => void;
  /** A key meant for the app, pressed while the page has the focus. */
  onDesignKey: (key: 'draw' | 'escape') => void;
  onLoadFailed?: (failure: NativeBrowserLoadFailed) => void;
}

// The pane's slot for the chat's browser page. The page itself lives in the
// Browser host, which lays it over this slot.
export function NativeBrowserSurface({
  visibleBrowserSessionId,
  url,
  viewport,
  viewportMode,
  designMode,
  pencilMode,
  designMarks,
  expanded = false,
  frameSize,
  onLoaded,
  onDesignKey,
  onLoadFailed,
}: NativeBrowserSurfaceProps) {
  const surfaceReady = frameSize.width > 8 && frameSize.height > 8;
  const onLoadedRef = useRef(onLoaded);
  const onDesignKeyRef = useRef(onDesignKey);
  const onLoadFailedRef = useRef(onLoadFailed);
  const native = isDesktop();
  // While the pane animates out, the page must not linger over what replaces it.
  const leaving = !useIsPresent();
  const surface = useMemo(
    () => pageLayout(frameSize, viewport, viewportMode),
    [frameSize, viewport, viewportMode],
  );
  const radius = pageCorners(viewportMode, expanded);
  const anchor = useBrowserSlot(native ? visibleBrowserSessionId : undefined, {
    hidden: leaving || !surfaceReady,
    radius,
    scale: surface.scale,
    url,
    viewportMode,
  });

  useEffect(() => {
    onLoadedRef.current = onLoaded;
    onDesignKeyRef.current = onDesignKey;
    onLoadFailedRef.current = onLoadFailed;
  }, [onDesignKey, onLoadFailed, onLoaded]);

  // The overlay follows the app's theme, which changes by its root's style and
  // class, as AppBlockFrame's Apps do.
  const [theme, setTheme] = useState(designOverlayTheme);
  useEffect(() => {
    if (!designMode) return;
    const sync = () => {
      const next = designOverlayTheme();
      setTheme((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style', 'class'],
    });
    return () => {
      observer.disconnect();
    };
  }, [designMode]);

  useEffect(() => {
    if (!visibleBrowserSessionId) return;
    setNativeBrowserDesignState(visibleBrowserSessionId, {
      designMode,
      pencilMode: designMode && pencilMode,
      scale: surface.scale ?? 1,
      marks: designMarks.map((mark) => ({ id: mark.anchor.id, number: mark.anchor.mark ?? 0 })),
      theme,
    }).catch(() => {});
  }, [designMarks, designMode, pencilMode, surface.scale, theme, visibleBrowserSessionId]);

  useEffect(() => {
    const unsubscribes = [
      // Picks go to their chat through the Browser host.
      onNativeBrowserDesignEvent((event) => {
        if (event.type === 'key' && event.browserSessionId === visibleBrowserSessionId)
          onDesignKeyRef.current(event.key);
      }),
      onNativeBrowserLoaded((event) => {
        if (event.browserSessionId && event.browserSessionId !== visibleBrowserSessionId) return;
        onLoadedRef.current(event);
      }),
      onNativeBrowserLoadFailed((failure) => {
        if (failure.browserSessionId && failure.browserSessionId !== visibleBrowserSessionId)
          return;
        onLoadFailedRef.current?.(failure);
      }),
    ];
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, [visibleBrowserSessionId]);

  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden bg-droid-bg">
      <div
        className={`absolute overflow-hidden bg-white ${
          viewportMode === 'fit' ? '' : 'shadow-droid ring-1 ring-droid-border-hover'
        }`}
        style={{
          borderRadius: radius,
          left: surface.left,
          top: surface.top,
          width: surface.width,
          height: surface.height,
          anchorName: anchor,
        }}
      />
      {!native && (
        <div className="absolute inset-0 flex items-center justify-center px-6 text-sm text-droid-text-muted">
          The Browser runs in the DROIDEX desktop app.
        </div>
      )}
    </div>
  );
}

// A page on Fit fills the pane, its top corners softened under the toolbar
// when docked and square in full screen; a standard size is a card.
function pageCorners(mode: BrowserViewportMode, expanded: boolean): string {
  if (mode !== 'fit') return '8px';
  return expanded ? '0' : '8px 8px 0 0';
}

// The page cannot read the app's CSS, so its design overlay gets the token
// values, its marks in the same colour as their chips in the composer.
function designOverlayTheme(): DesignOverlayTheme {
  const css = getComputedStyle(document.documentElement);
  const token = (name: string) => css.getPropertyValue(name).trim();
  return {
    accent: designMarkColor(),
    onAccent: token('--droid-bg'),
    surface: token('--droid-raised'),
    text: token('--droid-text'),
    muted: token('--droid-text-secondary'),
    border: token('--droid-border'),
    shadow: token('--droid-shadow-sm'),
    font: token('--ui-font-family'),
  };
}
