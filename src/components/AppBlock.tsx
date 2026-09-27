import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { VisualizeTile } from './icons/VisualizeIcon';
import { AppBlockErrorFallback } from './AppBlockErrorFallback';
import {
  APP_BUILD_TIMEOUT_MS,
  DEFAULT_APP_HEIGHT,
  createAppHeightScheduler,
  appBlockStartupTransition,
  appBlockReadyFromMessage,
  appBlockEscapeFromMessage,
  appBlockHeightFromMessage,
  appBlockMathRequestFromMessage,
  createAppBridgeSession,
  currentAppBlockTheme,
  renderAppBlockMath,
  type AppBlockStartupState,
} from './appBlockRuntime';
import { createAppDocument } from './appBlockDocument';
import { ExpandableAppSurface, type AppExpansion } from './AppBlockExpandableSurface';

function AppLoadingSurface({ title }: { title: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={title}
      className="flex min-h-16 items-center gap-3 py-3 text-droid-text-secondary"
    >
      <VisualizeTile />
      <span className="shimmer-text text-[13px] font-medium">{title}</span>
    </div>
  );
}

export function RunningAppFrame({ source, instanceId }: { source: string; instanceId: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [theme] = useState(currentAppBlockTheme);
  const [bridge] = useState(createAppBridgeSession);
  const frameDocument = useMemo(
    () => createAppDocument(source, instanceId, theme, bridge.token),
    [bridge.token, instanceId, source, theme],
  );
  // The frame stays hidden while the App boots so the reveal lands at its real
  // measured height instead of jumping from the default one.
  const [expired, setExpired] = useState(false);
  const [expansion, setExpansion] = useState<AppExpansion | null>(null);
  const collapse = useCallback(() => {
    setExpansion(null);
  }, []);
  // A failed App shows its error instead of a frame, so it never reveals.
  const hasFailed = runtimeError !== null;
  const isVisible = height !== null || expired;
  const syncTheme = useCallback(() => {
    const frame = iframeRef.current;
    if (!frame) return;
    const nextTheme = currentAppBlockTheme();
    // Chromium paints an opaque canvas when the frame and document schemes differ.
    frame.style.colorScheme = nextTheme.colorScheme;
    frame.contentWindow?.postMessage(
      {
        type: 'droidex:theme-update',
        instanceId,
        bridgeToken: bridge.token,
        theme: nextTheme,
      },
      '*',
    );
  }, [bridge.token, instanceId]);

  useEffect(() => {
    if (hasFailed || isVisible) return;
    const ceiling = setTimeout(() => {
      setExpired(true);
    }, APP_BUILD_TIMEOUT_MS);
    return () => {
      clearTimeout(ceiling);
    };
  }, [hasFailed, isVisible]);

  useEffect(() => {
    if (hasFailed) return;
    // Update CSS in place: changing srcDoc would discard the user's controls.
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style', 'class'],
    });
    return () => {
      observer.disconnect();
    };
  }, [hasFailed, syncTheme]);

  useLayoutEffect(() => {
    let disposed = false;
    let startupState: AppBlockStartupState = 'waiting';
    const heights = createAppHeightScheduler(setHeight);
    const onMessage = (event: MessageEvent) => {
      const frameWindow = iframeRef.current?.contentWindow;
      if (!frameWindow || event.source !== frameWindow) return;
      const startup = appBlockStartupTransition(startupState, event.data, instanceId, bridge.token);
      startupState = startup.state;
      if (startup.error) {
        bridge.guard.fail();
        setRuntimeError(startup.error);
        return;
      }
      if (appBlockReadyFromMessage(event.data, instanceId, bridge.token)) {
        return;
      }
      if (startupState !== 'ready') return;
      if (appBlockEscapeFromMessage(event.data, instanceId, bridge.token)) {
        setExpansion(null);
        return;
      }
      const nextHeight = appBlockHeightFromMessage(event.data, instanceId, bridge.token);
      if (nextHeight !== undefined) {
        if (!bridge.guard.acceptHeight(nextHeight)) return;
        heights.schedule(nextHeight);
        return;
      }
      const mathRequest = appBlockMathRequestFromMessage(event.data, instanceId, bridge.token);
      if (!mathRequest) return;
      if (!bridge.guard.startMath()) {
        frameWindow.postMessage(
          {
            type: 'droidex:math-rendered',
            instanceId,
            bridgeToken: bridge.token,
            requestId: mathRequest.requestId,
          },
          '*',
        );
        return;
      }
      void renderAppBlockMath(mathRequest)
        .then((html) => {
          if (disposed || iframeRef.current?.contentWindow !== frameWindow) return;
          frameWindow.postMessage(
            {
              type: 'droidex:math-rendered',
              instanceId,
              bridgeToken: bridge.token,
              requestId: mathRequest.requestId,
              html,
            },
            '*',
          );
        })
        .catch(() => {
          if (disposed || iframeRef.current?.contentWindow !== frameWindow) return;
          frameWindow.postMessage(
            {
              type: 'droidex:math-rendered',
              instanceId,
              bridgeToken: bridge.token,
              requestId: mathRequest.requestId,
            },
            '*',
          );
        })
        .finally(() => {
          bridge.guard.finishMath();
        });
    };
    window.addEventListener('message', onMessage);
    return () => {
      disposed = true;
      heights.cancel();
      window.removeEventListener('message', onMessage);
    };
  }, [bridge, instanceId]);

  if (hasFailed) {
    return <AppBlockErrorFallback message={runtimeError} source={source} />;
  }

  return (
    <ExpandableAppSurface
      expansion={expansion}
      canExpand={isVisible}
      onExpand={setExpansion}
      onCollapse={collapse}
    >
      {!isVisible && <AppLoadingSurface title="Starting interactive app" />}
      <iframe
        ref={iframeRef}
        onLoad={() => {
          const frameWindow = iframeRef.current?.contentWindow;
          frameWindow?.postMessage(
            {
              type: 'droidex:host-ready',
              instanceId,
              bridgeToken: bridge.token,
            },
            '*',
          );
          syncTheme();
        }}
        title="Interactive App block"
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        // The hidden frame must still load: a lazy one below the fold would
        // never boot, and the build surface would never end.
        loading="eager"
        srcDoc={frameDocument}
        aria-hidden={isVisible ? undefined : true}
        tabIndex={isVisible ? undefined : -1}
        className={`min-w-0 w-full border-0 bg-transparent ${
          isVisible ? 'block' : 'invisible pointer-events-none absolute inset-x-0 top-0'
        }`}
        style={{ height: height ?? DEFAULT_APP_HEIGHT, colorScheme: theme.colorScheme }}
      />
    </ExpandableAppSurface>
  );
}

export function AppBlock({
  source,
  isBuilding = false,
  isCutOff = false,
}: {
  source: string;
  isBuilding?: boolean;
  // The stored source lost its closing fence, so this App can never run. It
  // outranks every other state: incomplete source must not execute.
  isCutOff?: boolean;
}) {
  const instanceId = useId();

  if (isCutOff) {
    return (
      <AppBlockErrorFallback
        message="Saved history kept only part of this App's source."
        source={source}
      />
    );
  }

  return (
    <div className="my-3 min-w-0">
      {isBuilding ? (
        <AppLoadingSurface title="Building interactive app" />
      ) : (
        <RunningAppFrame key={source} source={source} instanceId={instanceId} />
      )}
    </div>
  );
}
