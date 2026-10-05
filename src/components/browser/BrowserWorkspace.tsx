import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { useIsPresent } from 'framer-motion';
import { X } from '@droidex/icons';
import { isDesignModeOpen } from '../../hooks/designModeState';
import { shallowEqual, useStoreDispatch, useStoreSelector } from '../../hooks/useStore';
import { openBrowser, reloadBrowser, resizeBrowserViewport } from '../../lib/commands';
import type { BrowserViewportMode } from '../../types/bridge';
import { normalizeUrl, sameViewport, viewportForMode, viewportFromFrame } from './browserViewport';
import { NativeBrowserSurface } from './NativeBrowserSurface';
import { ViewportMenu } from './ViewportMenu';
import { isDesktop } from '../../lib/desktop';
import {
  goBackNativeBrowser,
  goForwardNativeBrowser,
  type NativeBrowserLoadFailed,
} from '../../lib/nativeBrowser';
import { BrowserToolbar } from './BrowserToolbar';
import { DesignModePill } from './DesignModePill';
import { useDesignMarks } from './designMarks';
import { browserKeyForSession } from '../../lib/browserSessionIdentity';
import { setBrowserPageCrashed, useBrowserPageCrashed } from '../../lib/browserHost';
import { browserAddressValue, isSelfBrowserUrl, safeBrowserUrl } from './browserUrlSafety';
import { shouldResetBrowserLoading } from './browserLoading';
import { useElementSize } from './useElementSize';
import { isEditTool } from '../../lib/diff';

// In full screen the chat's composer floats over the bottom of the page, with
// a row of small things just above it; a standard size is fitted into the room
// left over, while Fit fills the whole area and scrolls under them.
const OVER_PAGE_ROOM = 'calc(var(--composer-height, 0px) + 44px)';

