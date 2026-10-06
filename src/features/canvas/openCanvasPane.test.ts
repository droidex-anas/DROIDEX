import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticStoreProvider, initialState, reducer } from '../../hooks/useStore';
import { sessionSummary } from '../../test/sessionSummary';
import { useOpenCanvasPane } from './openCanvasPane';

test('Open shows its named canvas without moving the chat attachment', () => {
  let state = reducer(initialState, {
    type: 'SESSION_LIST',
    sessions: [sessionSummary('chat')],
  });
  state = reducer(state, {
    type: 'SET_CANVAS_ATTACHMENT',
    appSessionId: 'chat',
    canvasId: 'canvas-B',
  });
  let open: ReturnType<typeof useOpenCanvasPane> | null = null;
  function CaptureOpener() {
    open = useOpenCanvasPane();
    return null;
  }
  renderToStaticMarkup(
    createElement(StaticStoreProvider, {
      state,
      dispatch: (action) => {
        state = reducer(state, action);
      },
      children: createElement(CaptureOpener),
    }),
  );

  assert.ok(open);
  open({ appSessionId: 'chat', canvasId: 'canvas-A', frameId: 'frame-A' });
  assert.equal(state.utilityPanels.chat?.tabs[0]?.canvasId, 'canvas-A');
  assert.equal(state.utilityPanels.chat?.tabs[0]?.frameId, 'frame-A');
  assert.equal(state.canvasAttachments.chat, 'canvas-B');

  open({ appSessionId: 'chat', canvasId: null });
  assert.equal(state.utilityPanels.chat?.tabs[0]?.canvasId, null);
  assert.equal(state.canvasAttachments.chat, 'canvas-B');
});
