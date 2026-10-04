import assert from 'node:assert/strict';
import test from 'node:test';
import { initialState, reducer, type AppState } from './useStore';
import { sessionSummary } from '../test/sessionSummary';

const chat = (appSessionId: string) =>
  sessionSummary(appSessionId, {
    providerSessionId: `provider-${appSessionId}`,
    goal: appSessionId,
    cwd: '/workspace',
  });

function activeState(appSessionId: string): AppState {
  return {
    ...initialState,
    activeAppSessionId: appSessionId,
    rightPanelOpen: true,
    utilityPanels: {},
  };
}

const capturedChange = {
  path: 'src/app.ts',
  verb: 'edit' as const,
  ops: [{ type: 'add' as const, text: 'hello' }],
  added: 1,
  removed: 0,
};

/** Requests a Review focus on the last turn, as a transcript file click does. */
function focusReview(
  state: AppState,
  path: string | undefined,
  change?: typeof capturedChange,
): AppState {
  return reducer(state, { type: 'OPEN_REVIEW_AT', scope: 'last_turn', path, change });
}

function browser(appSessionId: string) {
  return {
    browserSessionId: `browser-${appSessionId}`,
    appSessionId,
    url: 'https://example.com/',
    viewport: { width: 1200, height: 800, deviceScaleFactor: 1 },
    viewportMode: 'fit' as const,
    scroll: { x: 0, y: 0 },
    refs: [],
  };
}

test('utility tools are session scoped and opening one hides Context', () => {
  let state = reducer(activeState('session-a'), {
    type: 'OPEN_UTILITY_TOOL',
    tool: 'browser',
  });
  assert.equal(state.rightPanelOpen, false);
  assert.equal(state.utilityPanels['session-a'].open, true);
  assert.equal(state.utilityPanels['session-a'].tabs[0].tool, 'browser');

  state = reducer(state, { type: 'SET_ACTIVE_SESSION', id: 'session-b' });
  state = reducer(state, { type: 'OPEN_UTILITY_TOOL', tool: 'files' });
  assert.equal(state.utilityPanels['session-b'].tabs[0].tool, 'files');
  assert.equal(state.utilityPanels['session-a'].tabs[0].tool, 'browser');
});

test('opening Context collapses the active session utility pane without closing tabs', () => {
  let state = reducer(activeState('session-a'), {
    type: 'OPEN_UTILITY_TOOL',
    tool: 'terminal',
    tabId: 'terminal-1',
  });
  state = reducer(state, { type: 'SET_RIGHT_PANEL', open: true });
  assert.equal(state.rightPanelOpen, true);
  assert.equal(state.utilityPanels['session-a'].open, false);
  assert.equal(state.utilityPanels['session-a'].tabs[0].id, 'terminal-1');
});

test('an explicit session id keeps delayed tab closes and updates scoped to their origin', () => {
  let state = reducer(activeState('session-a'), {
    type: 'OPEN_UTILITY_TOOL',
    tool: 'terminal',
    tabId: 'terminal-a',
  });
  state = reducer(state, { type: 'SET_ACTIVE_SESSION', id: 'session-b' });
  state = reducer(state, { type: 'OPEN_UTILITY_TOOL', tool: 'terminal', tabId: 'terminal-b' });

  const updated = reducer(state, {
    type: 'UPDATE_UTILITY_TAB',
    tabId: 'terminal-a',
    appSessionId: 'session-a',
    terminalId: 'pty-a',
    cwd: '/workspace-a',
    label: 'zsh',
  });
  assert.equal(updated.utilityPanels['session-a'].tabs[0].terminalId, 'pty-a');
  assert.equal(updated.utilityPanels['session-a'].tabs[0].cwd, '/workspace-a');
  assert.equal(updated.utilityPanels['session-a'].tabs[0].label, 'zsh');
  assert.equal(updated.utilityPanels['session-b'].tabs[0].terminalId, undefined);

  const closed = reducer(state, {
    type: 'CLOSE_UTILITY_TAB',
    tabId: 'terminal-a',
    appSessionId: 'session-a',
  });
  assert.equal(closed.utilityPanels['session-a'].tabs.length, 0);
  assert.equal(closed.utilityPanels['session-b'].tabs[0].id, 'terminal-b');
});

