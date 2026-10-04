import assert from 'node:assert/strict';
import test from 'node:test';
import { initialState, reducer, type Action, type AppState } from '../../hooks/useStore';
import { composeOrigin } from './tabNavigation';
import { activeTabDraft, loadTabStrip, saveTabStrip } from './tabStorage';
import { livePage, tabPage, type TabPage } from './tabStrip';
import { gridTiles } from './tileGrid';
import { sessionIsUnread } from '../../lib/sessions';
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

// A split tab reads as its tiles down each column, left to right, with the
// focused one starred: `a*|b`.
function pageLabel(page: TabPage): string {
  if (page.kind === 'chat') return page.appSessionId;
  if (page.kind !== 'tiles') return page.kind;
  return gridTiles(page.grid)
    .map((tile) => pageLabel(tile.page) + (tile.id === page.grid.focusedTileId ? '*' : ''))
    .join('|');
}

// What each tab shows, in strip order, with the active one marked.
function strip(state: AppState): string[] {
  const live = livePage(state);
  return state.tabStrip.tabs.map((tab) => {
    const label = pageLabel(tabPage(state.tabStrip, tab, live));
    return tab.id === state.tabStrip.activeTabId ? `[${label}]` : label;
  });
}

function tileIdShowing(state: AppState, label: string): string {
  const page = livePage(state);
  assert.ok(page.kind === 'tiles');
  const tile = gridTiles(page.grid).find((entry) => pageLabel(entry.page) === label);
  assert.ok(tile);
  return tile.id;
}

