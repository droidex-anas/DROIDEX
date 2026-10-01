import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X } from '@droidex/icons';
import { isDesignModeOpen } from '../../hooks/designModeState';
import { shallowEqual, useStoreDispatch, useStoreSelector } from '../../hooks/useStore';
import { useSessionLive } from '../../hooks/useSessionLive';
import {
  addDesignReference,
  openBrowser,
  reloadBrowser,
  resizeBrowserViewport,
  sendDesignPrompt,
} from '../../lib/commands';
import type { BrowserViewportMode, DesignReference } from '../../types/bridge';
import { normalizeUrl, sameViewport, viewportForMode, viewportFromFrame } from './browserViewport';
import { NativeBrowserSurface } from './NativeBrowserSurface';
import { ViewportMenu } from './ViewportMenu';
import { isDesktop } from '../../lib/desktop';
import {
  goBackNativeBrowser,
  goForwardNativeBrowser,
  type NativeBrowserDesignPrompt,
  type NativeBrowserLoadFailed,
  type NativeBrowserSelection,
} from '../../lib/nativeBrowser';
import { BrowserToolbar } from './BrowserToolbar';
import { DesignModeComposer } from './DesignModeComposer';
import { composerStyleForReferences } from './browserComposerPosition';
import { browserKeyForSession } from '../../lib/browserSessionIdentity';
import { setBrowserPageCrashed, useBrowserPageCrashed } from '../../lib/browserHost';
import { browserTranscriptReferencesFromDesignReferences } from './browserTranscriptReferences';
import { browserAddressValue, isSelfBrowserUrl, safeBrowserUrl } from './browserUrlSafety';
import { shouldResetBrowserLoading } from './browserLoading';
import { useElementSize } from './useElementSize';
import { isEditTool } from '../../lib/diff';
import { createLocalDesignTranscriptEvent, newQueueId } from '../../lib/promptQueue';

