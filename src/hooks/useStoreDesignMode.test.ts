import assert from 'node:assert/strict';
import test from 'node:test';
import { initialState, reducer, type AppState } from './useStore';
import { sessionSummary } from '../test/sessionSummary';

const chat = (appSessionId: string) =>
  sessionSummary(appSessionId, { providerSessionId: `provider-${appSessionId}`, goal: 'design' });

/** Starts a draft the way the Design home does: it promises a new canvas. */
function designHome(state: AppState): AppState {
  const drafted = reducer(state, { type: 'START_CHAT', cwd: '', executionMode: 'local' });
  return reducer(drafted, { type: 'SET_CANVAS_DRAFT', canvasId: null });
}

/** Sends a draft's first message, which is what hands its canvas to a create. */
function send(state: AppState, clientRef: string): AppState {
  return reducer(state, {
    type: 'SET_PENDING_COMPOSE',
    clientRef,
    text: 'Design a pricing card',
    skills: [],
    files: [],
    originHoldId: `hold-${clientRef}`,
    canvas: state.canvasDraft ?? undefined,
  });
}

/** The create's reply: the chat now exists. */
function created(state: AppState, clientRef: string, appSessionId: string): AppState {
  return reducer(state, { type: 'SESSION_CREATED', clientRef, session: chat(appSessionId) });
}

function sendDraft(state: AppState, clientRef: string, appSessionId: string): AppState {
  return created(send(state, clientRef), clientRef, appSessionId);
}

test('the product mode persists as a sidebar preference', () => {
  assert.equal(initialState.productMode, 'chat');
  const design = reducer(initialState, { type: 'SET_PRODUCT_MODE', mode: 'design' });
  assert.equal(design.productMode, 'design');
  // Re-selecting the current mode is not a change the store has to publish.
  assert.equal(reducer(design, { type: 'SET_PRODUCT_MODE', mode: 'design' }), design);
  assert.equal(reducer(design, { type: 'SET_PRODUCT_MODE', mode: 'chat' }).productMode, 'chat');
});

test('entering Design opens its home on a folder-less draft', () => {
  const onChat = reducer(
    { ...initialState, sessions: { 'session-a': chat('session-a') }, sessionOrder: ['session-a'] },
    { type: 'SET_ACTIVE_SESSION', id: 'session-a' },
  );
  const design = reducer(onChat, { type: 'SET_PRODUCT_MODE', mode: 'design' });
  assert.equal(design.activeAppSessionId, null);
  assert.deepEqual(design.draftChat, { cwd: '', executionMode: 'local', branch: undefined });
  // The home has not been mounted yet, so nothing is owed any canvas.
  assert.equal(design.canvasDraft, null);
});

test('Chat returns to the chat Design was entered from', () => {
  const onChat = reducer(
    { ...initialState, sessions: { 'session-a': chat('session-a') }, sessionOrder: ['session-a'] },
    { type: 'SET_ACTIVE_SESSION', id: 'session-a' },
  );
  const design = designHome(reducer(onChat, { type: 'SET_PRODUCT_MODE', mode: 'design' }));
  const back = reducer(design, { type: 'SET_PRODUCT_MODE', mode: 'chat' });
  assert.equal(back.activeAppSessionId, 'session-a');
  assert.equal(back.productMode, 'chat');
  // The unsent design draft is abandoned on the way out.
  assert.equal(back.canvasDraft, null);
  // A second visit has to capture the target again rather than reuse this one.
  assert.equal(back.chatModeAppSessionId, null);
});

test('Chat stays on a draft when Design was entered from one', () => {
  const design = designHome(reducer(initialState, { type: 'SET_PRODUCT_MODE', mode: 'design' }));
  const back = reducer(design, { type: 'SET_PRODUCT_MODE', mode: 'chat' });
  assert.equal(back.activeAppSessionId, null);
  assert.equal(back.canvasDraft, null);
});

test('a Design home send consumes its intent and opens the pane for its own created chat', () => {
  const home = designHome(reducer(initialState, { type: 'SET_PRODUCT_MODE', mode: 'design' }));
  assert.deepEqual(home.canvasDraft, { canvasId: null });

  const sent = send(home, 'ref-design');
  // The pane request belongs to this create, and the draft is consumed.
  assert.deepEqual(sent.canvasChatRequests, {
    'ref-design': { appSessionId: null },
  });
  assert.equal(sent.canvasDraft, null);

  const chatExists = created(sent, 'ref-design', 'session-design');
  assert.deepEqual(chatExists.canvasChatRequests, {
    'ref-design': { appSessionId: 'session-design' },
  });

  const settled = reducer(chatExists, {
    type: 'CANVAS_CHAT_SETTLED',
    appSessionId: 'session-design',
  });
  assert.deepEqual(settled.canvasChatRequests, {});
});

