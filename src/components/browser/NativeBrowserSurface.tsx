import { useEffect, useMemo, useRef } from 'react';
import { useIsPresent } from 'framer-motion';
import { isDesktop } from '../../lib/desktop';
import { useBrowserSlot } from '../../lib/browserHost';
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
import type { BrowserViewport, BrowserViewportMode } from '../../types/bridge';
import type { Size } from './browserGeometry';
import { pageLayout } from './browserViewport';

interface NativeBrowserSurfaceProps {
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
  expanded = false,
  frameSize,
  onLoaded,
  onSelection,
  onPrompt,
  onLoadFailed,
}: NativeBrowserSurfaceProps) {
  const surfaceReady = frameSize.width > 8 && frameSize.height > 8;
  const onLoadedRef = useRef(onLoaded);
  const onSelectionRef = useRef(onSelection);
  const onPromptRef = useRef(onPrompt);
  const onLoadFailedRef = useRef(onLoadFailed);
  const native = isDesktop();
  // While the pane animates out, the page must not linger over what replaces it.
  const leaving = !useIsPresent();
  const surface = useMemo(
    () => pageLayout(frameSize, viewport, viewportMode, expanded),
    [expanded, frameSize, viewport, viewportMode],
  );
  const anchor = useBrowserSlot(native ? visibleBrowserSessionId : undefined, {
    hidden: leaving || !surfaceReady,
    rounded: !expanded,
    scale: surface.scale,
    url,
  });

  useEffect(() => {
    onLoadedRef.current = onLoaded;
    onSelectionRef.current = onSelection;
    onPromptRef.current = onPrompt;
    onLoadFailedRef.current = onLoadFailed;
  }, [onLoadFailed, onLoaded, onPrompt, onSelection]);

  useEffect(() => {
    if (!visibleBrowserSessionId) return;
    Promise.all([
      setNativeBrowserDesignMode(visibleBrowserSessionId, designMode, surface.scale),
      setNativeBrowserPencilMode(visibleBrowserSessionId, designMode && pencilMode),
    ]).catch(() => {});
  }, [designMode, pencilMode, surface.scale, visibleBrowserSessionId]);

  useEffect(() => {
    const unsubscribes = [
      onNativeBrowserSelection((selection) => {
        if (selection.browserSessionId && selection.browserSessionId !== visibleBrowserSessionId)
          return;
        onSelectionRef.current(selection);
      }),
      onNativeBrowserDesignPrompt((prompt) => {
        if (
          prompt.selection.browserSessionId &&
          prompt.selection.browserSessionId !== visibleBrowserSessionId
        )
          return;
        onPromptRef.current(prompt);
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
          expanded ? 'rounded-none' : 'rounded-[6px] shadow-droid ring-1 ring-droid-border-hover'
        }`}
        style={{
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
