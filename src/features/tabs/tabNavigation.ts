// Where the store's navigation lands in the tab strip. Choosing a chat, a new
// chat or a view shows it in the focused place, unless a tab or tile already
// shows it; a strip change that focuses another place brings the live page
// there.

import type { Action } from '../../hooks/useStore';
import {
  activeGrid,
  focusChatTile,
  focusTabShowing,
  focusedPage,
  isMission,
  livePage,
  openTab,
  pageShowsChat,
  withTabPage,
  type FocusedPage,
  type LivePageSource,
  type TabStrip,
  type TabStripSource,
  type ViewPage,
} from './tabStrip';
import { focusTile, focusedTile, newChatTile, withTilePage, type TilePage } from './tileGrid';

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

/**
 * Where a chat started from `tabId` opens: that tab's new-chat tile when it is
 * split, otherwise its page. `focus` is whether that is the focused place. A
 * mission started from a split tab opens in a tab of its own.
 */
export function placeCreatedChat(
  state: TabStripSource,
  tabId: string,
  appSessionId: string,
): { tabStrip: TabStrip; focus: boolean } {
  const strip = state.tabStrip;
  const isActive = tabId === strip.activeTabId;
  const live = livePage(state);
  const page = isActive ? live : strip.tabs.find((tab) => tab.id === tabId)?.page;
  const chat: TilePage = { kind: 'chat', appSessionId };
  if (!page) return { tabStrip: strip, focus: false };
  if (page.kind !== 'tiles') {
    return isActive
      ? { tabStrip: strip, focus: true }
      : { tabStrip: withTabPage(strip, tabId, chat), focus: false };
  }
  if (isMission(state, appSessionId)) {
    return isActive
      ? { tabStrip: openTab(strip, chat, live), focus: true }
      : { tabStrip: strip, focus: false };
  }
  const tile = newChatTile(page.grid) ?? focusedTile(page.grid);
  if (isActive && tile.id === page.grid.focusedTileId) return { tabStrip: strip, focus: true };
  const grid = withTilePage(page.grid, tile.id, chat);
  return { tabStrip: withTabPage(strip, tabId, { kind: 'tiles', grid }), focus: false };
}
