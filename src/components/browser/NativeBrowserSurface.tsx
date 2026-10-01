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
  onViewportSizeChange: (size: Size) => void;
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
  onViewportSizeChange,
}: NativeBrowserSurfaceProps) {
  const surfaceReady = frameSize.width > 8 && frameSize.height > 8;
  const onLoadedRef = useRef(onLoaded);
  const onSelectionRef = useRef(onSelection);
  const onPromptRef = useRef(onPrompt);
  const onLoadFailedRef = useRef(onLoadFailed);
  const native = isDesktop();
  // While the pane animates out, the page must not linger over what replaces it.
  const leaving = !useIsPresent();
  const anchor = useBrowserSlot(native ? visibleBrowserSessionId : undefined, {
    hidden: leaving || !surfaceReady,
    rounded: !expanded,
    url,
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
