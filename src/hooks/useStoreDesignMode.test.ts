import assert from 'node:assert/strict';
import test from 'node:test';
import { initialState, reducer, type AppState } from './useStore';
import { activeProduct } from '../features/tabs/tabStrip';
import { isDesignChat } from '../lib/chatMetadata';
import { sessionSummary } from '../test/sessionSummary';

const chat = (appSessionId: string) =>
  sessionSummary(appSessionId, { providerSessionId: `provider-${appSessionId}`, goal: 'design' });

/** Starts a draft the way the Design home does: it promises a new canvas. */
function designHome(state: AppState): AppState {
  return reducer(state, {
    type: 'START_CHAT',
    cwd: '',
    executionMode: 'local',
    canvas: { canvasId: null },
  });
}

/** Sends a draft's first message, which is what hands its canvas to a create. */
function send(state: AppState, clientRef: string): AppState {
  const held = reducer(state, { type: 'HOLD_COMPOSE_ORIGIN', holdId: `hold-${clientRef}` });
  return reducer(held, {
    type: 'SET_PENDING_COMPOSE',
    clientRef,
    text: 'Design a pricing card',
    skills: [],
    files: [],
    originHoldId: `hold-${clientRef}`,
    canvas: state.draftChat?.canvas,
  });
}

/** The create's reply: the chat now exists. */
function created(state: AppState, clientRef: string, appSessionId: string): AppState {
  return reducer(state, { type: 'SESSION_CREATED', clientRef, session: chat(appSessionId) });
}

function sendDraft(state: AppState, clientRef: string, appSessionId: string): AppState {
  return created(send(state, clientRef), clientRef, appSessionId);
}

function onChat(appSessionId: string): AppState {
  return reducer(
    {
      ...initialState,
      sessions: { [appSessionId]: chat(appSessionId) },
      sessionOrder: [appSessionId],
    },
    { type: 'SET_ACTIVE_SESSION', id: appSessionId },
  );
}

test('the switch turns the focused place into the other product', () => {
  assert.equal(activeProduct(initialState), 'chat');
  const design = reducer(initialState, { type: 'SET_PRODUCT_MODE', mode: 'design' });
  assert.equal(activeProduct(design), 'design');
  // Re-selecting the current product is not a change the store has to publish.
  assert.equal(reducer(design, { type: 'SET_PRODUCT_MODE', mode: 'design' }), design);
  const back = reducer(design, { type: 'SET_PRODUCT_MODE', mode: 'chat' });
  assert.equal(activeProduct(back), 'chat');
  // The unsent design draft is abandoned on the way out.
  assert.equal(back.draftChat?.canvas, undefined);
});

test('entering Design opens its home with the selected project as local context', () => {
  const session = { ...chat('session-a'), cwd: '/repo', workspaceKind: 'folder' as const };
  const onRepoChat = reducer(
    { ...initialState, sessions: { 'session-a': session }, sessionOrder: ['session-a'] },
    { type: 'SET_ACTIVE_SESSION', id: 'session-a' },
  );
  const onDraft = reducer(initialState, {
    type: 'START_CHAT',
    cwd: '/repo',
    executionMode: 'worktree',
  });
  for (const state of [onRepoChat, onDraft]) {
    const design = reducer(state, { type: 'SET_PRODUCT_MODE', mode: 'design' });
    assert.equal(design.activeAppSessionId, null);
    assert.deepEqual(design.draftChat, {
      cwd: '/repo',
      executionMode: 'local',
      branch: undefined,
      canvas: { canvasId: null },
    });
  }
});

test('Chat returns to the chat Design was entered from', () => {
  const design = reducer(onChat('session-a'), { type: 'SET_PRODUCT_MODE', mode: 'design' });
  const back = reducer(design, { type: 'SET_PRODUCT_MODE', mode: 'chat' });
  assert.equal(back.activeAppSessionId, 'session-a');
  assert.equal(activeProduct(back), 'chat');
  // A second visit has to capture the target again rather than reuse this one.
  assert.equal(back.chatModeAppSessionId, null);
});