test('legacy Review and Browser actions route through utility tabs', () => {
  let state = reducer(activeState('session-a'), {
    type: 'SET_REVIEW_OPEN',
    open: true,
  });
  assert.equal(state.utilityPanels['session-a'].tabs[0].tool, 'review');
  state = reducer(state, { type: 'SET_BROWSER_OPEN', open: true });
  assert.deepEqual(
    state.utilityPanels['session-a'].tabs.map((tab) => tab.tool),
    ['review', 'browser'],
  );
  state = reducer(state, { type: 'SET_BROWSER_OPEN', open: false });
  assert.deepEqual(
    state.utilityPanels['session-a'].tabs.map((tab) => tab.tool),
    ['review'],
  );
});

test('background browser updates create the session browser tab', () => {
  const state = reducer(activeState('session-a'), {
    type: 'BROWSER_UPDATED',
    browser: browser('session-b'),
  });

  assert.equal(state.utilityPanels['session-b'].open, true);
  assert.equal(state.utilityPanels['session-b'].activeTabId, 'browser:session-b');
  assert.equal(state.utilityPanels['session-b'].tabs[0].tool, 'browser');
  assert.equal(state.activeAppSessionId, 'session-a');
});

test('browser updates preserve an explicitly hidden browser pane', () => {
  let state = reducer(activeState('session-a'), {
    type: 'SET_BROWSER_OPEN',
    open: true,
  });
  state = reducer(state, { type: 'SET_BROWSER_OPEN', open: false });
  state = reducer(state, {
    type: 'BROWSER_UPDATED',
    browser: browser('session-a'),
  });

  assert.equal(state.browserOpenKeys['session-a'], false);
  assert.equal(
    state.utilityPanels['session-a'].tabs.some((tab) => tab.tool === 'browser'),
    false,
  );
});

test('a session switch drops a pending review focus and its captured change', () => {
  let state = focusReview(activeState('session-a'), 'src/app.ts', capturedChange);
  assert.equal(state.reviewFocusPath, 'src/app.ts');
  assert.equal(state.reviewFocusChange, capturedChange);

  // The request belongs to session-a; it must not fire in session-b's panel.
  state = reducer(state, { type: 'SET_ACTIVE_SESSION', id: 'session-b' });
  assert.equal(state.reviewFocusPath, null);
  assert.equal(state.reviewFocusChange, null);

  // Re-selecting the already-active session keeps an in-flight request alive.
  state = focusReview(state, 'src/b.ts');
  state = reducer(state, { type: 'SET_ACTIVE_SESSION', id: 'session-b' });
  assert.equal(state.reviewFocusPath, 'src/b.ts');
});

test('starting a new chat or creating another session drops a pending review focus', () => {
  const draft = reducer(focusReview(activeState('session-a'), 'src/app.ts'), {
    type: 'START_CHAT',
    cwd: '/repo',
    executionMode: 'worktree',
  });
  assert.equal(draft.activeAppSessionId, null);
  assert.equal(draft.reviewFocusPath, null);

  let created = reducer(focusReview(activeState('session-a'), 'src/app.ts'), {
    type: 'SET_PENDING_COMPOSE',
    clientRef: 'ref-1',
    text: 'start another session',
    skills: [],
    files: [],
    tabId: initialState.tabStrip.activeTabId,
  });
  created = reducer(created, {
    type: 'SESSION_CREATED',
    clientRef: 'ref-1',
    session: chat('session-b'),
  });
  assert.equal(created.activeAppSessionId, 'session-b');
  assert.equal(created.reviewFocusPath, null);
});

test('a background resume preserves the active session review-focus request', () => {
  const state = reducer(focusReview(activeState('session-a'), 'src/app.ts'), {
    type: 'SESSION_CREATED',
    clientRef: 'resume:session-b',
    session: chat('session-b'),
  });

  assert.equal(state.activeAppSessionId, 'session-a');
  assert.equal(state.reviewFocusPath, 'src/app.ts');
});

test('each review-focus request bumps the request generation', () => {
  const first = focusReview(activeState('session-a'), 'src/app.ts');
  // A repeated click for the same file is a new request: the Review pane's
  // fallback dedupe keys on this id, so it must change to re-arm the chain.
  assert.equal(
    focusReview(first, 'src/app.ts').reviewFocusRequestId,
    first.reviewFocusRequestId + 1,
  );
});

test('closing Review clears a pending captured change even without a focus path', () => {
  let state = focusReview(activeState('session-a'), undefined, capturedChange);
  assert.equal(state.reviewFocusPath, null);
  assert.equal(state.reviewFocusChange, capturedChange);

  state = { ...state, reviewOpenAppSessionId: null, utilityPanels: {} };
  state = reducer(state, { type: 'SET_REVIEW_OPEN', open: false });
  assert.equal(state.reviewFocusChange, null);
});
