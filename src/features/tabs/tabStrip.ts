// Header tabs. Each tab holds one page: a chat, a new-chat draft, or one of the
// full-content views. The active tab always shows the live page, which
// mainView, activeAppSessionId and draftChat own; a tab's stored `page` is
// what it returns to, written when the tab is left. A chat or a view is open
// in at most one tab: opening it again focuses that tab.

import type { Action, AppState } from '../../hooks/useStore';
import { isEmbedded } from '../../lib/embed';
import { resolveNewChatCwd } from '../../lib/workspaces';

type NewChatDraft = NonNullable<AppState['draftChat']>;

export type TabPage =
  | { kind: 'chat'; appSessionId: string }
  | { kind: 'new-chat'; draft: NewChatDraft | null }
  | { kind: 'projects' }
  | { kind: 'pull-requests' }
  | { kind: 'automations' };

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
  | { type: 'OPEN_TAB'; page: TabPage }
  | { type: 'OPEN_NEW_CHAT_TAB' }
  | { type: 'ACTIVATE_TAB'; tabId: string }
  | { type: 'CLOSE_TAB'; tabId: string }
  | { type: 'REOPEN_CLOSED_TAB' }
  | { type: 'REORDER_TABS'; tabIds: string[] };

type LivePageSource = Pick<AppState, 'mainView' | 'activeAppSessionId' | 'draftChat'>;
type TabStripSource = LivePageSource & Pick<AppState, 'tabStrip' | 'sessions'>;

const TAB_STRIP_STORAGE_KEY = 'droid-tab-strip';
const MAX_CLOSED_TABS = 20;
const MAX_STORED_TABS = 50;

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

export function livePage(state: LivePageSource): TabPage {
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

// What the sidebar's New chat would open from here: the active chat's
// workspace, or the current draft's.
function newChatPage(state: TabStripSource): TabPage {
  const activeSession = state.activeAppSessionId
    ? state.sessions[state.activeAppSessionId]
    : undefined;
  const cwd = resolveNewChatCwd(activeSession, state.draftChat);
  return { kind: 'new-chat', draft: { cwd, executionMode: cwd ? 'worktree' : 'local' } };
}

// The existing navigation action that shows `page` in the current tab.
export function pageNavigation(page: TabPage): Action {
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

// New-chat drafts are never the same place: each is its own tab.
function isSamePlace(a: TabPage, b: TabPage): boolean {
  if (a.kind === 'new-chat' || b.kind === 'new-chat') return false;
  if (a.kind === 'chat' || b.kind === 'chat') {
    return a.kind === 'chat' && b.kind === 'chat' && a.appSessionId === b.appSessionId;
  }
  return a.kind === b.kind;
}

function withActivePageStored(strip: TabStrip, live: TabPage): Tab[] {
  return strip.tabs.map((tab) => (tab.id === strip.activeTabId ? { ...tab, page: live } : tab));
}

function activateTab(strip: TabStrip, tabId: string, live: TabPage): TabStrip {
  if (tabId === strip.activeTabId || !strip.tabs.some((tab) => tab.id === tabId)) return strip;
  return { ...strip, tabs: withActivePageStored(strip, live), activeTabId: tabId };
}

/** Points a background tab at `page`, for when it is entered next. */
export function withTabShowing(strip: TabStrip, tabId: string, page: TabPage): TabStrip {
  if (tabId === strip.activeTabId || !strip.tabs.some((tab) => tab.id === tabId)) return strip;
  return { ...strip, tabs: strip.tabs.map((tab) => (tab.id === tabId ? { ...tab, page } : tab)) };
}

/** Switches to the tab already showing `page`, if another tab is. */
export function focusTabShowing(strip: TabStrip, page: TabPage, live: TabPage): TabStrip {
  const owner = strip.tabs.find(
    (tab) => tab.id !== strip.activeTabId && isSamePlace(tab.page, page),
  );
  return owner ? activateTab(strip, owner.id, live) : strip;
}

// Shows `page` in a new tab at `index`, unless a tab already shows it.
function insertTab(strip: TabStrip, page: TabPage, live: TabPage, index: number): TabStrip {
  if (isSamePlace(page, live)) return strip;
  const focused = focusTabShowing(strip, page, live);
  if (focused !== strip) return focused;
  const tab: Tab = { id: newTabId(), page };
  const tabs = withActivePageStored(strip, live);
  tabs.splice(index, 0, tab);
  return { ...strip, tabs, activeTabId: tab.id };
}

function openTab(strip: TabStrip, page: TabPage, live: TabPage): TabStrip {
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

// The tab returns where it was, or at the end if the strip has since shrunk.
function reopenClosedTab(strip: TabStrip, live: TabPage): TabStrip {
  const closed = strip.closedTabs.at(-1);
  if (!closed) return strip;
  const remaining = { ...strip, closedTabs: strip.closedTabs.slice(0, -1) };
  return insertTab(remaining, closed.page, live, Math.min(closed.index, strip.tabs.length));
}

function reorderTabs(strip: TabStrip, tabIds: string[]): TabStrip {
  const byId = new Map(strip.tabs.map((tab) => [tab.id, tab]));
  const tabs = tabIds.flatMap((id) => byId.get(id) ?? []);
  const isPermutation = tabs.length === strip.tabs.length && new Set(tabIds).size === tabs.length;
  if (!isPermutation || tabs.every((tab, index) => tab === strip.tabs[index])) return strip;
  return { ...strip, tabs };
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
  }
}

/**
 * Drops the open and closed tabs of chats that no longer exist. The active
 * tab is left alone: its page is the live one, which its own owner clears.
 */
export function withoutChats(strip: TabStrip, isGone: (appSessionId: string) => boolean): TabStrip {
  const keeps = (page: TabPage) => page.kind !== 'chat' || !isGone(page.appSessionId);
  const tabs = strip.tabs.filter((tab) => tab.id === strip.activeTabId || keeps(tab.page));
  const closedTabs = strip.closedTabs.filter((closed) => keeps(closed.page));
  if (tabs.length === strip.tabs.length && closedTabs.length === strip.closedTabs.length) {
    return strip;
  }
  return { ...strip, tabs, closedTabs };
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

function getLocalStorage(): Storage | undefined {
  if (typeof window !== 'undefined') return window.localStorage;
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  return descriptor && 'value' in descriptor ? (descriptor.value as Storage) : undefined;
}

function sanitizeDraft(value: unknown): NewChatDraft | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.cwd !== 'string') return null;
  if (raw.executionMode !== 'worktree' && raw.executionMode !== 'local') return null;
  return {
    cwd: raw.cwd,
    executionMode: raw.executionMode,
    ...(typeof raw.branch === 'string' ? { branch: raw.branch } : {}),
    ...(raw.project === true ? { project: true as const } : {}),
  };
}

function sanitizePage(value: unknown): TabPage | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  switch (raw.kind) {
    case 'chat':
      return typeof raw.appSessionId === 'string' && raw.appSessionId.length > 0
        ? { kind: 'chat', appSessionId: raw.appSessionId }
        : null;
    case 'new-chat':
      return { kind: 'new-chat', draft: sanitizeDraft(raw.draft) };
    case 'projects':
    case 'pull-requests':
    case 'automations':
      return { kind: raw.kind };
    default:
      return null;
  }
}