test('each tab keeps its own product, and a design draft keeps its canvas promise', () => {
  const designTab = reducer(initialState, { type: 'OPEN_NEW_TAB', product: 'design' });
  assert.equal(activeProduct(designTab), 'design');
  const [chatTab, newDesignTab] = designTab.tabStrip.tabs;
  const backOnChat = reducer(designTab, { type: 'ACTIVATE_TAB', tabId: chatTab.id });
  assert.equal(activeProduct(backOnChat), 'chat');
  const backOnDesign = reducer(backOnChat, { type: 'ACTIVATE_TAB', tabId: newDesignTab.id });
  assert.equal(activeProduct(backOnDesign), 'design');
  assert.deepEqual(backOnDesign.draftChat?.canvas, { canvasId: null });
});

test('a design send stays a design while it is created, and its chat opens as one', () => {
  const home = designHome(initialState);
  const sent = send(home, 'ref-design');
  // The pane request belongs to this create; the draft still shows Design.
  assert.deepEqual(sent.canvasChatRequests, { 'ref-design': { appSessionId: null } });
  assert.equal(activeProduct(sent), 'design');

  const chatExists = created(sent, 'ref-design', 'session-design');
  assert.deepEqual(chatExists.canvasChatRequests, {
    'ref-design': { appSessionId: 'session-design' },
  });
  assert.equal(chatExists.activeAppSessionId, 'session-design');
  assert.ok(isDesignChat(chatExists.chatMetadata['session-design']));
  assert.equal(activeProduct(chatExists), 'design');

  const settled = reducer(chatExists, {
    type: 'CANVAS_CHAT_SETTLED',
    appSessionId: 'session-design',
  });
  assert.deepEqual(settled.canvasChatRequests, {});
});

test('an unrelated create cannot take a design draft its prompt never started', () => {
  // An ordinary chat is sent first, then the user enters Design; the ordinary
  // chat's reply arrives last.
  const ordinarySent = send(
    reducer(initialState, { type: 'START_CHAT', cwd: '/repo', executionMode: 'local' }),
    'ref-ordinary',
  );
  const home = designHome(ordinarySent);
  const landed = created(home, 'ref-ordinary', 'session-ordinary');

  assert.deepEqual(landed.canvasChatRequests, {});
  assert.equal(isDesignChat(landed.chatMetadata['session-ordinary']), false);
});

test('a send preparing in the background leaves the next draft alone', () => {
  const first = reducer(initialState, {
    type: 'START_CHAT',
    cwd: '',
    executionMode: 'local',
    canvas: { canvasId: 'canvas-a' },
  });
  const next = reducer(first, {
    type: 'START_CHAT',
    cwd: '',
    executionMode: 'local',
    canvas: { canvasId: 'canvas-b' },
  });
  const submitted = reducer(next, {
    type: 'SET_PENDING_COMPOSE',
    clientRef: 'ref-a',
    text: 'First design',
    skills: [],
    files: [],
    originHoldId: null,
    canvas: first.draftChat?.canvas,
  });
  assert.deepEqual(submitted.canvasChatRequests, { 'ref-a': { appSessionId: null } });
  assert.equal(submitted.draftChat, next.draftChat);
});

test('overlapping Design sends open panes for their own chats, whichever reply lands first', () => {
  const draftOn = (state: AppState, canvasId: string) =>
    reducer(state, { type: 'START_CHAT', cwd: '', executionMode: 'local', canvas: { canvasId } });
  const first = send(draftOn(initialState, 'canvas-a'), 'ref-a');
  const second = send(draftOn(first, 'canvas-b'), 'ref-b');

  const afterB = created(created(second, 'ref-a', 'chat-a'), 'ref-b', 'chat-b');
  assert.deepEqual(afterB.canvasChatRequests, {
    'ref-a': { appSessionId: 'chat-a' },
    'ref-b': { appSessionId: 'chat-b' },
  });

  // Each pane request is settled by its own chat.
  const settledA = reducer(afterB, { type: 'CANVAS_CHAT_SETTLED', appSessionId: 'chat-a' });
  assert.deepEqual(settledA.canvasChatRequests, { 'ref-b': { appSessionId: 'chat-b' } });
});

