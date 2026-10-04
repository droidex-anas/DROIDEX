// Header tabs. Each tab holds one page: a chat, a new-chat draft, two to four
// chat tiles, or one of the full-content views. The active tab always shows
// the live page, which mainView, activeAppSessionId and draftChat own; a tab's
// stored `page` is what it returns to, written when the tab is left. A split
// tab is live only in its focused tile: the active tab's stored grid still
// owns the layout and the other tiles. A chat or a view is open in at most one
// place: opening it again focuses the tab or tile showing it.

import type { AppState } from '../../hooks/useStore';
import { isEmbedded } from '../../lib/embed';
import { resolveNewChatCwd } from '../../lib/workspaces';
import {
  canSplit,
  chatTile,
  focusTile,
  focusedTile,
  gridTiles,
  moveTile,
  newChatTile,
  newTileId,
  removeTile,
  singleTileGrid,
  splitTile,
  withColumnSplit,
  withRowSplit,
  withTilePage,
  type Tile,
  type TileEdge,
  type TileGrid,
  type TilePage,
} from './tileGrid';

type NewChatDraft = NonNullable<AppState['draftChat']>;

export type TabPage =
  | { kind: 'chat'; appSessionId: string }
  | { kind: 'new-chat'; draft: NewChatDraft | null }
  | { kind: 'tiles'; grid: TileGrid }
  | { kind: 'projects' }
  | { kind: 'pull-requests' }
  | { kind: 'automations' };

// What a tab puts in front: its page, or its focused tile's when it is split.
export type FocusedPage = Exclude<TabPage, { kind: 'tiles' }>;
export type ViewPage = Extract<TabPage, { kind: 'projects' | 'pull-requests' | 'automations' }>;

export interface Tab {
  id: string;
  page: TabPage;
}

interface ClosedTab {
  page: TabPage;
  index: number;
}

export interface TabStrip {
  tabs: Tab[];
  activeTabId: string;
  // Most recently closed last.
  closedTabs: ClosedTab[];
}

export type TabAction =
  | { type: 'OPEN_TAB'; page: FocusedPage }
  | { type: 'OPEN_NEW_CHAT_TAB' }
  | { type: 'ACTIVATE_TAB'; tabId: string }
  | { type: 'CLOSE_TAB'; tabId: string }
  | { type: 'REOPEN_CLOSED_TAB' }
  | { type: 'REORDER_TABS'; tabIds: string[] }
  // Opens a chat, or a new chat when appSessionId is null, beside the target
  // tile; a null target is the focused tile, or the tab's whole page.
  | {
      type: 'SPLIT_TILE';
      targetTileId: string | null;
      edge: TileEdge;
      appSessionId: string | null;
    }
  | { type: 'MOVE_TILE'; tileId: string; targetTileId: string; edge: TileEdge | 'center' }
  | { type: 'FOCUS_TILE'; tileId: string }
  | { type: 'CLOSE_TILE'; tileId: string }
  | { type: 'RESIZE_TILE_COLUMNS'; split: number }
  | { type: 'RESIZE_TILE_ROWS'; columnIndex: number; split: number };

export type LivePageSource = Pick<
  AppState,
  'mainView' | 'activeAppSessionId' | 'draftChat' | 'tabStrip'
>;
export type TabStripSource = LivePageSource & Pick<AppState, 'sessions'>;

const MAX_CLOSED_TABS = 20;

function newTabId(): string {
  return crypto.randomUUID();
}

export function initialTabStrip(): TabStrip {
  const id = newTabId();
  return {
    tabs: [{ id, page: { kind: 'new-chat', draft: null } }],
    activeTabId: id,
    closedTabs: [],
  };
}

function liveFocusedPage(state: LivePageSource): FocusedPage {
  switch (state.mainView) {
    case 'projects':
    case 'pull-requests':
    case 'automations':
      return { kind: state.mainView };
    case 'session':
      return state.activeAppSessionId
        ? { kind: 'chat', appSessionId: state.activeAppSessionId }
        : { kind: 'new-chat', draft: state.draftChat };
  }
}