test('an unrelated create cannot consume a design draft its prompt never started', () => {
  // An ordinary chat is sent first, then the user enters Design; the ordinary
  // chat's reply arrives last.
  const ordinarySent = send(
    reducer(initialState, { type: 'START_CHAT', cwd: '/repo', executionMode: 'local' }),
    'ref-ordinary',
  );
  const home = designHome(reducer(ordinarySent, { type: 'SET_PRODUCT_MODE', mode: 'design' }));
  const landed = created(home, 'ref-ordinary', 'session-ordinary');

  assert.deepEqual(landed.canvasChatRequests, {});
  assert.deepEqual(landed.canvasDraft, { canvasId: null });
});

test('a send preparing in the background consumes only its captured draft and leaves the next alone', () => {
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
    canvas: first.canvasDraft ?? undefined,
  });
  assert.deepEqual(submitted.canvasChatRequests, {
    'ref-a': { appSessionId: null },
  });
  assert.equal(submitted.canvasDraft, next.canvasDraft);
});

test('overlapping Design sends open panes for their own chats, whichever reply lands first', () => {
  const first = send(
    reducer(initialState, {
      type: 'START_CHAT',
      cwd: '',
      executionMode: 'local',
      canvas: { canvasId: 'canvas-a' },
    }),
    'ref-a',
  );
  const second = send(
    reducer(first, {
      type: 'START_CHAT',
      cwd: '',
      executionMode: 'local',
      canvas: { canvasId: 'canvas-b' },
    }),
    'ref-b',
  );

  const afterA = created(second, 'ref-a', 'chat-a');
  const afterB = created(afterA, 'ref-b', 'chat-b');
  assert.deepEqual(afterB.canvasChatRequests, {
    'ref-a': { appSessionId: 'chat-a' },
    'ref-b': { appSessionId: 'chat-b' },
  });

  // Each pane request is settled by its own chat.
  const settledA = reducer(afterB, { type: 'CANVAS_CHAT_SETTLED', appSessionId: 'chat-a' });
  assert.deepEqual(settledA.canvasChatRequests, {
    'ref-b': { appSessionId: 'chat-b' },
  });
});

test('a submitted canvas request survives navigation and the next draft', () => {
  const sent = send(designHome(initialState), 'ref-design');
  const elsewhere = reducer(sent, { type: 'SET_ACTIVE_SESSION', id: 'session-other' });
  assert.deepEqual(elsewhere.canvasChatRequests, sent.canvasChatRequests);

  const nextDraft = designHome(elsewhere);
  assert.deepEqual(nextDraft.canvasChatRequests, sent.canvasChatRequests);

  // And it still learns its chat once that create replies.
  const landed = created(nextDraft, 'ref-design', 'session-design');
  assert.deepEqual(landed.canvasChatRequests['ref-design'], {
    appSessionId: 'session-design',
  });
});

test('returning to Chat abandons only the unsent canvas intent', () => {
  const home = designHome(reducer(initialState, { type: 'SET_PRODUCT_MODE', mode: 'design' }));
  const sent = send(home, 'ref-design');
  // The home promises the next prompt a canvas too, so it has both kinds now.
  const drafting = reducer(sent, { type: 'SET_CANVAS_DRAFT', canvasId: null });

  const back = reducer(drafting, { type: 'SET_PRODUCT_MODE', mode: 'chat' });
  assert.equal(back.canvasDraft, null);
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
  assert.deepEqual(draft.canvasDraft, { canvasId: 'canvas-a' });
  assert.equal(
    reducer(draft, { type: 'SET_ACTIVE_SESSION', id: 'session-other' }).canvasDraft,
    null,
  );
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
  const onChat = reducer(
    { ...initialState, sessions: { 'session-a': chat('session-a') }, sessionOrder: ['session-a'] },
    { type: 'SET_ACTIVE_SESSION', id: 'session-a' },
  );
  const design = reducer(onChat, { type: 'SET_PRODUCT_MODE', mode: 'design' });
  assert.equal(design.chatModeAppSessionId, 'session-a');
  const archived = reducer(design, { type: 'ARCHIVE_CHAT', appSessionId: 'session-a' });
  assert.equal(archived.chatModeAppSessionId, null);
  assert.equal(
    reducer(archived, { type: 'SET_PRODUCT_MODE', mode: 'chat' }).activeAppSessionId,
    null,
  );
});