function splitWith(appSessionId: string | null): Action {
  return { type: 'SPLIT_TILE', targetTileId: null, edge: 'right', appSessionId };
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
      origin: { tabId: sendingTabId, tileId: null },
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

test('splitting a chat into a tab moves it there, focused, beside the chat shown', () => {
  const opened = reduce(withChats('a', 'b'), {
    type: 'OPEN_TAB',
    page: { kind: 'chat', appSessionId: 'b' },
  });
  const back = reduce(opened, { type: 'ACTIVATE_TAB', tabId: tabIdShowing(opened, 'a') });
  assert.deepEqual(strip(back), ['[a]', 'b']);

  const split = reduce(back, splitWith('b'));
  assert.deepEqual(strip(split), ['[a|b*]']);
  assert.equal(split.activeAppSessionId, 'b');
});

test('a chat in a tile beside the focused one reads as seen while it changes', () => {
  const split = reduce(withChats('a', 'b'), splitWith('b'));
  const finished = reduce(split, {
    type: 'SESSION_UPDATED',
    session: { ...session('a'), updatedAt: Date.now() + 60_000 },
  });
  assert.equal(finished.activeAppSessionId, 'b');
  assert.ok(!sessionIsUnread(finished.sessions.a, 'b', finished.sessionLastSeen.a));
});

test('choosing a chat focuses the tile showing it, or replaces the focused tile', () => {
  const split = reduce(withChats('a', 'b', 'c'), splitWith('b'));

  const focused = reduce(split, { type: 'SET_ACTIVE_SESSION', id: 'a' });
  assert.deepEqual(strip(focused), ['[a*|b]']);
  assert.equal(focused.activeAppSessionId, 'a');

  const replaced = reduce(focused, { type: 'SET_ACTIVE_SESSION', id: 'c' });
  assert.deepEqual(strip(replaced), ['[c*|b]']);

  const clicked = reduce(replaced, { type: 'FOCUS_TILE', tileId: tileIdShowing(replaced, 'b') });
  assert.deepEqual(strip(clicked), ['[c|b*]']);
  assert.equal(clicked.activeAppSessionId, 'b');
});

test('a chat dropped on a place shows there and leaves the tab that showed it', () => {
  const opened = reduce(withChats('a', 'b', 'c'), {
    type: 'OPEN_TAB',
    page: { kind: 'chat', appSessionId: 'c' },
  });
  const back = reduce(opened, { type: 'ACTIVATE_TAB', tabId: tabIdShowing(opened, 'a') });
  assert.deepEqual(strip(back), ['[a]', 'c']);

  const onPage = reduce(back, { type: 'DROP_CHAT', tileId: null, appSessionId: 'c' });
  assert.deepEqual(strip(onPage), ['[c]']);

  const split = reduce(back, splitWith('b'));
  const onTile = reduce(split, {
    type: 'DROP_CHAT',
    tileId: tileIdShowing(split, 'a'),
    appSessionId: 'c',
  });
  assert.deepEqual(strip(onTile), ['[c*|b]']);
  assert.equal(onTile.activeAppSessionId, 'c');
});

test('a split tab holds one new chat, and a chat sent from it opens in its tile', () => {
  const split = reduce(withChats('a'), splitWith(null));
  assert.deepEqual(strip(split), ['[a|new-chat*]']);
  assert.equal(split.activeAppSessionId, null);
  assert.equal(split.draftChat?.cwd, '/workspace');

  const again = reduce(
    split,
    { type: 'FOCUS_TILE', tileId: tileIdShowing(split, 'a') },
    splitWith(null),
  );
  assert.deepEqual(strip(again), ['[a|new-chat*]']);

  const compose = (clientRef: string): Action => ({
    type: 'SET_PENDING_COMPOSE',
    clientRef,
    text: 'hi',
    skills: [],
    files: [],
    origin: composeOrigin(again.tabStrip),
  });
  const created = reduce(again, compose('c1'), {
    type: 'SESSION_CREATED',
    clientRef: 'c1',
    session: session('n'),
  });
  assert.deepEqual(strip(created), ['[a|n*]']);
  assert.equal(created.activeAppSessionId, 'n');

  // The user moves to another tile before the create lands.
  const left = reduce(
    again,
    compose('c2'),
    { type: 'FOCUS_TILE', tileId: tileIdShowing(again, 'a') },
    { type: 'SESSION_CREATED', clientRef: 'c2', session: session('m') },
  );
  assert.deepEqual(strip(left), ['[a*|m]']);
  assert.equal(left.activeAppSessionId, 'a');
});

test('a chat sent from a tile opens nowhere once the tile is gone or shows another chat', () => {
  const split = reduce(withChats('a', 'b'), splitWith(null));
  const sent = reduce(split, {
    type: 'SET_PENDING_COMPOSE',
    clientRef: 'c1',
    text: 'hi',
    skills: [],
    files: [],
    origin: composeOrigin(split.tabStrip),
  });
  const created: Action = { type: 'SESSION_CREATED', clientRef: 'c1', session: session('n') };

  const closed = reduce(
    sent,
    { type: 'CLOSE_TILE', tileId: tileIdShowing(sent, 'new-chat') },
    created,
  );
  assert.deepEqual(strip(closed), ['[a]']);
  assert.equal(closed.activeAppSessionId, 'a');
  assert.ok(Object.hasOwn(closed.sessions, 'n'));

  const replaced = reduce(sent, { type: 'SET_ACTIVE_SESSION', id: 'b' }, created);
  assert.deepEqual(strip(replaced), ['[a|b*]']);
  assert.equal(replaced.activeAppSessionId, 'b');

  // The tab closed down to the tile is still the place the chat was sent from.
  const narrowed = reduce(sent, { type: 'CLOSE_TILE', tileId: tileIdShowing(sent, 'a') }, created);
  assert.deepEqual(strip(narrowed), ['[n]']);
  assert.equal(narrowed.activeAppSessionId, 'n');
});

test('closing a tile focuses its neighbor, and the last tile is the tab page again', () => {
  const split = reduce(withChats('a', 'b', 'c'), splitWith('b'), {
    type: 'SPLIT_TILE',
    targetTileId: null,
    edge: 'bottom',
    appSessionId: 'c',
  });
  assert.deepEqual(strip(split), ['[a|b|c*]']);

  const closed = reduce(split, { type: 'CLOSE_TILE', tileId: tileIdShowing(split, 'c') });
  assert.deepEqual(strip(closed), ['[a|b*]']);
  assert.equal(closed.activeAppSessionId, 'b');

  const single = reduce(closed, { type: 'CLOSE_TILE', tileId: tileIdShowing(closed, 'b') });
  assert.deepEqual(strip(single), ['[a]']);
  assert.equal(single.activeAppSessionId, 'a');
});

test('a focused tile closes when the session list no longer has its chat', () => {
  const listWithout = (gone: string): Action => ({
    type: 'SESSION_LIST',
    sessions: ['a', 'b', 'c'].filter((id) => id !== gone).map((id) => session(id)),
    earlierSessionsByCwd: {},
  });
  const besideDraft = reduce(withChats('a', 'b', 'c'), splitWith(null));
  const focusedA = reduce(besideDraft, {
    type: 'FOCUS_TILE',
    tileId: tileIdShowing(besideDraft, 'a'),
  });
  assert.deepEqual(strip(focusedA), ['[a*|new-chat]']);
  const draftLeft = reduce(focusedA, listWithout('a'));
  assert.deepEqual(strip(draftLeft), ['[new-chat]']);
  assert.equal(draftLeft.activeAppSessionId, null);

  const besideChat = reduce(withChats('a', 'b', 'c'), splitWith('b'), {
    type: 'SPLIT_TILE',
    targetTileId: null,
    edge: 'bottom',
    appSessionId: 'c',
  });
  assert.deepEqual(strip(besideChat), ['[a|b|c*]']);
  const chatsLeft = reduce(besideChat, listWithout('c'));
  assert.deepEqual(strip(chatsLeft), ['[a|b*]']);
  assert.equal(chatsLeft.activeAppSessionId, 'b');
});

test('a split tab keeps its tiles when a view opens, and loses an archived chat', () => {
  const split = reduce(withChats('a', 'b'), splitWith('b'));

  const viewed = reduce(split, { type: 'OPEN_PROJECTS' });
  assert.deepEqual(strip(viewed), ['a|b*', '[projects]']);
  const back = reduce(viewed, { type: 'ACTIVATE_TAB', tabId: viewed.tabStrip.tabs[0].id });
  assert.deepEqual(strip(back), ['[a|b*]', 'projects']);
  assert.equal(back.activeAppSessionId, 'b');

  const archived = reduce(back, { type: 'ARCHIVE_CHAT', appSessionId: 'b' });
  assert.deepEqual(strip(archived), ['[a]', 'projects']);
  assert.equal(archived.activeAppSessionId, 'a');
});

function withLocalStorage(run: (data: Map<string, string>) => void): void {
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
    run(data);
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  }
}