/** The active tab's grid as stored: its focused tile's page is stale, the live one wins. */
export function activeGrid(strip: TabStrip): TileGrid | null {
  const page = strip.tabs.find((tab) => tab.id === strip.activeTabId)?.page;
  return page?.kind === 'tiles' ? page.grid : null;
}

export function livePage(state: LivePageSource): TabPage {
  const focused = liveFocusedPage(state);
  const grid = activeGrid(state.tabStrip);
  if (!grid || (focused.kind !== 'chat' && focused.kind !== 'new-chat')) return focused;
  return { kind: 'tiles', grid: withTilePage(grid, grid.focusedTileId, focused) };
}

export function focusedPage(page: TabPage): FocusedPage {
  return page.kind === 'tiles' ? focusedTile(page.grid).page : page;
}

// The last tile left is the tab's whole page.
function gridPage(grid: TileGrid): TabPage {
  const tiles = gridTiles(grid);
  return tiles.length === 1 ? tiles[0].page : { kind: 'tiles', grid };
}

// What the sidebar's New chat would open from here: the active chat's
// workspace, or the current draft's.
function newChatPage(state: TabStripSource): TilePage {
  const activeSession = state.activeAppSessionId
    ? state.sessions[state.activeAppSessionId]
    : undefined;
  const cwd = resolveNewChatCwd(activeSession, state.draftChat);
  return { kind: 'new-chat', draft: { cwd, executionMode: cwd ? 'worktree' : 'local' } };
}

// Mission Control owns the whole content area, so a mission never shares a tab.
export function isMission(state: TabStripSource, appSessionId: string): boolean {
  const sessions: Partial<AppState['sessions']> = state.sessions;
  return sessions[appSessionId]?.sessionPurpose === 'mission-control';
}

export function tabPage(strip: TabStrip, tab: Tab, live: TabPage): TabPage {
  return tab.id === strip.activeTabId ? live : tab.page;
}

// A lone tab leaves the window as it was; the strip appears with the second.
export function showsTabStrip(state: Pick<AppState, 'tabStrip'>): boolean {
  return state.tabStrip.tabs.length > 1 && !isEmbedded();
}

// The collapsed sidebar moves the window controls into main's top row: the tab
// strip when it shows, otherwise the view's own header.
export function viewRowHoldsWindowControls(
  state: Pick<AppState, 'sidebarCollapsed' | 'tabStrip'>,
): boolean {
  return state.sidebarCollapsed && !showsTabStrip(state);
}

/** The chats in the active tab's tiles beside the focused one, whose stored page is stale. */
export function chatsBesideFocus(strip: TabStrip): string[] {
  const grid = activeGrid(strip);
  if (!grid) return [];
  return gridTiles(grid).flatMap((tile) =>
    tile.page.kind === 'chat' && tile.id !== grid.focusedTileId ? [tile.page.appSessionId] : [],
  );
}

/** Every chat the chat area shows: the active chat first, then the tiles beside it. */
export function chatsOnScreen(state: Pick<AppState, 'activeAppSessionId' | 'tabStrip'>): string[] {
  const beside = chatsBesideFocus(state.tabStrip);
  return state.activeAppSessionId ? [state.activeAppSessionId, ...beside] : beside;
}

export function isChatInView(
  state: Pick<AppState, 'activeAppSessionId' | 'tabStrip'>,
  appSessionId: string,
): boolean {
  return chatsOnScreen(state).includes(appSessionId);
}

export function pageShowsChat(page: TabPage, appSessionId: string): boolean {
  if (page.kind === 'chat') return page.appSessionId === appSessionId;
  return page.kind === 'tiles' && chatTile(page.grid, appSessionId) !== undefined;
}

// New-chat drafts are never the same place: each is its own tab or tile.
export function showsPlace(page: TabPage, place: FocusedPage): boolean {
  switch (place.kind) {
    case 'new-chat':
      return false;
    case 'chat':
      return pageShowsChat(page, place.appSessionId);
    default:
      return page.kind === place.kind;
  }
}

