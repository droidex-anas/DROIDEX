import assert from 'node:assert/strict';
import test from 'node:test';
import { initialState, reducer, type AppState } from './useStore';
import { sessionSummary } from '../test/sessionSummary';

const chat = (appSessionId: string) =>
  sessionSummary(appSessionId, { providerSessionId: `provider-${appSessionId}`, goal: 'design' });

/** Sends the draft's first message, which is what creates its session. */
function sendDraft(state: AppState, clientRef: string, appSessionId: string): AppState {
  const composed = reducer(state, {
    type: 'SET_PENDING_COMPOSE',
    clientRef,
    text: 'Design a pricing card',
    skills: [],
    files: [],
    originHoldId: `hold-${clientRef}`,
  });
  return reducer(composed, { type: 'SESSION_CREATED', clientRef, session: chat(appSessionId) });
}

test('the product mode persists as a sidebar preference', () => {
  assert.equal(initialState.productMode, 'chat');
  const design = reducer(initialState, { type: 'SET_PRODUCT_MODE', mode: 'design' });
  assert.equal(design.productMode, 'design');
  // Re-selecting the current mode is not a change the store has to publish.
  assert.equal(reducer(design, { type: 'SET_PRODUCT_MODE', mode: 'design' }), design);
  assert.equal(reducer(design, { type: 'SET_PRODUCT_MODE', mode: 'chat' }).productMode, 'chat');
});

test('returning to Chat abandons a canvas no chat has taken yet', () => {
  const design = reducer(initialState, { type: 'SET_PRODUCT_MODE', mode: 'design' });
  const drafted = reducer(design, {
    type: 'START_CHAT',
    cwd: '',
    executionMode: 'local',
    canvas: { canvasId: null },
  });
  assert.equal(
    reducer(drafted, { type: 'SET_PRODUCT_MODE', mode: 'chat' }).canvasChatRequest,
    null,
  );

  // One already handed to a chat still has to land, whichever product is shown.
  const sent = sendDraft(drafted, 'ref-design', 'session-design');
  assert.deepEqual(reducer(sent, { type: 'SET_PRODUCT_MODE', mode: 'chat' }).canvasChatRequest, {
    appSessionId: 'session-design',
    canvasId: null,
  });
});

test('a Design home prompt asks for a new canvas and hands it the chat it created', () => {
  const draft = reducer(initialState, {
    type: 'START_CHAT',
    cwd: '',
    executionMode: 'local',
    canvas: { canvasId: null },
  });
  assert.deepEqual(draft.canvasChatRequest, { appSessionId: null, canvasId: null });

  const sent = sendDraft(draft, 'ref-design', 'session-design');
  // Null canvasId is the request to mint one; the chat is now named.
  assert.deepEqual(sent.canvasChatRequest, {
    appSessionId: 'session-design',
    canvasId: null,
  });

  const settled = reducer(sent, {
    type: 'CANVAS_CHAT_SETTLED',
    appSessionId: 'session-design',
  });
  assert.equal(settled.canvasChatRequest, null);
});

test('new chat with this canvas attaches the same canvas; an ordinary new chat attaches none', () => {
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
  assert.deepEqual(withCanvas.canvasChatRequest, {
    appSessionId: 'session-second',
    canvasId: 'canvas-shared',
  });

  const ordinary = sendDraft(
    reducer(withCanvas, { type: 'START_CHAT', cwd: '', executionMode: 'local' }),
    'ref-plain',
    'session-plain',
  );
  assert.equal(ordinary.canvasChatRequest, null);
});

test('leaving an unsent design draft drops its canvas request, a handed-over one survives', () => {
  const draft = reducer(initialState, {
    type: 'START_CHAT',
    cwd: '',
    executionMode: 'local',
    canvas: { canvasId: 'canvas-a' },
  });
  assert.equal(
    reducer(draft, { type: 'SET_ACTIVE_SESSION', id: 'session-other' }).canvasChatRequest,
    null,
  );

  const sent = sendDraft(draft, 'ref-a', 'session-a');
  const elsewhere = reducer(sent, { type: 'SET_ACTIVE_SESSION', id: 'session-other' });
  assert.deepEqual(elsewhere.canvasChatRequest, {
    appSessionId: 'session-a',
    canvasId: 'canvas-a',
  });
});

test('a deleted chat cannot leave an attachment waiting for it', () => {
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
  assert.equal(archived.canvasChatRequest, null);
});