test('a submitted canvas request survives navigation and the next draft', () => {
  const sent = send(designHome(initialState), 'ref-design');
  const elsewhere = reducer(sent, { type: 'SET_ACTIVE_SESSION', id: 'session-other' });
  assert.deepEqual(elsewhere.canvasChatRequests, sent.canvasChatRequests);

  const nextDraft = designHome(elsewhere);
  assert.deepEqual(nextDraft.canvasChatRequests, sent.canvasChatRequests);

  // And it still learns its chat once that create replies.
  const landed = created(nextDraft, 'ref-design', 'session-design');
  assert.deepEqual(landed.canvasChatRequests['ref-design'], { appSessionId: 'session-design' });
});

test('returning to Chat abandons only the unsent canvas intent', () => {
  const sent = send(
    reducer(initialState, { type: 'SET_PRODUCT_MODE', mode: 'design' }),
    'ref-design',
  );
  const back = reducer(sent, { type: 'SET_PRODUCT_MODE', mode: 'chat' });
  assert.equal(back.draftChat?.canvas, undefined);
  assert.deepEqual(back.canvasChatRequests, sent.canvasChatRequests);
});

test('a create that never produced a chat takes its canvas request with it', () => {
  const sent = send(designHome(initialState), 'ref-design');
  const failed = reducer(sent, { type: 'SESSION_CREATE_FAILED', clientRef: 'ref-design' });
  assert.deepEqual(failed.canvasChatRequests, {});
});

test('new chat with this canvas requests its pane; an ordinary new chat requests none', () => {
  const withCanvas = sendDraft(
    reducer(initialState, {
      type: 'START_CHAT',
      cwd: '',
      executionMode: 'local',
      canvas: { canvasId: 'canvas-shared' },
    }),
    'ref-second',
    'session-second',
  );
  assert.deepEqual(withCanvas.canvasChatRequests['ref-second'], {
    appSessionId: 'session-second',
  });

  const ordinary = sendDraft(
    reducer(withCanvas, { type: 'START_CHAT', cwd: '', executionMode: 'local' }),
    'ref-plain',
    'session-plain',
  );
  assert.equal(ordinary.canvasChatRequests['ref-plain'], undefined);
});

test('leaving an unsent design draft drops its canvas intent', () => {
  const draft = reducer(initialState, {
    type: 'START_CHAT',
    cwd: '',
    executionMode: 'local',
    canvas: { canvasId: 'canvas-a' },
  });
  assert.deepEqual(draft.draftChat?.canvas, { canvasId: 'canvas-a' });
  const left = reducer(draft, { type: 'SET_ACTIVE_SESSION', id: 'session-other' });
  assert.equal(left.draftChat, null);
});

test('a deleted chat cannot leave a pane request waiting for it', () => {
  const sent = sendDraft(
    reducer(initialState, {
      type: 'START_CHAT',
      cwd: '',
      executionMode: 'local',
      canvas: { canvasId: 'canvas-a' },
    }),
    'ref-a',
    'session-a',
  );
  const archived = reducer(sent, { type: 'ARCHIVE_CHAT', appSessionId: 'session-a' });
  assert.deepEqual(archived.canvasChatRequests, {});
});

test('a deleted chat is not the one Chat returns to', () => {
  const design = reducer(onChat('session-a'), { type: 'SET_PRODUCT_MODE', mode: 'design' });
  assert.equal(design.chatModeAppSessionId, 'session-a');
  const archived = reducer(design, { type: 'ARCHIVE_CHAT', appSessionId: 'session-a' });
  assert.equal(archived.chatModeAppSessionId, null);
  assert.equal(
    reducer(archived, { type: 'SET_PRODUCT_MODE', mode: 'chat' }).activeAppSessionId,
    null,
  );
});