export function withTabPage(strip: TabStrip, tabId: string, page: TabPage): TabStrip {
  return { ...strip, tabs: strip.tabs.map((tab) => (tab.id === tabId ? { ...tab, page } : tab)) };
}

function withActivePageStored(strip: TabStrip, live: TabPage): Tab[] {
  return strip.tabs.map((tab) => (tab.id === strip.activeTabId ? { ...tab, page: live } : tab));
}

function activateTab(strip: TabStrip, tabId: string, live: TabPage): TabStrip {
  if (tabId === strip.activeTabId || !strip.tabs.some((tab) => tab.id === tabId)) return strip;
  return { ...strip, tabs: withActivePageStored(strip, live), activeTabId: tabId };
}

/** Focuses the active tab's tile showing the chat, when `live` is split and has one. */
export function focusChatTile(strip: TabStrip, live: TabPage, appSessionId: string): TabStrip {
  if (live.kind !== 'tiles') return strip;
  const tile = chatTile(live.grid, appSessionId);
  if (!tile || tile.id === live.grid.focusedTileId) return strip;
  return withTabPage(strip, strip.activeTabId, {
    kind: 'tiles',
    grid: focusTile(live.grid, tile.id),
  });
}

/** Switches to the tab, and the tile, already showing `place`, if another tab is. */
export function focusTabShowing(strip: TabStrip, place: FocusedPage, live: TabPage): TabStrip {
  const owner = strip.tabs.find(
    (tab) => tab.id !== strip.activeTabId && showsPlace(tab.page, place),
  );
  if (!owner) return strip;
  const entered = activateTab(strip, owner.id, live);
  if (place.kind !== 'chat') return entered;
  return focusChatTile(entered, owner.page, place.appSessionId);
}

// Shows `page` in a new tab at `index`, unless a tab or tile already shows it.
function insertTab(strip: TabStrip, page: TabPage, live: TabPage, index: number): TabStrip {
  if (page.kind !== 'tiles') {
    if (showsPlace(live, page)) {
      return page.kind === 'chat' ? focusChatTile(strip, live, page.appSessionId) : strip;
    }
    const focused = focusTabShowing(strip, page, live);
    if (focused !== strip) return focused;
  }
  const tab: Tab = { id: newTabId(), page };
  const tabs = withActivePageStored(strip, live);
  tabs.splice(index, 0, tab);
  return { ...strip, tabs, activeTabId: tab.id };
}

export function openTab(strip: TabStrip, page: FocusedPage, live: TabPage): TabStrip {
  const activeIndex = strip.tabs.findIndex((tab) => tab.id === strip.activeTabId);
  return insertTab(strip, page, live, activeIndex + 1);
}

function rememberClosed(closedTabs: ClosedTab[], closed: ClosedTab): ClosedTab[] {
  if (closed.page.kind === 'new-chat') return closedTabs;
  return [...closedTabs, closed].slice(-MAX_CLOSED_TABS);
}

// Closing the last tab leaves a fresh new-chat tab, unless it already is one.
function closeTab(strip: TabStrip, tabId: string, live: TabPage, fallback: TabPage): TabStrip {
  const index = strip.tabs.findIndex((tab) => tab.id === tabId);
  if (index === -1) return strip;
  const closingActive = tabId === strip.activeTabId;
  const page = closingActive ? live : strip.tabs[index].page;
  const closedTabs = rememberClosed(strip.closedTabs, { page, index });
  const tabs = strip.tabs.filter((tab) => tab.id !== tabId);
  if (!closingActive) return { ...strip, tabs, closedTabs };
  if (tabs.length === 0) {
    if (live.kind === 'new-chat') return strip;
    const fresh: Tab = { id: newTabId(), page: fallback };
    return { tabs: [fresh], activeTabId: fresh.id, closedTabs };
  }
  const neighbor = strip.tabs[index + 1] ?? strip.tabs[index - 1];
  return { tabs, activeTabId: neighbor.id, closedTabs };
}

