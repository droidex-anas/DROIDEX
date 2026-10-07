import { memo, useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Reorder } from 'framer-motion';
import { Clock, Columns, Plus, Spinner, SquarePen, X } from '@droidex/icons';
import { useStoreDispatch, useStoreSelector, type AppState } from '../../hooks/useStore';
import { chatDisplayTitle } from '../../lib/chatMetadata';
import { sessionIsLive } from '../../lib/sessions';
import { formatChord } from '../../lib/shortcuts';
import { ActivityStatusGlyph } from '../../components/ActivityStatusGlyph';
import { ChatBrowserWorkingMark } from '../../components/browser/BrowserWorkingMark';
import { HoverTooltip } from '../../components/HoverTooltip';
import { GitPullRequestIcon } from '../../components/environment/GithubIcons';
import { ModelIcon } from '../../components/ModelIcon';
import { PROVIDER_MARKS } from '../providers/providerIdentity';
import type { ProviderKind, SessionSummary } from '../../types/bridge';
import { livePage, tabPage, type FocusedPage, type TabPage } from './tabStrip';
import { focusedTile, gridTiles } from './tileGrid';

interface TabItem {
  id: string;
  kind: FocusedPage['kind'];
  label: string;
  // Chat tabs only: the chat's browser page (a split tab's focused chat's), its
  // harness mark, and whether a turn is running.
  browserSessionId?: string;
  provider: ProviderKind | null;
  live: boolean;
  // A split tab names every tile in its tooltip and shows its tile count.
  title: string;
  tileCount: number;
}

// The width .scroll-fade-x fades at an edge the strip continues past.
const EDGE_FADE_PX = 28;

// Only the strip scrolls: scrollIntoView would also move the window's own scrollers.
function revealActiveTab(strip: HTMLElement, behavior: ScrollBehavior) {
  const tab = strip.querySelector<HTMLElement>('[aria-selected="true"]');
  if (!tab) return;
  const stripRect = strip.getBoundingClientRect();
  const tabRect = tab.getBoundingClientRect();
  if (tabRect.left < stripRect.left + EDGE_FADE_PX) {
    strip.scrollBy({ left: tabRect.left - stripRect.left - EDGE_FADE_PX, behavior });
  } else if (tabRect.right > stripRect.right - EDGE_FADE_PX) {
    strip.scrollBy({ left: tabRect.right - stripRect.right + EDGE_FADE_PX, behavior });
  }
}

