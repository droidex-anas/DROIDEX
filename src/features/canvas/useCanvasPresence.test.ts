import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticStoreProvider, initialState, reducer, type AppState } from '../../hooks/useStore';
import { sessionSummary } from '../../test/sessionSummary';
import type { ChildSessionSummary, TranscriptEvent } from '../../types/bridge';
import type { CanvasPresence } from './canvasPresence';
import type { CanvasFrame } from './protocol';
import { useCanvasPresence } from './useCanvasPresence';

const PRICING: CanvasFrame = {
  designId: 'pricing',
  name: 'Pricing',
  rect: { x: 0, y: 0, width: 640, height: 400 },
  layoutVersion: 0,
  manifestVersion: 0,
  revisionId: 'rev_1',
  designSystem: { id: 'droidex', version: 1, mode: 'light' },
  build: { status: 'ready', generation: 1 },
};

function child(status: ChildSessionSummary['status']): ChildSessionSummary {
  return {
    parentAppSessionId: 'chat',
    childSessionId: 'worker',
    role: 'worker',
    status,
    modelId: 'claude-opus-4-6',
    transcriptAvailable: true,
    streamFidelity: 'state',
  };
}

function transcript(
  event: Partial<TranscriptEvent> & Pick<TranscriptEvent, 'id'>,
): TranscriptEvent {
  return {
    appSessionId: 'chat',
    sourceSessionId: 'chat',
    role: 'primary',
    ts: 1,
    kind: 'text',
    ...event,
  };
}

function presenceIn(state: AppState): CanvasPresence {
  let presence: CanvasPresence | undefined;
  function Board() {
    presence = useCanvasPresence('chat', [PRICING]);
    return null;
  }
  renderToStaticMarkup(
    createElement(StaticStoreProvider, {
      state,
      dispatch: () => undefined,
      children: createElement(Board),
    }),
  );
  assert.ok(presence);
  return presence;
}

test('a subagent is at work on the frame it writes while it runs, though it has no runtime of its own', () => {
  let state = reducer(initialState, {
    type: 'SESSION_LIST',
    sessions: [sessionSummary('chat', { phase: 'running', streaming: true })],
  });
  state = reducer(state, {
    type: 'SESSION_CHILD',
    child: child('running'),
    runtimeAvailable: false,
    runtimeGeneration: 1,
  });
  for (const event of [
    transcript({ id: 'prompt', author: 'user', text: 'Polish the pricing frame' }),
    transcript({
      id: 'write',
      sourceSessionId: 'worker',
      role: 'worker',
      kind: 'tool_call',
      toolUseId: 'tu-write',
      canvasActivity: {
        toolUseId: 'tu-write',
        action: 'write',
        designIds: ['pricing'],
        state: 'running',
        message: '',
      },
    }),
  ])
    state = reducer(state, { type: 'SESSION_TRANSCRIPT', event });

  assert.equal(presenceIn(state).get('pricing')?.agent.key, 'chat/worker');
  state = reducer(state, {
    type: 'SESSION_CHILD',
    child: child('completed'),
    runtimeAvailable: false,
    runtimeGeneration: 1,
  });
  assert.equal(presenceIn(state).size, 0);
});