/**
 * `page` without the chats `isGone` names, or null when nothing is left. With
 * `keepsFocused`, the focused place is the live page, which its own owner clears.
 */
export function pageWithoutChats(
  page: TabPage,
  isGone: (appSessionId: string) => boolean,
  keepsFocused: boolean,
): TabPage | null {
  if (page.kind === 'chat') return !keepsFocused && isGone(page.appSessionId) ? null : page;
  if (page.kind !== 'tiles') return page;
  let grid = page.grid;
  for (const tile of gridTiles(page.grid)) {
    if (tile.page.kind !== 'chat' || !isGone(tile.page.appSessionId)) continue;
    if (keepsFocused && tile.id === grid.focusedTileId) continue;
    if (gridTiles(grid).length === 1) return null;
    grid = removeTile(grid, tile.id);
  }
  return grid === page.grid ? page : gridPage(grid);
}

// The tab returns where it was, or at the end if the strip has since shrunk. A
// split tab comes back without the chats opened elsewhere since it closed.
function reopenClosedTab(strip: TabStrip, live: TabPage): TabStrip {
  const closed = strip.closedTabs.at(-1);
  if (!closed) return strip;
  const remaining = { ...strip, closedTabs: strip.closedTabs.slice(0, -1) };
  const isOpen = (appSessionId: string) =>
    strip.tabs.some((tab) => pageShowsChat(tabPage(strip, tab, live), appSessionId));
  const page =
    closed.page.kind === 'tiles' ? pageWithoutChats(closed.page, isOpen, false) : closed.page;
  if (!page) return remaining;
  return insertTab(remaining, page, live, Math.min(closed.index, strip.tabs.length));
}

function reorderTabs(strip: TabStrip, tabIds: string[]): TabStrip {
  const byId = new Map(strip.tabs.map((tab) => [tab.id, tab]));
  const tabs = tabIds.flatMap((id) => byId.get(id) ?? []);
  const isPermutation = tabs.length === strip.tabs.length && new Set(tabIds).size === tabs.length;
  if (!isPermutation || tabs.every((tab, index) => tab === strip.tabs[index])) return strip;
  return { ...strip, tabs };
}

// The live page as a grid, when it can take tiles: a chat, a new chat, or tiles.
function splittableGrid(state: TabStripSource, live: TabPage): TileGrid | null {
  if (live.kind === 'tiles') return live.grid;
  if (live.kind === 'new-chat') return singleTileGrid(live);
  if (live.kind === 'chat' && !isMission(state, live.appSessionId)) return singleTileGrid(live);
  return null;
}

/**
 * A chat brought into the active tab leaves the other open tabs; closed tabs
 * keep it, and reopening one skips it while it is open here.
 */
export function withoutOtherTabsShowing(strip: TabStrip, appSessionId: string): TabStrip {
  const isMoved = (id: string) => id === appSessionId;
  const tabs = strip.tabs.flatMap((tab) => {
    if (tab.id === strip.activeTabId) return [tab];
    const page = pageWithoutChats(tab.page, isMoved, false);
    return page ? [{ ...tab, page }] : [];
  });
  return { ...strip, tabs };
}

// A chat already in the grid moves beside the target, and a new chat focuses
// the grid's new chat when it has one. Anything else takes a new focused tile.
function splitTab(
  state: TabStripSource,
  live: TabPage,
  action: Extract<TabAction, { type: 'SPLIT_TILE' }>,
): TabStrip {
  const strip = state.tabStrip;
  const grid = splittableGrid(state, live);
  if (!grid) return strip;
  const { appSessionId, edge } = action;
  const targetTileId = action.targetTileId ?? grid.focusedTileId;
  const shown = appSessionId === null ? newChatTile(grid) : chatTile(grid, appSessionId);
  if (shown) {
    const next =
      appSessionId === null
        ? focusTile(grid, shown.id)
        : moveTile(grid, shown.id, targetTileId, edge);
    return next === grid ? strip : withTabPage(strip, strip.activeTabId, gridPage(next));
  }
  if (!canSplit(grid, targetTileId, edge)) return strip;
  if (appSessionId !== null && isMission(state, appSessionId)) return strip;
  const tile: Tile = {
    id: newTileId(),
    page: appSessionId === null ? newChatPage(state) : { kind: 'chat', appSessionId },
  };
  const split = { ...splitTile(grid, targetTileId, edge, tile), focusedTileId: tile.id };
  const others = appSessionId === null ? strip : withoutOtherTabsShowing(strip, appSessionId);
  return withTabPage(others, strip.activeTabId, { kind: 'tiles', grid: split });
}