function tabIndexForKey(key: string, index: number, count: number): number | null {
  switch (key) {
    case 'ArrowLeft':
      return (index - 1 + count) % count;
    case 'ArrowRight':
      return (index + 1) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

const VIEW_LABELS = {
  'new-chat': 'New chat',
  projects: 'Projects',
  'pull-requests': 'Pull requests',
  automations: 'Automations',
} as const;

function pageItem(state: AppState, id: string, page: FocusedPage): TabItem {
  const item = { id, provider: null, live: false, tileCount: 1 };
  if (page.kind !== 'chat') {
    const label = VIEW_LABELS[page.kind];
    return { ...item, kind: page.kind, label, title: label };
  }
  // A restored tab can name a chat the first session list has not reported yet.
  const sessions: Partial<Record<string, SessionSummary>> = state.sessions;
  const session = sessions[page.appSessionId];
  if (!session) return { ...item, kind: 'chat', label: 'Chat', title: 'Chat' };
  const label = chatDisplayTitle(session, state.chatMetadata[page.appSessionId]);
  return {
    ...item,
    kind: 'chat',
    browserSessionId: Object.hasOwn(state.browsers, page.appSessionId)
      ? state.browsers[page.appSessionId].browserSessionId
      : undefined,
    label,
    title: label,
    provider: session.provider,
    live: sessionIsLive(session),
  };
}

// A split tab reads as its focused tile, and is live while any tile is.
function tabItem(state: AppState, id: string, page: TabPage): TabItem {
  if (page.kind !== 'tiles') return pageItem(state, id, page);
  const items = gridTiles(page.grid).map((tile) => pageItem(state, id, tile.page));
  return {
    ...pageItem(state, id, focusedTile(page.grid).page),
    live: items.some((item) => item.live),
    title: items.map((item) => item.label).join(', '),
    tileCount: items.length,
  };
}

function selectTabItems(state: AppState): TabItem[] {
  const live = livePage(state);
  return state.tabStrip.tabs.map((tab) =>
    tabItem(state, tab.id, tabPage(state.tabStrip, tab, live)),
  );
}

function equalTabItems(previous: TabItem[], next: TabItem[]): boolean {
  return (
    previous.length === next.length &&
    previous.every((item, index) => {
      const other = next[index];
      return (
        item.id === other.id &&
        item.kind === other.kind &&
        item.browserSessionId === other.browserSessionId &&
        item.label === other.label &&
        item.provider === other.provider &&
        item.live === other.live &&
        item.title === other.title &&
        item.tileCount === other.tileCount
      );
    })
  );
}

function TabGlyph({ item, active }: { item: TabItem; active: boolean }) {
  switch (item.kind) {
    case 'chat': {
      const glyph = item.live ? (
        <Spinner size={13} className="motion-safe:animate-spin-slow" />
      ) : (
        item.provider && <ModelIcon provider={PROVIDER_MARKS[item.provider]} size={13} />
      );
      // An agent at work in the chat's browser shows on the tab unless the
      // page is in front of the reader already.
      return (
        <ChatBrowserWorkingMark
          browserSessionId={item.browserSessionId}
          whenShown={!active}
          className="h-[13px] w-[13px]"
          fallback={glyph}
        />
      );
    }
    case 'new-chat':
      return <SquarePen className="h-3.5 w-3.5" />;
    case 'projects':
      return <ActivityStatusGlyph status="ready" decorative />;
    case 'pull-requests':
      return <GitPullRequestIcon size={13} />;
    case 'automations':
      return <Clock className="h-3.5 w-3.5" />;
  }
}

// The header's browser-style tab strip. Its row is the window's top row while
// it shows, so it starts past the window controls when the sidebar is collapsed
// and ends with the session's own controls.
export function HeaderTabs({ leadPx, controls }: { leadPx: number; controls: ReactNode }) {
  return (
    <div
      data-electron-drag-region
      className="flex h-9 shrink-0 items-center gap-1 pr-3"
      style={{ paddingLeft: leadPx }}
    >
      <TabList />
      <div className="ml-auto flex shrink-0 items-center gap-1 pl-2">{controls}</div>
    </div>
  );
}

const TabList = memo(function TabList() {
  const dispatch = useStoreDispatch();
  const items = useStoreSelector(selectTabItems, equalTabItems);
  const activeTabId = useStoreSelector((state) => state.tabStrip.activeTabId);
  const newTabChord = useStoreSelector((state) => state.shortcutBindings.newTab);
  const closeTabChord = useStoreSelector((state) => state.shortcutBindings.closeTab);
  const stripRef = useRef<HTMLDivElement>(null);
  // A press activates its tab and may start a drag, so the strip must not
  // scroll under the pointer until it is released.
  const pressingRef = useRef(false);
  // Closing removes the focused close button, so focus moves on to the tab
  // that takes over, as it does in a browser.
  const refocusAfterCloseRef = useRef(false);

  useEffect(() => {
    if (stripRef.current && !pressingRef.current) revealActiveTab(stripRef.current, 'smooth');
  }, [activeTabId]);

  const holdRevealUntilRelease = () => {
    pressingRef.current = true;
    const release = new AbortController();
    const reveal = () => {
      release.abort();
      pressingRef.current = false;
      if (stripRef.current) revealActiveTab(stripRef.current, 'smooth');
    };
    window.addEventListener('pointerup', reveal, { signal: release.signal });
    window.addEventListener('pointercancel', reveal, { signal: release.signal });
    // Switching apps mid-press can swallow the release.
    window.addEventListener('blur', reveal, { signal: release.signal });
  };

  useEffect(() => {
    if (!refocusAfterCloseRef.current) return;
    refocusAfterCloseRef.current = false;
    stripRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
  }, [items]);

  // Narrowing the window or opening the sidebar shrinks the strip under the active tab.
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const observer = new ResizeObserver(() => {
      revealActiveTab(strip, 'instant');
    });
    observer.observe(strip);
    return () => {
      observer.disconnect();
    };
  }, []);

  const activate = (tabId: string) => {
    dispatch({ type: 'ACTIVATE_TAB', tabId });
  };
  const close = (tabId: string) => {
    dispatch({ type: 'CLOSE_TAB', tabId });
  };
  const moveFocus = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const target = tabIndexForKey(event.key, index, items.length);
    if (target === null) return;
    event.preventDefault();
    activate(items[target].id);
    stripRef.current?.querySelectorAll<HTMLElement>('[role="tab"]').item(target).focus();
  };

  return (
    <>
      <Reorder.Group
        ref={stripRef}
        role="tablist"
        aria-label="Tabs"
        onPointerDownCapture={holdRevealUntilRelease}
        as="div"
        axis="x"
        layoutScroll
        values={items.map((item) => item.id)}
        onReorder={(tabIds: string[]) => {
          dispatch({ type: 'REORDER_TABS', tabIds });
        }}
        className="no-drag no-scrollbar scroll-fade-x flex min-w-0 items-center gap-1 overflow-x-auto"
      >
        {items.map((item, index) => {
          const active = item.id === activeTabId;
          return (
            <Reorder.Item
              as="div"
              key={item.id}
              value={item.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
              className={`group relative flex h-7 w-[200px] min-w-[120px] items-center rounded-lg transition-colors ${
                active
                  ? 'bg-droid-elevated/60 text-droid-text'
                  : 'text-droid-text-muted hover:bg-droid-elevated/40 hover:text-droid-text'
              }`}
            >
              <HoverTooltip label={item.title} placement="bottom" className="h-full min-w-0 flex-1">
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  tabIndex={active ? 0 : -1}
                  onKeyDown={(event) => {
                    moveFocus(event, index);
                  }}
                  // Browsers switch on press, so a drag that starts on a
                  // background tab carries that tab.
                  onPointerDown={(event) => {
                    if (event.button === 0) activate(item.id);
                  }}
                  onClick={() => {
                    activate(item.id);
                  }}
                  onMouseDown={(event) => {
                    if (event.button === 1) event.preventDefault();
                  }}
                  onAuxClick={(event) => {
                    if (event.button === 1) close(item.id);
                  }}
                  // A background tab's label takes the close button's room
                  // until the button shows.
                  className={`flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-lg pl-2.5 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-droid-accent/40 ${
                    active ? 'pr-7' : 'pr-2.5 group-focus-within:pr-7 group-hover:pr-7'
                  }`}
                >
                  <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                    <TabGlyph item={item} active={active} />
                  </span>
                  <span className={`truncate text-[13px] ${active ? 'font-medium' : ''}`}>
                    {item.label}
                  </span>
                  {item.tileCount > 1 && (
                    <span className="ml-auto flex shrink-0 items-center gap-0.5 text-[11px] text-droid-text-muted">
                      <Columns className="h-3 w-3" />
                      <span aria-hidden="true">{item.tileCount}</span>
                      <span className="sr-only">, {item.tileCount} panes side by side</span>
                    </span>
                  )}
                </button>
              </HoverTooltip>
              <HoverTooltip
                label={`Close tab (${formatChord(closeTabChord)})`}
                placement="bottom"
                className="absolute right-1 top-1/2 -translate-y-1/2"
              >
                <button
                  type="button"
                  aria-label={`Close ${item.label}`}
                  tabIndex={active ? 0 : -1}
                  onPointerDown={(event) => {
                    // Closing must not first switch to the tab or start a drag.
                    event.stopPropagation();
                  }}
                  onClick={() => {
                    refocusAfterCloseRef.current =
                      stripRef.current?.contains(document.activeElement) ?? false;
                    close(item.id);
                  }}
                  className={`flex h-5 w-5 items-center justify-center rounded-md text-droid-text-muted transition-[opacity,color,background-color] hover:bg-droid-active hover:text-droid-text focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-droid-accent/40 ${
                    active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                  }`}
                >
                  <X className="h-3 w-3" />
                </button>
              </HoverTooltip>
            </Reorder.Item>
          );
        })}
      </Reorder.Group>
      <HoverTooltip label={`New tab (${formatChord(newTabChord)})`} placement="bottom">
        <button
          type="button"
          aria-label="New tab"
          onClick={() => {
            dispatch({ type: 'OPEN_NEW_CHAT_TAB' });
          }}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-droid-text-muted transition-colors hover:bg-droid-elevated/60 hover:text-droid-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-droid-accent/40"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </HoverTooltip>
    </>
  );
});