// Closed tabs stay with the window that closed them; only open tabs persist.
export function loadTabStrip(): TabStrip {
  try {
    const raw = getLocalStorage()?.getItem(TAB_STRIP_STORAGE_KEY);
    if (!raw) return initialTabStrip();
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return initialTabStrip();
    const stored = parsed as { tabs?: unknown; activeTabId?: unknown };
    if (!Array.isArray(stored.tabs)) return initialTabStrip();
    const tabs: Tab[] = [];
    for (const value of stored.tabs.slice(0, MAX_STORED_TABS) as unknown[]) {
      if (typeof value !== 'object' || value === null) continue;
      const entry = value as { id?: unknown; page?: unknown };
      const page = sanitizePage(entry.page);
      if (typeof entry.id !== 'string' || !page) continue;
      if (tabs.some((tab) => tab.id === entry.id || isSamePlace(tab.page, page))) continue;
      tabs.push({ id: entry.id, page });
    }
    if (tabs.length === 0) return initialTabStrip();
    const active = tabs.find((tab) => tab.id === stored.activeTabId) ?? tabs[0];
    return { tabs, activeTabId: active.id, closedTabs: [] };
  } catch {
    return initialTabStrip();
  }
}

/** The draft the active tab was saved on, which a launch restores as the live one. */
export function activeTabDraft(strip: TabStrip): NewChatDraft | null {
  const page = strip.tabs.find((tab) => tab.id === strip.activeTabId)?.page;
  return page?.kind === 'new-chat' ? page.draft : null;
}

// The active tab saves the live page, so a launch finds it as it was left.
export function saveTabStrip(state: LivePageSource & Pick<AppState, 'tabStrip'>): void {
  const strip = state.tabStrip;
  try {
    getLocalStorage()?.setItem(
      TAB_STRIP_STORAGE_KEY,
      JSON.stringify({
        tabs: withActivePageStored(strip, livePage(state)),
        activeTabId: strip.activeTabId,
      }),
    );
  } catch {
    // Tabs are a convenience; a full disk only costs them on the next launch.
  }
}