function withLiveGrid(
  strip: TabStrip,
  live: TabPage,
  update: (grid: TileGrid) => TileGrid,
): TabStrip {
  if (live.kind !== 'tiles') return strip;
  const grid = update(live.grid);
  return grid === live.grid ? strip : withTabPage(strip, strip.activeTabId, gridPage(grid));
}

export function reduceTabStrip(state: TabStripSource, action: TabAction): TabStrip {
  const strip = state.tabStrip;
  const live = livePage(state);
  switch (action.type) {
    case 'OPEN_TAB':
      return openTab(strip, action.page, live);
    case 'OPEN_NEW_CHAT_TAB':
      return openTab(strip, newChatPage(state), live);
    case 'ACTIVATE_TAB':
      return activateTab(strip, action.tabId, live);
    case 'CLOSE_TAB':
      return closeTab(strip, action.tabId, live, newChatPage(state));
    case 'REOPEN_CLOSED_TAB':
      return reopenClosedTab(strip, live);
    case 'REORDER_TABS':
      return reorderTabs(strip, action.tabIds);
    case 'SPLIT_TILE':
      return splitTab(state, live, action);
    case 'MOVE_TILE':
      return withLiveGrid(strip, live, (grid) =>
        moveTile(grid, action.tileId, action.targetTileId, action.edge),
      );
    case 'FOCUS_TILE':
      return withLiveGrid(strip, live, (grid) => focusTile(grid, action.tileId));
    case 'CLOSE_TILE':
      return withLiveGrid(strip, live, (grid) => removeTile(grid, action.tileId));
    case 'RESIZE_TILE_COLUMNS':
      return withLiveGrid(strip, live, (grid) => withColumnSplit(grid, action.split));
    case 'RESIZE_TILE_ROWS':
      return withLiveGrid(strip, live, (grid) =>
        withRowSplit(grid, action.columnIndex, action.split),
      );
  }
}

/** Drops the chats that no longer exist from the open tabs, their tiles and the closed tabs. */
export function withoutChats(strip: TabStrip, isGone: (appSessionId: string) => boolean): TabStrip {
  const tabs = strip.tabs.flatMap((tab) => {
    const page = pageWithoutChats(tab.page, isGone, tab.id === strip.activeTabId);
    if (page === tab.page) return [tab];
    return page ? [{ ...tab, page }] : [];
  });
  const closedTabs = strip.closedTabs.flatMap((closed) => {
    const page = pageWithoutChats(closed.page, isGone, false);
    if (page === closed.page) return [closed];
    return page ? [{ ...closed, page }] : [];
  });
  if (sameEntries(tabs, strip.tabs) && sameEntries(closedTabs, strip.closedTabs)) return strip;
  return { ...strip, tabs, closedTabs };
}

export function sameEntries<T>(next: readonly T[], previous: readonly T[]): boolean {
  return next.length === previous.length && next.every((entry, index) => entry === previous[index]);
}

/** The tab `offset` places from the active one, wrapping around. */
export function adjacentTabId(strip: TabStrip, offset: 1 | -1): string {
  const index = strip.tabs.findIndex((tab) => tab.id === strip.activeTabId);
  const count = strip.tabs.length;
  return strip.tabs[(index + offset + count) % count].id;
}

/** Browser numbering: 1 to 8 pick that tab, 9 always picks the last. */
export function numberedTabId(strip: TabStrip, number: number): string | undefined {
  const index = number === 9 ? strip.tabs.length - 1 : number - 1;
  return strip.tabs[index]?.id;
}
