import assert from 'node:assert/strict';
import test from 'node:test';
import { initialState, reducer, type Action, type AppState } from '../../hooks/useStore';
import {
  activeTabDraft,
  livePage,
  loadTabStrip,
  saveTabStrip,
  tabPage,
} from './tabStrip';
import type { SessionSummary } from '../../types/bridge';

function session(appSessionId: string, cwd = '/workspace'): SessionSummary {
  return {
    appSessionId,
    providerSessionId: `provider-${appSessionId}`,
    provider: 'droid',
    sessionPurpose: 'chat',
    interactionMode: 'auto',
    role: 'primary',
    title: appSessionId,
    goal: appSessionId,
    cwd,
    autonomy: 'low',
    phase: 'paused',
    features: [],
    tokensIn: 0,
    tokensOut: 0,
    contextTokens: 0,
    createdAt: 1,
    updatedAt: 1,
  };
}

function withChats(...ids: string[]): AppState {
  return reduce(
    { ...initialState, mainView: 'session', activeAppSessionId: null },
    { type: 'SESSION_LIST', sessions: ids.map((id) => session(id)), earlierSessionsByCwd: {} },
    { type: 'SET_ACTIVE_SESSION', id: ids[0] },
  );
}

function reduce(state: AppState, ...actions: Action[]): AppState {
  return actions.reduce(reducer, state);
}

// What each tab shows, in strip order, with the active one marked.
function strip(state: AppState): string[] {
  const live = livePage(state);
  return state.tabStrip.tabs.map((tab) => {
    const page = tabPage(state.tabStrip, tab, live);
    const label = page.kind === 'chat' ? page.appSessionId : page.kind;
    return tab.id === state.tabStrip.activeTabId ? `[${label}]` : label;
  });
}

function tabIdShowing(state: AppState, label: string): string {
  const index = strip(state).findIndex((entry) => entry.replace(/[[\]]/g, '') === label);
  return state.tabStrip.tabs[index].id;
}

test('a tab keeps the page it was left on and shows it again when entered', () => {
  const opened = reduce(withChats('a', 'b'), {
    type: 'OPEN_TAB',
    page: { kind: 'chat', appSessionId: 'b' },
  });
  assert.deepEqual(strip(opened), ['a', '[b]']);
  assert.equal(opened.activeAppSessionId, 'b');

  const browsed = reduce(opened, { type: 'OPEN_PROJECTS' });
  assert.deepEqual(strip(browsed), ['a', '[projects]']);

  const back = reduce(browsed, { type: 'ACTIVATE_TAB', tabId: tabIdShowing(browsed, 'a') });
  assert.deepEqual(strip(back), ['[a]', 'projects']);
  assert.equal(back.mainView, 'session');
  assert.equal(back.activeAppSessionId, 'a');
});

test('opening a chat or view that another tab shows focuses that tab', () => {
  const state = reduce(
    withChats('a', 'b'),
    { type: 'OPEN_TAB', page: { kind: 'chat', appSessionId: 'b' } },
    { type: 'OPEN_TAB', page: { kind: 'projects' } },
  );
  assert.deepEqual(strip(state), ['a', 'b', '[projects]']);

  const selected = reduce(state, { type: 'SET_ACTIVE_SESSION', id: 'a' });
  assert.deepEqual(strip(selected), ['[a]', 'b', 'projects']);

  const viewed = reduce(selected, { type: 'OPEN_PROJECTS' });
  assert.deepEqual(strip(viewed), ['a', 'b', '[projects]']);
  assert.equal(viewed.mainView, 'projects');
});

test('closing the active tab shows its neighbor, and reopening restores it in place', () => {
  const state = reduce(
    withChats('a', 'b', 'c'),
    { type: 'OPEN_TAB', page: { kind: 'chat', appSessionId: 'b' } },
    { type: 'OPEN_TAB', page: { kind: 'chat', appSessionId: 'c' } },
    { type: 'SET_ACTIVE_SESSION', id: 'b' },
  );
  assert.deepEqual(strip(state), ['a', '[b]', 'c']);

  const closed = reduce(state, { type: 'CLOSE_TAB', tabId: state.tabStrip.activeTabId });
  assert.deepEqual(strip(closed), ['a', '[c]']);
  assert.equal(closed.activeAppSessionId, 'c');

  const reopened = reduce(closed, { type: 'REOPEN_CLOSED_TAB' });
  assert.deepEqual(strip(reopened), ['a', '[b]', 'c']);
  assert.equal(reopened.activeAppSessionId, 'b');
});