export default function BrowserWorkspace({
  expanded = false,
  activity,
  onToggleExpanded,
}: {
  expanded?: boolean;
  // Shown over the page, just above the composer, in full screen.
  activity?: ReactNode;
  onToggleExpanded?: () => void;
}) {
  const dispatch = useStoreDispatch();
  const state = useStoreSelector(
    (current) => ({
      activeAppSessionId: current.activeAppSessionId,
      activeSession: current.activeAppSessionId
        ? current.sessions[current.activeAppSessionId]
        : undefined,
      browserErrors: current.browserErrors,
      connected: current.connection === 'connected',
      browserGlobalError: current.browserGlobalError,
      browsers: current.browsers,
      designModes: current.designModes,
    }),
    shallowEqual,
  );
  const requestedChatId = state.activeAppSessionId ?? undefined;
  const activeSession = state.activeSession;
  const browserKey = browserKeyForSession(activeSession);
  const browser = browserKey ? state.browsers[browserKey] : undefined;
  const browserError = browserKey ? state.browserErrors[browserKey] : state.browserGlobalError;
  const designMode = isDesignModeOpen(state.designModes, browserKey);
  const pageCrashed = useBrowserPageCrashed(browser?.browserSessionId);
  const designMarks = useDesignMarks(browserKey);
  const nativeBrowser = isDesktop();
  const frameRef = useRef<HTMLDivElement>(null);
  const roomRef = useRef<HTMLDivElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const appOrigin = typeof window === 'undefined' ? undefined : window.location.origin;
  const frameSize = useElementSize(frameRef);
  const roomSize = useElementSize(roomRef);
  const frameReady = frameSize.width > 8 && frameSize.height > 8;
  const fitViewport = useMemo(() => viewportFromFrame(frameSize, expanded), [expanded, frameSize]);
  const initialUrl = safeBrowserUrl(browser?.url, appOrigin);
  const [urlInput, setUrlInput] = useState(browserAddressValue(initialUrl));
  const [activeUrl, setActiveUrl] = useState(initialUrl);
  // The size the page has; a pick shows once the sidecar has taken it, so the
  // menu never disagrees with the page.
  const viewportMode: BrowserViewportMode = browser?.viewportMode ?? 'fit';
  const [pencilMode, setPencilMode] = useState(false);
  const [loadFailure, setLoadFailure] = useState<NativeBrowserLoadFailed | null>(null);
  const [loading, setLoading] = useState(false);
  const [canGoBack, setCanGoBack] = useState(browser?.canGoBack ?? false);
  const [canGoForward, setCanGoForward] = useState(browser?.canGoForward ?? false);
  const loadingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const browserIdentityRef = useRef({
    browserKey,
    browserSessionId: browser?.browserSessionId,
  });
  const startLoading = useCallback(() => {
    if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current);
    setLoading(true);
    loadingTimerRef.current = setTimeout(() => {
      loadingTimerRef.current = null;
      setLoading(false);
    }, 10_000);
  }, []);
  const stopLoading = useCallback(() => {
    if (loadingTimerRef.current) {
      clearTimeout(loadingTimerRef.current);
      loadingTimerRef.current = null;
    }
    setLoading(false);
  }, []);

  useEffect(
    () => () => {
      if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current);
    },
    [],
  );

  // Auto-reload: when the agent edits files and the browser shows a local
  // dev server URL, reload the pane after a short debounce so the new code
  // is visible immediately.  The timeout id lives in a ref so that
  // subsequent transcript updates (non-edit events) don't clear a pending
  // reload that was already scheduled.
  const lastEditTsRef = useRef(0);
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTranscriptEvent = useStoreSelector((current) => {
    const transcript = requestedChatId ? current.transcripts[requestedChatId] : undefined;
    return transcript?.[transcript.length - 1];
  });
  useEffect(() => {
    if (!browserKey) return;
    // Eligibility is checked first so navigating away from a local dev server
    // cancels any reload that was scheduled while the URL was still eligible;
    // otherwise a stale edit reload could fire against an unrelated page.
    if (!/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/.test(activeUrl)) {
      if (reloadTimerRef.current) {
        clearTimeout(reloadTimerRef.current);
        reloadTimerRef.current = null;
      }
      return;
    }
    const last = lastTranscriptEvent;
    if (last?.kind !== 'tool_result') return;
    if (!isEditTool(last.toolName) || last.isError) return;
    if (last.ts <= lastEditTsRef.current) return;
    lastEditTsRef.current = last.ts;
    if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
    reloadTimerRef.current = setTimeout(() => {
      reloadTimerRef.current = null;
      reloadBrowser(browserKey);
    }, 600);
  }, [activeUrl, browserKey, lastTranscriptEvent]);

  // Cancel any pending auto-reload when the browser session switches or the
  // component unmounts, so a stale timer doesn't reload the wrong session.
  useEffect(() => {
    return () => {
      if (reloadTimerRef.current) {
        clearTimeout(reloadTimerRef.current);
        reloadTimerRef.current = null;
      }
    };
  }, [browserKey]);

  useEffect(() => {
    if (!browser?.url) return;
    const nextUrl = safeBrowserUrl(browser.url, appOrigin);
    if (document.activeElement !== urlInputRef.current) {
      setUrlInput(browserAddressValue(nextUrl));
    }
    if (nextUrl !== activeUrl) {
      setActiveUrl(nextUrl);
    }
  }, [activeUrl, appOrigin, browser?.url]);

  useEffect(() => {
    if (typeof browser?.canGoBack === 'boolean') setCanGoBack(browser.canGoBack);
    if (typeof browser?.canGoForward === 'boolean') setCanGoForward(browser.canGoForward);
  }, [browser?.canGoBack, browser?.canGoForward]);

  useEffect(() => {
    const browserIdentity = { browserKey, browserSessionId: browser?.browserSessionId };
    const previousIdentity = browserIdentityRef.current;
    if (
      previousIdentity.browserKey === browserIdentity.browserKey &&
      previousIdentity.browserSessionId === browserIdentity.browserSessionId
    )
      return;
    browserIdentityRef.current = browserIdentity;
    if (shouldResetBrowserLoading(previousIdentity, browserIdentity)) {
      if (loadingTimerRef.current) {
        clearTimeout(loadingTimerRef.current);
        loadingTimerRef.current = null;
      }
      setLoading(false);
    }
    setCanGoBack(browser?.canGoBack ?? false);
    setCanGoForward(browser?.canGoForward ?? false);
    const nextUrl = safeBrowserUrl(browser?.url, appOrigin);
    setActiveUrl(nextUrl);
    if (document.activeElement !== urlInputRef.current) {
      setUrlInput(browserAddressValue(nextUrl));
    }
  }, [
    appOrigin,
    browser?.canGoBack,
    browser?.canGoForward,
    browser?.browserSessionId,
    browser?.url,
    browserKey,
  ]);

  useEffect(() => {
    setPencilMode(false);
    setLoadFailure(null);
  }, [browser?.browserSessionId, browser?.url, browserKey]);

  useEffect(() => {
    if (!designMode) setPencilMode(false);
  }, [designMode]);

  const requestedViewport = viewportForMode(viewportMode, fitViewport);

  // On Fit the page follows the pane: its size goes to the sidecar, which
  // takes it only while the page is still on Fit there, so it never undoes a
  // size an agent has just picked. A pane on its way out, however it was closed,
  // is still mounted while it animates away; it is not followed, so the page
  // keeps the size it had for the agent to work at. It waits for the sidecar
  // to be connected, and so to have taken up the browsers the app kept.
  const leaving = !useIsPresent();
  const followsPane = browser?.viewportMode === 'fit' && !leaving && state.connected;
  const currentViewport = browser?.viewport;
  useEffect(() => {
    if (!browserKey || !currentViewport || !followsPane) return;
    if (sameViewport(currentViewport, fitViewport)) return;
    const id = window.setTimeout(() => {
      resizeBrowserViewport({
        appSessionId: browserKey,
        viewport: fitViewport,
        viewportMode: 'fit',
        follow: true,
      });
    }, 120);
    return () => {
      window.clearTimeout(id);
    };
  }, [browserKey, currentViewport, fitViewport, followsPane]);

  const pickViewport = (mode: BrowserViewportMode) => {
    if (browserKey)
      resizeBrowserViewport({
        appSessionId: browserKey,
        viewport: viewportForMode(mode, fitViewport),
        viewportMode: mode,
      });
  };

  const openCurrentUrl = () => {
    const normalizedUrl = normalizeUrl(urlInput);
    if (browserKey && isSelfBrowserUrl(normalizedUrl, appOrigin)) {
      setUrlInput(normalizedUrl);
      dispatch({
        type: 'BROWSER_ERROR',
        appSessionId: browserKey,
        message:
          'Cannot open the Droid Control shell inside its own browser pane. Use a different local app port.',
      });
      return;
    }
    const url = safeBrowserUrl(normalizedUrl, appOrigin);
    setLoadFailure(null);
    startLoading();
    setUrlInput(browserAddressValue(url));
    setActiveUrl(url);
    if (browserKey) {
      openBrowser({
        appSessionId: browserKey,
        url,
        viewport: requestedViewport,
        viewportMode,
      });
    }
  };

  const navigateHistory = useCallback(
    async (direction: 'back' | 'forward') => {
      if (!browser?.browserSessionId) return;
      setLoadFailure(null);
      startLoading();
      try {
        const moved =
          direction === 'back'
            ? await goBackNativeBrowser(browser.browserSessionId)
            : await goForwardNativeBrowser(browser.browserSessionId);
        if (!moved) stopLoading();
      } catch (error) {
        stopLoading();
        setLoadFailure({
          browserSessionId: browser.browserSessionId,
          url: activeUrl,
          error: error instanceof Error ? error.message : `Could not go ${direction}.`,
        });
      }
    },
    [activeUrl, browser?.browserSessionId, startLoading, stopLoading],
  );

  const handleLoadFailed = useCallback((failure: NativeBrowserLoadFailed) => {
    setLoadFailure(failure);
  }, []);

  // Esc steps back one level: out of drawing first, then out of design mode.
  const stepBackFromDesign = useCallback(() => {
    if (!browserKey) return;
    if (pencilMode) setPencilMode(false);
    else dispatch({ type: 'SET_DESIGN_MODE', appSessionId: browserKey, open: false });
  }, [browserKey, dispatch, pencilMode]);

  // D and Esc pressed while the page has the focus. Picks become marks in the
  // Browser host, which follows every chat's page.
  const handleDesignKey = useCallback(
    (key: 'draw' | 'escape') => {
      if (key === 'draw') setPencilMode((drawing) => !drawing);
      else stepBackFromDesign();
    },
    [stepBackFromDesign],
  );

  // The same keys while the app has the focus, unless it is in a text field.
  useEffect(() => {
    if (!designMode) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isTextEntry(event.target)) return;
      const escape = event.key === 'Escape';
      const draw =
        event.key.toLowerCase() === 'd' && !event.metaKey && !event.ctrlKey && !event.altKey;
      if (!escape && !draw) return;
      event.preventDefault();
      // Holding a key steps back or toggles drawing once, not on every repeat.
      if (event.repeat) return;
      if (escape) stepBackFromDesign();
      else setPencilMode((drawing) => !drawing);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [designMode, stepBackFromDesign]);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-droid-bg">
      <BrowserToolbar
        urlInputRef={urlInputRef}
        urlInput={urlInput}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        loading={loading}
        designMode={designMode}
        designModeDisabled={!browserKey}
        pencilMode={pencilMode}
        expanded={expanded}
        onUrlInputChange={setUrlInput}
        onOpen={openCurrentUrl}
        onGoBack={() => void navigateHistory('back')}
        onGoForward={() => void navigateHistory('forward')}
        onReload={() => {
          startLoading();
          if (browserKey && browser) reloadBrowser(browserKey);
          else openCurrentUrl();
        }}
        onToggleDesignMode={() => {
          if (browserKey) dispatch({ type: 'TOGGLE_DESIGN_MODE', appSessionId: browserKey });
        }}
        onTogglePencilMode={() => {
          setPencilMode((value) => !value);
        }}
        onToggleExpanded={onToggleExpanded}
      />

      {browserError && (
        <div className="shrink-0 border-b border-droid-border bg-droid-accent/10 px-4 py-2 text-[12px] text-droid-text-secondary">
          {browserError}
        </div>
      )}

      {(pageCrashed || loadFailure) && (
        <div className="flex shrink-0 items-center gap-2 border-b border-droid-border bg-red-500/10 px-4 py-2 text-[12px] text-droid-text-secondary">
          <span className="min-w-0 flex-1 truncate">
            {pageCrashed || !loadFailure
              ? 'This page crashed. Retry to load it again.'
              : `Could not load ${loadFailure.url}${loadFailure.error ? ` (${loadFailure.error})` : ''}. Check that the server is running.`}
          </span>
          <button
            type="button"
            className="shrink-0 rounded-md border border-droid-border bg-droid-surface px-2 py-0.5 text-[11px] text-droid-text-muted transition-colors hover:bg-droid-elevated/60 hover:text-droid-text"
            onClick={() => {
              setLoadFailure(null);
              if (browser) setBrowserPageCrashed(browser.browserSessionId, false);
              startLoading();
              if (browserKey && browser) reloadBrowser(browserKey);
              else openCurrentUrl();
            }}
          >
            Retry
          </button>
          <button
            type="button"
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-droid-text-muted transition-colors hover:bg-droid-elevated/60 hover:text-droid-text"
            onClick={() => {
              setLoadFailure(null);
              if (browser) setBrowserPageCrashed(browser.browserSessionId, false);
            }}
            aria-label="Dismiss"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      <div ref={frameRef} className="relative flex-1 min-h-0 min-w-0">
        <div
          ref={roomRef}
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0"
          style={{ bottom: expanded ? OVER_PAGE_ROOM : 0 }}
        />
        {browserKey && frameReady ? (
          <NativeBrowserSurface
            visibleBrowserSessionId={browser?.browserSessionId}
            url={activeUrl}
            // Laid out from the size the page has, as the Browser host draws it.
            viewport={browser?.viewport ?? requestedViewport}
            viewportMode={viewportMode}
            designMode={designMode}
            pencilMode={designMode && pencilMode}
            designMarks={designMarks}
            frameSize={viewportMode === 'fit' ? frameSize : roomSize}
            onLoaded={(event) => {
              setLoadFailure(null);
              stopLoading();
              setCanGoBack(event.canGoBack ?? canGoBack);
              setCanGoForward(event.canGoForward ?? canGoForward);
              const nextUrl = safeBrowserUrl(event.url, appOrigin);
              setActiveUrl(nextUrl);
              if (document.activeElement !== urlInputRef.current)
                setUrlInput(browserAddressValue(nextUrl));
              // In the desktop app the Browser host records navigations.
              if (!nativeBrowser && browserKey && event.browserSessionId) {
                dispatch({
                  type: 'BROWSER_NAVIGATED',
                  appSessionId: browserKey,
                  browserSessionId: event.browserSessionId,
                  url: event.url,
                  canGoBack: event.canGoBack,
                  canGoForward: event.canGoForward,
                });
              }
            }}
            onDesignKey={handleDesignKey}
            onLoadFailed={(failure) => {
              stopLoading();
              // Crashes are tracked by the Browser host, pane open or not.
              if (!failure.crashed) handleLoadFailed(failure);
            }}
            expanded={expanded}
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-droid-bg px-6 text-sm text-droid-text-muted">
            {browserKey ? 'Preparing browser pane...' : 'Select or create a Droid session.'}
          </div>
        )}

        {browserKey && !browser && frameReady && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-droid-bg px-6 text-sm text-droid-text-muted">
            Open a URL to start this chat&apos;s browser.
          </div>
        )}

        {/* Design mode's pill takes the size menu's place while it is on. */}
        {expanded ? (
          // A fitted page runs under the row and the composer, so it fades into
          // the app's background behind them; a standard size ends above them.
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 z-10 px-3 pt-16"
            style={{
              paddingBottom: 'calc(var(--composer-height, 0px) + 8px)',
              background:
                viewportMode === 'fit'
                  ? 'linear-gradient(to top, var(--droid-bg) calc(100% - 64px), transparent)'
                  : undefined,
            }}
          >
            {/* The activity line's opened steps span this row, the composer's
                width, and stay within the room above it. */}
            <div
              className="relative mx-auto flex max-w-4xl items-center gap-2 [&>*]:pointer-events-auto"
              style={{ '--page-room': `${String(roomSize.height)}px` } as CSSProperties}
            >
              {activity}
              {browser && !designMode && (
                <ViewportMenu
                  className="relative ml-auto shrink-0"
                  menuAlign="end"
                  mode={viewportMode}
                  fitViewport={fitViewport}
                  onSelect={pickViewport}
                />
              )}
            </div>
          </div>
        ) : (
          browser &&
          !designMode && (
            <ViewportMenu
              className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2"
              mode={viewportMode}
              fitViewport={fitViewport}
              onSelect={pickViewport}
            />
          )
        )}
        <DesignModePill
          open={Boolean(browser) && designMode}
          drawing={pencilMode}
          // In full screen the composer sits over the page's foot, so the pill
          // rises above it and the activity row.
          bottom={expanded ? 'calc(var(--composer-height, 0px) + 52px)' : undefined}
          onDone={() => {
            if (browserKey)
              dispatch({ type: 'SET_DESIGN_MODE', appSessionId: browserKey, open: false });
          }}
        />
      </div>
    </div>
  );
}

function isTextEntry(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}
