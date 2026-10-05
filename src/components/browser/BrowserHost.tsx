import { useEffect, useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';
import { useStoreDispatch, useStoreSelector } from '../../hooks/useStore';
import { BrowserAgentCursor } from './BrowserAgentCursor';
import {
  closeBrowserPage,
  isBrowserPageAwake,
  setBrowserPageCrashed,
  setBrowserPageWorking,
  useBrowserHost,
  type BrowserHostState,
  type BrowserPage,
} from '../../lib/browserHost';
import { addDesignReference } from '../../lib/commands';
import {
  addDesignMark,
  designReferenceFor,
  keepDesignMarksFor,
  removeDesignMark,
} from './designMarks';
import {
  listWorkingNativeBrowsers,
  onNativeBrowserClosed,
  onNativeBrowserDesignEvent,
  onNativeBrowserLoadFailed,
  onNativeBrowserLoaded,
  onNativeBrowserWorking,
} from '../../lib/nativeBrowser';

type Placement = 'shown' | 'working' | 'asleep';

interface PageSize {
  width: number;
  height: number;
}

const DEFAULT_PAGE_SIZE: PageSize = { width: 1280, height: 800 };

/**
 * The Browser host layer: every live chat browser page, mounted once at the
 * app root and never moved (see lib/browserHost.ts).
 */
export function BrowserHost() {
  const host = useBrowserHost();
  const dispatch = useStoreDispatch();
  const browsers = useStoreSelector((state) => state.browsers);
  const browsersRef = useRef(browsers);
  browsersRef.current = browsers;
  const sizes = useMemo(() => {
    const bySession = new Map<string, PageSize>();
    for (const browser of Object.values(browsers))
      bySession.set(browser.browserSessionId, browser.viewport);
    return bySession;
  }, [browsers]);

  // A chat whose browser has closed has nothing its marks could be sent with.
  useEffect(() => {
    keepDesignMarksFor((appSessionId) => appSessionId in browsers);
  }, [browsers]);

  // Pages work, navigate and crash while the pane is closed too, so all of it
  // is followed here rather than by the pane. A pick is the chat's whose page
  // it came from, even once another chat is shown.
  useEffect(() => {
    const appSessionIdFor = (browserSessionId: string) =>
      Object.keys(browsersRef.current).find(
        (key) => browsersRef.current[key].browserSessionId === browserSessionId,
      );
    const setWorking = (browserSessionId: string, working: boolean) => {
      const appSessionId = appSessionIdFor(browserSessionId);
      const saved = appSessionId ? browsersRef.current[appSessionId] : undefined;
      setBrowserPageWorking(browserSessionId, working, saved?.url, saved?.viewportMode);
    };
    const heard = new Set<string>();
    const subscriptions = [
      onNativeBrowserWorking(({ browserSessionId, working }) => {
        heard.add(browserSessionId);
        setWorking(browserSessionId, working);
      }),
      onNativeBrowserClosed(({ browserSessionId }) => {
        closeBrowserPage(browserSessionId);
      }),
      onNativeBrowserDesignEvent((event) => {
        const appSessionId = event.browserSessionId && appSessionIdFor(event.browserSessionId);
        if (!appSessionId) return;
        if (event.type === 'select')
          addDesignReference(
            appSessionId,
            addDesignMark(appSessionId, designReferenceFor(event.selection)),
          );
        else if (event.type === 'unselect') removeDesignMark(appSessionId, event.id);
      }),
      onNativeBrowserLoadFailed((failure) => {
        if (failure.crashed && failure.browserSessionId)
          setBrowserPageCrashed(failure.browserSessionId, true);
      }),
      onNativeBrowserLoaded((event) => {
        const { browserSessionId } = event;
        if (!browserSessionId) return;
        setBrowserPageCrashed(browserSessionId, false);
        const appSessionId = appSessionIdFor(browserSessionId);
        if (appSessionId)
          dispatch({ type: 'BROWSER_NAVIGATED', appSessionId, ...event, browserSessionId });
      }),
    ];
    // Work main started before this host mounted (an app reload mid-request).
    // An event heard meanwhile is newer than this answer.
    void listWorkingNativeBrowsers()
      .then((ids) => {
        for (const browserSessionId of ids)
          if (!heard.has(browserSessionId)) setWorking(browserSessionId, true);
      })
      .catch(() => undefined);
    return () => {
      for (const unsubscribe of subscriptions) unsubscribe();
    };
  }, [dispatch]);

  return (
    <div className="contents">
      {host.pages.map((page) => {
        const slot = host.slot?.browserSessionId === page.browserSessionId ? host.slot : null;
        return (
          <BrowserPageFrame
            key={page.key}
            page={page}
            placement={placementOf(host, page.browserSessionId)}
            working={page.browserSessionId in host.working}
            anchor={slot?.anchor}
            rounded={slot?.rounded ?? false}
            scale={slot?.scale}
            size={sizes.get(page.browserSessionId) ?? DEFAULT_PAGE_SIZE}
          />
        );
      })}
    </div>
  );
}

function BrowserPageFrame({
  page,
  placement,
  working,
  anchor,
  rounded,
  scale,
  size,
}: {
  page: BrowserPage;
  placement: Placement;
  /** An agent has work in flight on the page. */
  working: boolean;
  anchor?: string;
  rounded: boolean;
  scale?: number;
  size: PageSize;
}) {
  const webviewRef = useRef<HTMLWebViewElement>(null);
  const shown = placement === 'shown';

  useEffect(() => {
    // A page leaving the pane must not keep the keyboard.
    const webview = webviewRef.current;
    if (!shown && webview && document.activeElement === webview) webview.blur();
  }, [shown]);

  return (
    <div style={frameStyle(placement, anchor, rounded)} aria-hidden={!shown}>
      <webview
        ref={webviewRef}
        src={page.src}
        tabIndex={shown ? undefined : -1}
        style={shown && scale === undefined ? FILL : pageStyle(size, shown ? scale : undefined)}
      />
      <BrowserAgentCursor
        browserSessionId={page.browserSessionId}
        scale={scale ?? 1}
        shown={shown}
        working={working}
      />
    </div>
  );
}

function placementOf(host: BrowserHostState, browserSessionId: string): Placement {
  if (host.slot?.browserSessionId === browserSessionId) return 'shown';
  return isBrowserPageAwake(host, browserSessionId) ? 'working' : 'asleep';
}

const FILL: CSSProperties = { width: '100%', height: '100%' };

// A page at its own CSS size; in the pane, a standard size is drawn scaled
// down into the slot, so it lays out as the agent sees it.
function pageStyle(size: PageSize, scale?: number): CSSProperties {
  return {
    width: size.width,
    height: size.height,
    transform: scale === undefined || scale === 1 ? undefined : `scale(${String(scale)})`,
    transformOrigin: '0 0',
  };
}

function frameStyle(placement: Placement, anchor: string | undefined, rounded: boolean) {
  if (placement === 'shown' && anchor) {
    // Anchored to the pane's slot, so the page follows the pane's layout with
    // no measuring. The page is pane content: anything the app stacks (menus,
    // the expanded composer, dialogs) draws over it.
    return {
      position: 'fixed',
      zIndex: 1,
      positionAnchor: anchor,
      positionVisibility: 'always',
      top: 'anchor(top)',
      left: 'anchor(left)',
      width: 'anchor-size(width)',
      height: 'anchor-size(height)',
      overflow: 'hidden',
      borderRadius: rounded ? 6 : 0,
    } satisfies CSSProperties;
  }
  // Parked in a 1x1 clip at the window's top-left corner, which the window's
  // rounded edge masks. A working page keeps rendering at full rate there and
  // its captures work; `visibility: hidden` stops a sleeping page's frames.
  // `position-visibility: always` everywhere: by default a box whose anchor
  // goes away is hidden, and Chromium keeps it hidden once the pane's slot
  // unmounts, so a parked page would never paint (or capture) again.
  return {
    position: 'fixed',
    top: 0,
    left: 0,
    width: 1,
    height: 1,
    overflow: 'hidden',
    pointerEvents: 'none',
    positionVisibility: 'always',
    visibility: placement === 'asleep' ? 'hidden' : undefined,
  } satisfies CSSProperties;
}
