// Where the store's navigation lands in the tab strip. Choosing a chat, a new
// chat or a view shows it in the focused place, unless a tab or tile already
// shows it; a strip change that focuses another place brings the live page
// there.

import type { Action, AppState } from '../../hooks/useStore';
import {
  activeGrid,
  activeTab,
  focusChatTile,
  focusTabShowing,
  focusedPage,
  isMission,
  livePage,
  openTab,
  pageShowsChat,
  tabPage,
  withTabPage,
  type FocusedPage,
  type LivePageSource,
  type Tab,
  type TabPage,
  type TabStrip,
  type TabStripSource,
  type ViewPage,
} from './tabStrip';
import { focusTile, gridTiles, newChatTile, withTilePage, type TilePage } from './tileGrid';

// The existing navigation action that shows `page` in the focused place.
function pageNavigation(page: FocusedPage): Action {
  switch (page.kind) {
    case 'chat':
      return { type: 'SET_ACTIVE_SESSION', id: page.appSessionId };
    case 'new-chat':
      return page.draft
        ? { type: 'START_CHAT', ...page.draft }
        : { type: 'SET_ACTIVE_SESSION', id: null };
    case 'projects':
      return { type: 'OPEN_PROJECTS' };
    case 'pull-requests':
      return { type: 'OPEN_PULL_REQUESTS' };
    case 'automations':
      return { type: 'OPEN_AUTOMATIONS' };
  }
}

function isSamePage(a: FocusedPage, b: FocusedPage): boolean {
  if (a.kind === 'chat' || b.kind === 'chat') {
    return a.kind === 'chat' && b.kind === 'chat' && a.appSessionId === b.appSessionId;
  }
  if (a.kind === 'new-chat' || b.kind === 'new-chat') {
    return a.kind === 'new-chat' && b.kind === 'new-chat' && a.draft === b.draft;
  }
  return a.kind === b.kind;
}

// Which place the window puts in front: the active tab, and its focused tile.
function focusKey(strip: TabStrip): string {
  return `${strip.activeTabId}/${activeGrid(strip)?.focusedTileId ?? ''}`;
}

/**
 * The navigation that brings a changed strip's focused place to the front, or
 * null when it already is. The place entered was stored when it was left.
 */
export function enteredPlaceNavigation(state: LivePageSource, next: TabStrip): Action | null {
  if (focusKey(next) === focusKey(state.tabStrip)) return null;
  const tab = next.tabs.find((entry) => entry.id === next.activeTabId);
  if (!tab) return null;
  const entered = focusedPage(tab.page);
  // A grid closing down to its focused tile keeps showing that tile's page.
  const sameTab = next.activeTabId === state.tabStrip.activeTabId;
  if (sameTab && isSamePage(entered, focusedPage(livePage(state)))) return null;
  return pageNavigation(entered);
}

/**
 * Where choosing a chat lands: the tile or tab already showing it, or its own
 * tab for a mission chosen from a split tab. Otherwise the focused place.
 */
export function showChat(state: TabStripSource, appSessionId: string): TabStrip {
  const strip = state.tabStrip;
  const live = livePage(state);
  if (pageShowsChat(live, appSessionId)) return focusChatTile(strip, live, appSessionId);
  const chat: FocusedPage = { kind: 'chat', appSessionId };
  const focused = focusTabShowing(strip, chat, live);
  if (focused !== strip || live.kind !== 'tiles' || !isMission(state, appSessionId)) return focused;
  return openTab(strip, chat, live);
}

/** A new chat in a split tab is its new-chat tile, when it has one. */
export function showNewChat(state: TabStripSource): TabStrip {
  const live = livePage(state);
  if (live.kind !== 'tiles') return state.tabStrip;
  const tile = newChatTile(live.grid);
  if (!tile || tile.id === live.grid.focusedTileId) return state.tabStrip;
  return withTabPage(state.tabStrip, state.tabStrip.activeTabId, {
    kind: 'tiles',
    grid: focusTile(live.grid, tile.id),
  });
}

/** A view goes to the tab showing it; a split tab keeps its tiles and opens it in a new tab. */
export function showView(state: TabStripSource, view: ViewPage): TabStrip {
  const live = livePage(state);
  const focused = focusTabShowing(state.tabStrip, view, live);
  if (focused !== state.tabStrip || live.kind !== 'tiles') return focused;
  return openTab(state.tabStrip, view, live);
}