test('closing the last tab leaves a new chat in the same workspace', () => {
  const state = withChats('a');
  const closed = reduce(state, { type: 'CLOSE_TAB', tabId: state.tabStrip.activeTabId });
  assert.deepEqual(strip(closed), ['[new-chat]']);
  assert.equal(closed.activeAppSessionId, null);
  assert.equal(closed.draftChat?.cwd, '/workspace');
  assert.deepEqual(closed.tabStrip.closedTabs, [
    { page: { kind: 'chat', appSessionId: 'a' }, index: 0 },
  ]);
});

test('a chat sent from a tab the user has left opens in that tab', () => {
  const sending = reduce(withChats('a'), { type: 'OPEN_NEW_CHAT_TAB' });
  const sendingTabId = sending.tabStrip.activeTabId;
  // The user leaves while the folder is prepared, before the compose registers.
  const created = reduce(
    sending,
    { type: 'ACTIVATE_TAB', tabId: tabIdShowing(sending, 'a') },
    {
      type: 'SET_PENDING_COMPOSE',
      clientRef: 'c1',
      text: 'hi',
      skills: [],
      files: [],
      tabId: sendingTabId,
    },
    { type: 'SESSION_CREATED', clientRef: 'c1', session: session('n') },
  );
  assert.deepEqual(strip(created), ['[a]', 'n']);
  assert.equal(created.activeAppSessionId, 'a');

  const back = reduce(created, { type: 'ACTIVATE_TAB', tabId: sendingTabId });
  assert.equal(back.activeAppSessionId, 'n');
});

test('archiving the chat a tab shows closes that tab for good', () => {
  const state = reduce(withChats('a', 'b'), {
    type: 'OPEN_TAB',
    page: { kind: 'chat', appSessionId: 'b' },
  });
  const archived = reduce(state, { type: 'ARCHIVE_CHAT', appSessionId: 'b' });
  assert.deepEqual(strip(archived), ['[a]']);
  assert.equal(archived.activeAppSessionId, 'a');
  assert.deepEqual(archived.tabStrip.closedTabs, []);

  const last = reduce(archived, { type: 'ARCHIVE_CHAT', appSessionId: 'a' });
  assert.deepEqual(strip(last), ['[new-chat]']);
  assert.equal(last.draftChat?.cwd, '/workspace');
});

test('a deleted chat leaves the tabs and the reopen list', () => {
  const state = reduce(
    withChats('a', 'b', 'c'),
    { type: 'OPEN_TAB', page: { kind: 'chat', appSessionId: 'b' } },
    { type: 'OPEN_TAB', page: { kind: 'chat', appSessionId: 'c' } },
  );
  const closedC = reduce(state, { type: 'CLOSE_TAB', tabId: tabIdShowing(state, 'c') });
  const deleted = reduce(
    closedC,
    { type: 'DELETE_CHAT', appSessionId: 'a' },
    { type: 'DELETE_CHAT', appSessionId: 'c' },
  );
  assert.deepEqual(strip(deleted), ['[b]']);
  assert.deepEqual(deleted.tabStrip.closedTabs, []);
});

test('stored tabs load with the live page and without invalid or duplicate entries', () => {
  const data = new Map<string, string>();
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
    },
  });
  try {
    const draft = { cwd: '/w', executionMode: 'local' } as const;
    saveTabStrip({
      mainView: 'session',
      activeAppSessionId: null,
      draftChat: draft,
      tabStrip: {
        tabs: [
          { id: 't1', page: { kind: 'chat', appSessionId: 'a' } },
          { id: 't2', page: { kind: 'chat', appSessionId: 'a' } },
          { id: 't3', page: { kind: 'unknown' } as never },
          { id: 't4', page: { kind: 'projects' } },
        ],
        activeTabId: 't4',
        closedTabs: [{ page: { kind: 'projects' }, index: 0 }],
      },
    });
    const loaded = loadTabStrip();
    assert.deepEqual(loaded, {
      tabs: [
        { id: 't1', page: { kind: 'chat', appSessionId: 'a' } },
        { id: 't4', page: { kind: 'new-chat', draft } },
      ],
      activeTabId: 't4',
      closedTabs: [],
    });
    assert.deepEqual(activeTabDraft(loaded), draft);
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});