test('stored tabs load with the live page and without invalid or duplicate entries', () => {
  withLocalStorage(() => {
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
  });
});

test('a stored split tab loads whole, without a chat an earlier tab shows', () => {
  withLocalStorage((data) => {
    const state = reduce(
      withChats('a', 'b', 'c'),
      { type: 'OPEN_TAB', page: { kind: 'chat', appSessionId: 'b' } },
      splitWith('c'),
    );
    assert.deepEqual(strip(state), ['a', '[b|c*]']);
    saveTabStrip(state);
    assert.deepEqual(strip({ ...state, tabStrip: loadTabStrip() }), ['a', '[b|c*]']);

    const [key, saved] = [...data.entries()][0];
    const stored = JSON.parse(saved) as {
      tabs: {
        page: { grid: { columns: { tiles: { page: object }[] }[]; focusedTileId: string } };
      }[];
    };
    stored.tabs[1].page.grid.columns[0].tiles[0].page = { kind: 'chat', appSessionId: 'a' };
    data.set(key, JSON.stringify(stored));
    assert.deepEqual(loadTabStrip().tabs[1].page, { kind: 'chat', appSessionId: 'c' });

    stored.tabs[1].page.grid.focusedTileId = 'missing';
    data.set(key, JSON.stringify(stored));
    assert.equal(loadTabStrip().tabs.length, 1);
  });
});
