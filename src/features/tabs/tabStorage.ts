// Open tabs persist across launches; closed tabs stay with the window that
// closed them. Stored tabs are untrusted: a page that does not parse is dropped,
// and so is a chat or view an earlier tab already shows.

import type { AppState } from '../../hooks/useStore';
import {
  focusedPage,
  initialTabStrip,
  livePage,
  pageWithoutChats,
  tabPage,
  type LivePageSource,
  type Tab,
  type TabPage,
  type TabStrip,
  type ViewPage,
} from './tabStrip';
import {
  MAX_COLUMNS,
  MAX_TILES_PER_COLUMN,
  clampSplit,
  gridTiles,
  type Tile,
  type TileColumn,
  type TileGrid,
  type TilePage,
} from './tileGrid';

type NewChatDraft = NonNullable<AppState['draftChat']>;

const TAB_STRIP_STORAGE_KEY = 'droid-tab-strip';

function getLocalStorage(): Storage | undefined {
  if (typeof window !== 'undefined') return window.localStorage;
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  return descriptor && 'value' in descriptor ? (descriptor.value as Storage) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function sanitizeDraft(value: unknown): NewChatDraft | null {
  if (!isRecord(value)) return null;
  if (typeof value.cwd !== 'string') return null;
  if (value.executionMode !== 'worktree' && value.executionMode !== 'local') return null;
  return {
    cwd: value.cwd,
    executionMode: value.executionMode,
    ...(typeof value.branch === 'string' ? { branch: value.branch } : {}),
    ...(value.project === true ? { project: true as const } : {}),
  };
}

function sanitizeTilePage(value: Record<string, unknown>): TilePage | null {
  if (value.kind === 'new-chat') return { kind: 'new-chat', draft: sanitizeDraft(value.draft) };
  if (value.kind !== 'chat') return null;
  return typeof value.appSessionId === 'string' && value.appSessionId.length > 0
    ? { kind: 'chat', appSessionId: value.appSessionId }
    : null;
}

function sanitizeTile(value: unknown): Tile | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !isRecord(value.page)) return null;
  const page = sanitizeTilePage(value.page);
  return page && { id: value.id, page };
}

function sanitizeColumn(value: unknown): TileColumn | null {
  if (!isRecord(value) || !Array.isArray(value.tiles) || typeof value.rowSplit !== 'number') {
    return null;
  }
  const stored: unknown[] = value.tiles;
  if (stored.length === 0 || stored.length > MAX_TILES_PER_COLUMN) return null;
  const tiles = stored.map(sanitizeTile).filter((tile) => tile !== null);
  if (tiles.length !== stored.length) return null;
  return { tiles, rowSplit: clampSplit(value.rowSplit) };
}

function gridChatIds(grid: TileGrid): string[] {
  return gridTiles(grid).flatMap((tile) =>
    tile.page.kind === 'chat' ? [tile.page.appSessionId] : [],
  );
}

// A grid that breaks its own rules is dropped whole rather than repaired:
// distinct tile ids, each chat once, at most one new chat, and two tiles or more.
function sanitizeGrid(value: unknown): TileGrid | null {
  if (!isRecord(value) || !Array.isArray(value.columns)) return null;
  if (typeof value.columnSplit !== 'number' || typeof value.focusedTileId !== 'string') {
    return null;
  }
  const stored: unknown[] = value.columns;
  if (stored.length === 0 || stored.length > MAX_COLUMNS) return null;
  const columns = stored.map(sanitizeColumn).filter((column) => column !== null);
  if (columns.length !== stored.length) return null;
  const grid: TileGrid = {
    columns,
    columnSplit: clampSplit(value.columnSplit),
    focusedTileId: value.focusedTileId,
  };
  const tiles = gridTiles(grid);
  const chats = gridChatIds(grid);
  const isValid =
    tiles.length >= 2 &&
    new Set(tiles.map((tile) => tile.id)).size === tiles.length &&
    new Set(chats).size === chats.length &&
    tiles.length - chats.length <= 1 &&
    tiles.some((tile) => tile.id === grid.focusedTileId);
  return isValid ? grid : null;
}

function pageChatIds(page: TabPage): string[] {
  if (page.kind === 'chat') return [page.appSessionId];
  return page.kind === 'tiles' ? gridChatIds(page.grid) : [];
}

function isViewPage(page: TabPage): page is ViewPage {
  return page.kind === 'projects' || page.kind === 'pull-requests' || page.kind === 'automations';
}

function sanitizePage(value: unknown): TabPage | null {
  if (!isRecord(value)) return null;
  switch (value.kind) {
    case 'tiles': {
      const grid = sanitizeGrid(value.grid);
      return grid && { kind: 'tiles', grid };
    }
    case 'projects':
    case 'pull-requests':
    case 'automations':
      return { kind: value.kind };
    default:
      return sanitizeTilePage(value);
  }
}

export function loadTabStrip(): TabStrip {
  try {
    const raw = getLocalStorage()?.getItem(TAB_STRIP_STORAGE_KEY);
    if (!raw) return initialTabStrip();
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !Array.isArray(parsed.tabs)) return initialTabStrip();
    const stored: unknown[] = parsed.tabs;
    const tabs: Tab[] = [];
    const tabIds = new Set<string>();
    const openChatIds = new Set<string>();
    const openViews = new Set<TabPage['kind']>();
    for (const entry of stored) {
      if (!isRecord(entry) || typeof entry.id !== 'string' || tabIds.has(entry.id)) continue;
      const sanitized = sanitizePage(entry.page);
      const page =
        sanitized && pageWithoutChats(sanitized, (chatId) => openChatIds.has(chatId), false);
      if (!page || openViews.has(page.kind)) continue;
      tabs.push({ id: entry.id, page, tileId: crypto.randomUUID() });
      tabIds.add(entry.id);
      for (const chatId of pageChatIds(page)) openChatIds.add(chatId);
      if (isViewPage(page)) openViews.add(page.kind);
    }
    if (tabs.length === 0) return initialTabStrip();
    const active = tabs.find((tab) => tab.id === parsed.activeTabId) ?? tabs[0];
    return { tabs, activeTabId: active.id, closedTabs: [] };
  } catch {
    return initialTabStrip();
  }
}

/** The draft the active tab was saved on, which a launch restores as the live one. */
export function activeTabDraft(strip: TabStrip): NewChatDraft | null {
  const page = strip.tabs.find((tab) => tab.id === strip.activeTabId)?.page;
  if (!page) return null;
  const focused = focusedPage(page);
  return focused.kind === 'new-chat' ? focused.draft : null;
}

// The active tab saves the live page, so a launch finds it as it was left.
export function saveTabStrip(state: LivePageSource): void {
  const strip = state.tabStrip;
  const live = livePage(state);
  try {
    getLocalStorage()?.setItem(
      TAB_STRIP_STORAGE_KEY,
      JSON.stringify({
        tabs: strip.tabs.map((tab) => ({ id: tab.id, page: tabPage(strip, tab, live) })),
        activeTabId: strip.activeTabId,
      }),
    );
  } catch {
    // Tabs are a convenience; a full disk only costs them on the next launch.
  }
}
