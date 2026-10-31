import { memo, Suspense, useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Reorder } from 'framer-motion';
import { Clock, Columns, Plus, Sketch, Spinner, SquarePen, X } from '@droidex/icons';
import { useStoreDispatch, useStoreSelector, type AppState } from '../../hooks/useStore';
import { chatDisplayTitle, isDesignChat } from '../../lib/chatMetadata';
import { isRemoteClient } from '../../lib/desktop';
import { LazyCanvasTabName } from '../../lib/lazySurfaces';
import { sessionIsLive } from '../../lib/sessions';
import { PRIMARY_MODIFIER_LABEL, formatChord, hasPrimaryModifier } from '../../lib/shortcuts';
import { ActivityStatusGlyph } from '../../components/ActivityStatusGlyph';
import { Button } from '../../components/ui/Button';
import { Tooltip } from '../../components/ui/Tooltip';
import { GitPullRequestIcon } from '../../components/environment/GithubIcons';
import { ModelIcon } from '../../components/ModelIcon';
import { PROVIDER_MARKS } from '../providers/providerIdentity';
import type { ProviderKind, SessionSummary } from '../../types/bridge';
import {
  activeProduct,
  livePage,
  tabPage,
  type FocusedPage,
  type ProductMode,
  type TabPage,
} from './tabStrip';
import { focusedTile, gridTiles } from './tileGrid';

interface TabItem {
  id: string;
  kind: FocusedPage['kind'];
  label: string;
  // Chat tabs only: the harness mark, and whether a turn is running.
  provider: ProviderKind | null;
  live: boolean;
  design: boolean;
  // The canvas a design tab is named after, once it is known.
  canvasId: string | null;
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
  projects: 'Projects',
  'pull-requests': 'Pull requests',
  automations: 'Automations',
} as const;

function pageItem(state: AppState, id: string, page: FocusedPage): TabItem {
  const item = { id, provider: null, live: false, design: false, canvasId: null, tileCount: 1 };
  if (page.kind === 'new-chat') {
    const canvas = page.draft?.canvas;
    const label = canvas ? 'New design' : 'New chat';
    return {
      ...item,
      kind: 'new-chat',
      label,
      title: label,
      design: canvas !== undefined,
      canvasId: canvas?.canvasId ?? null,
    };
  }
  if (page.kind !== 'chat') {
    const label = VIEW_LABELS[page.kind];
    return { ...item, kind: page.kind, label, title: label };
  }
  // A restored tab can name a chat the first session list has not reported yet.
  const sessions: Partial<Record<string, SessionSummary>> = state.sessions;
  const session = sessions[page.appSessionId];
  if (!session) return { ...item, kind: 'chat', label: 'Chat', title: 'Chat' };
  const meta = state.chatMetadata[page.appSessionId];
  const label = chatDisplayTitle(session, meta);
  const design = isDesignChat(meta);
  return {
    ...item,
    kind: 'chat',
    label,
    title: label,
    provider: session.provider,
    live: sessionIsLive(session),
    design,
    canvasId: design ? (state.canvasAttachments[page.appSessionId] ?? null) : null,
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
        item.label === other.label &&
        item.provider === other.provider &&
        item.live === other.live &&
        item.design === other.design &&
        item.canvasId === other.canvasId &&
        item.title === other.title &&
        item.tileCount === other.tileCount
      );
    })
  );
}

function TabGlyph({ item }: { item: TabItem }) {
  switch (item.kind) {
    case 'chat':
      if (item.live) return <Spinner size={13} className="motion-safe:animate-spin-slow" />;
      if (item.design) return <Sketch className="h-3.5 w-3.5" />;
      return item.provider ? (
        <ModelIcon provider={PROVIDER_MARKS[item.provider]} size={13} />
      ) : null;
    case 'new-chat':
      return item.design ? (
        <Sketch className="h-3.5 w-3.5" />
      ) : (
        <SquarePen className="h-3.5 w-3.5" />
      );
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
              className={`group relative flex h-control-sm w-52 min-w-32 items-center rounded-md transition-colors ${
                active
                  ? 'bg-active text-primary'
                  : 'text-muted hover:bg-elevated hover:text-primary'
              }`}
            >
              <Tooltip label={item.title} placement="bottom" className="h-full min-w-0 flex-1">
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
                  className={`flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-md pl-2.5 text-left ${
                    active ? 'pr-7' : 'pr-2.5 group-focus-within:pr-7 group-hover:pr-7'
                  }`}
                >
                  <span className="flex size-icon-sm shrink-0 items-center justify-center">
                    <TabGlyph item={item} />
                  </span>
                  <span className={`truncate ${active ? 'text-body-strong' : 'text-body'}`}>
                    {item.canvasId === null ? (
                      item.label
                    ) : (
                      <Suspense fallback={item.label}>
                        <LazyCanvasTabName canvasId={item.canvasId} fallback={item.label} />
                      </Suspense>
                    )}
                  </span>
                  {item.tileCount > 1 && (
                    <span className="ml-auto flex shrink-0 items-center gap-0.5 text-caption text-muted">
                      <Columns className="size-3" />
                      <span aria-hidden="true">{item.tileCount}</span>
                      <span className="sr-only">, {item.tileCount} panes side by side</span>
                    </span>
                  )}
                </button>
              </Tooltip>
              <Tooltip
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
                  className={`flex size-5 items-center justify-center rounded-sm text-muted transition hover:bg-active hover:text-primary focus-visible:opacity-100 ${
                    active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                  }`}
                >
                  <X className="size-3" />
                </button>
              </Tooltip>
            </Reorder.Item>
          );
        })}
      </Reorder.Group>
      <NewTabButton />
    </>
  );
});

// The strip's "+" opens the focused product's kind of tab; a primary-modifier
// click opens the other one. A Remote browser only opens chats (newDraft).
function NewTabButton() {
  const dispatch = useStoreDispatch();
  const remote = isRemoteClient();
  const product = useStoreSelector((state) => (remote ? 'chat' : activeProduct(state)));
  const chord = useStoreSelector((state) => state.shortcutBindings.newTab);
  const other: ProductMode = product === 'chat' ? 'design' : 'chat';
  const otherHint = remote ? '' : ` · ${PRIMARY_MODIFIER_LABEL}-click for a ${other}`;
  return (
    <Tooltip label={`New ${product} (${formatChord(chord)})${otherHint}`} placement="bottom">
      <Button
        variant="ghost"
        size="sm"
        icon={Plus}
        aria-label={`New ${product} tab`}
        onClick={(event) => {
          dispatch({ type: 'OPEN_NEW_TAB', product: hasPrimaryModifier(event) ? other : product });
        }}
      />
    </Tooltip>
  );
}