export default function BrowserWorkspace({
  expanded = false,
  onToggleExpanded,
}: {
  expanded?: boolean;
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
  const sessionLive = useSessionLive(requestedChatId ?? null);
  const nativeBrowser = isDesktop();
  const frameRef = useRef<HTMLDivElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const appOrigin = typeof window === 'undefined' ? undefined : window.location.origin;
  const frameSize = useElementSize(frameRef);
  const frameReady = frameSize.width > 8 && frameSize.height > 8;
  const fitViewport = useMemo(() => viewportFromFrame(frameSize, expanded), [expanded, frameSize]);
  const initialUrl = safeBrowserUrl(browser?.url, appOrigin);
  const [urlInput, setUrlInput] = useState(browserAddressValue(initialUrl));
  const [activeUrl, setActiveUrl] = useState(initialUrl);
  const [viewportMode, setViewportMode] = useState<BrowserViewportMode>(
    browser?.viewportMode ?? 'fit',
  );
  const [pencilMode, setPencilMode] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [references, setReferences] = useState<DesignReference[]>([]);
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
    if (browser?.viewportMode) setViewportMode(browser.viewportMode);
  }, [browser?.viewportMode]);

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
    setReferences([]);
    setInstruction('');
    setPencilMode(false);
    setLoadFailure(null);
  }, [browser?.browserSessionId, browser?.url, browserKey]);

  useEffect(() => {
    if (!designMode) setPencilMode(false);
  }, [designMode]);

  const requestedViewport = viewportForMode(viewportMode, fitViewport);
  const selectedIds = references.map((ref) => ref.id).filter((id): id is string => Boolean(id));
  const canSend = Boolean(browserKey && selectedIds.length > 0 && instruction.trim());
  const disabledReason = !browserKey
    ? 'Select or create a Droid session'
    : selectedIds.length === 0
      ? 'Select a reference'
      : 'Enter a prompt';
  const composerStyle = useMemo(
    () => composerStyleForReferences(references, frameSize, requestedViewport, viewportMode),
    [frameSize, references, requestedViewport, viewportMode],
  );

  // On Fit the page follows the pane: its size goes to the sidecar, which
  // takes it only while the page is still on Fit there, so it never undoes a
  // size an agent has just picked.
  const followsPane = browser?.viewportMode === 'fit' && viewportMode === 'fit';
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
    setViewportMode(mode);
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

  const emitDesignTranscript = useCallback(
    (text: string, refs: DesignReference[]) => {
      if (!requestedChatId) return;
      const browserRefs = browserTranscriptReferencesFromDesignReferences(refs);
      dispatch({
        type: 'SESSION_TRANSCRIPT',
        event: createLocalDesignTranscriptEvent(requestedChatId, text, browserRefs),
      });
    },
    [dispatch, requestedChatId],
  );

  // Stage a design prompt in the same client-side queue normal prompts use so
  // it shows up as a draggable item and is delivered (with its references) once
  // the current turn finishes, instead of hitting the backend mid-turn.
  const queueDesignPrompt = useCallback(
    (text: string, refs: DesignReference[], ids: string[]) => {
      if (!browserKey || !requestedChatId) return;
      dispatch({
        type: 'QUEUE_PROMPT',
        appSessionId: requestedChatId,
        prompt: {
          id: newQueueId(),
          text,
          skills: [],
          files: [],
          design: { browserKey, references: refs, referenceIds: ids },
        },
      });
    },
    [browserKey, dispatch, requestedChatId],
  );

  const sendPrompt = () => {
    if (!browserKey || !canSend) return;
    const text = instruction.trim();
    if (sessionLive) {
      queueDesignPrompt(text, references, selectedIds);
    } else {
      sendDesignPrompt(browserKey, text, selectedIds);
      emitDesignTranscript(text, references);
    }
    setReferences([]);
    setInstruction('');
    // Re-arm like Cursor: disarm after sending so the user clicks Design Mode
    // again to start a new selection instead of staying live.
    dispatch({ type: 'SET_DESIGN_MODE', appSessionId: browserKey, open: false });
  };

  const handleSelection = useCallback(
    (selection: NativeBrowserSelection) => {
      const reference = referenceFromNativeSelection(selection);
      setReferences([reference]);
      if (browserKey) addDesignReference(browserKey, reference);
    },
    [browserKey],
  );

  const handleLoadFailed = useCallback((failure: NativeBrowserLoadFailed) => {
    setLoadFailure(failure);
  }, []);

  const handleNativePrompt = useCallback(
    (prompt: NativeBrowserDesignPrompt) => {
      if (!browserKey) return;
      const text = prompt.instruction.trim();
      if (!text) return;
      const reference = referenceFromNativeSelection(prompt.selection);
      const referenceId = reference.id;
      if (!referenceId) return;
      addDesignReference(browserKey, reference);
      if (sessionLive) {
        queueDesignPrompt(text, [reference], [referenceId]);
      } else {
        window.setTimeout(() => {
          sendDesignPrompt(browserKey, text, [referenceId]);
        }, 0);
        emitDesignTranscript(text, [reference]);
      }
      setReferences([]);
      dispatch({ type: 'SET_DESIGN_MODE', appSessionId: browserKey, open: false });
    },
    [browserKey, dispatch, emitDesignTranscript, sessionLive, queueDesignPrompt],
  );

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
        {browserKey && frameReady ? (
          <NativeBrowserSurface
            visibleBrowserSessionId={browser?.browserSessionId}
            url={activeUrl}
            viewport={requestedViewport}
            viewportMode={viewportMode}
            designMode={designMode}
            pencilMode={designMode && pencilMode}
            frameSize={frameSize}
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
            onSelection={handleSelection}
            onPrompt={handleNativePrompt}
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

        {!nativeBrowser && designMode && references.length > 0 && (
          <DesignModeComposer
            references={references}
            instruction={instruction}
            canSend={canSend}
            disabledReason={disabledReason}
            style={composerStyle}
            onInstructionChange={setInstruction}
            onRemoveReference={(id) => {
              setReferences((prev) => prev.filter((item) => item.id !== id));
            }}
            onSend={sendPrompt}
          />
        )}

        {browser && (
          <ViewportMenu mode={viewportMode} fitViewport={fitViewport} onSelect={pickViewport} />
        )}
      </div>
    </div>
  );
}

function referenceFromNativeSelection(selection: NativeBrowserSelection): DesignReference {
  return {
    id: selection.anchor.id,
    anchor: {
      ...selection.anchor,
      strokes: selection.anchor.strokes ?? selection.strokes,
    },
    detail: selection.detail,
    url: selection.url,
    title: selection.title,
    scroll: selection.scroll,
    screenshot: selection.screenshot,
  };
}