/** Where a compose was sent from: its tab, and the tile it was, split or not. */
export interface ComposeOrigin {
  tabId: string;
  tileId: string;
}

export function composeOrigin(strip: TabStrip): ComposeOrigin | null {
  const tab = activeTab(strip);
  if (!tab) return null;
  const tileId = tab.page.kind === 'tiles' ? tab.page.grid.focusedTileId : tab.tileId;
  return { tabId: tab.id, tileId };
}

// A grid holds at most one new chat, so its tile names the draft.
function pageDraftTileId(tab: Tab, page: TabPage): string | null {
  if (page.kind === 'tiles') return newChatTile(page.grid)?.id ?? null;
  return page.kind === 'new-chat' ? tab.tileId : null;
}

/** The tile of the new chat the active tab shows, if it shows one. */
export function activeDraftTileId(state: LivePageSource): string | null {
  const tab = activeTab(state.tabStrip);
  return tab ? pageDraftTileId(tab, livePage(state)) : null;
}

/** The tiles of every new chat the tabs show. */
export function draftTileIds(state: LivePageSource): string[] {
  const live = livePage(state);
  return state.tabStrip.tabs.flatMap(
    (tab) => pageDraftTileId(tab, tabPage(state.tabStrip, tab, live)) ?? [],
  );
}

type ComposeOrigins = Pick<AppState, 'pendingCompose' | 'heldComposeOrigins'>;

/**
 * A compose sent from a tile that closes has no place left, whether it is
 * still preparing or already waiting for its chat. Its tab may later show a
 * new chat, but that is not the one it was sent from.
 */
export function withComposeTileClosed(state: ComposeOrigins, tileId: string): ComposeOrigins {
  const isClosed = (origin: ComposeOrigin | null | undefined) => origin?.tileId === tileId;
  const pendingCompose = { ...state.pendingCompose };
  for (const [clientRef, compose] of Object.entries(state.pendingCompose)) {
    if (compose && isClosed(compose.origin))
      pendingCompose[clientRef] = { ...compose, origin: null };
  }
  const heldComposeOrigins = { ...state.heldComposeOrigins };
  for (const [holdId, origin] of Object.entries(state.heldComposeOrigins)) {
    if (isClosed(origin)) heldComposeOrigins[holdId] = null;
  }
  return { pendingCompose, heldComposeOrigins };
}

/**
 * Where a chat sent from `origin` opens, and whether that is the focused place.
 * The tile it was sent from takes it, split or not, only while that tile still
 * shows the new chat, so no other chat or view is replaced. A mission started
 * from a split tab opens in a tab of its own.
 */
export function placeCreatedChat(
  state: TabStripSource,
  origin: ComposeOrigin | null,
  appSessionId: string,
): { tabStrip: TabStrip; focus: boolean } {
  const strip = state.tabStrip;
  const unplaced = { tabStrip: strip, focus: false };
  if (!origin) return unplaced;
  const tab = strip.tabs.find((entry) => entry.id === origin.tabId);
  if (!tab) return unplaced;
  const isActive = tab.id === strip.activeTabId;
  const live = livePage(state);
  const page = isActive ? live : tab.page;
  const chat: TilePage = { kind: 'chat', appSessionId };
  if (page.kind !== 'tiles') {
    if (origin.tileId !== tab.tileId || page.kind !== 'new-chat') return unplaced;
    return isActive
      ? { tabStrip: strip, focus: true }
      : { tabStrip: withTabPage(strip, tab.id, chat), focus: false };
  }
  const tile = gridTiles(page.grid).find(
    (entry) => entry.id === origin.tileId && entry.page.kind === 'new-chat',
  );
  if (!tile) return unplaced;
  if (isMission(state, appSessionId)) {
    return isActive ? { tabStrip: openTab(strip, chat, live), focus: true } : unplaced;
  }
  if (isActive && tile.id === page.grid.focusedTileId) return { tabStrip: strip, focus: true };
  const grid = withTilePage(page.grid, tile.id, chat);
  return { tabStrip: withTabPage(strip, tab.id, { kind: 'tiles', grid }), focus: false };
}
