import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldStopTurnStarting } from './PromptInput';
import type { TranscriptEvent } from '../types/bridge';
import { hasAppContextForTranscript } from '../lib/composePrompt';
import { shouldResumeQueuedPromptAfterUpdate } from './composer/useQueuedPromptDelivery';
import { initialState, reducer } from '../hooks/useStore';
import { createComposerTranscriptSelector } from './composer/composerTranscript';
import { withUpdatedTranscript } from '../lib/transcriptStoreMemory';

function transcriptEvent(id: string, fields: Partial<TranscriptEvent> = {}): TranscriptEvent {
  return {
    id,
    appSessionId: 'parent',
    sourceSessionId: 'provider-parent',
    role: 'primary',
    kind: 'text',
    text: id,
    ts: 1,
    ...fields,
  };
}

test('composer recall keeps only primary prompts, collapses duplicates, and follows replaced history', () => {
  const select = createComposerTranscriptSelector('parent', null);
  let state = reducer(initialState, {
    type: 'BATCH',
    actions: [
      transcriptEvent('first', { author: 'user', text: 'First prompt' }),
      transcriptEvent('blank', { author: 'user', text: '  ' }),
      transcriptEvent('brief', { author: 'user', role: 'worker', sourceSessionId: 'child' }),
      transcriptEvent('answer'),
      transcriptEvent('duplicate', { author: 'user', text: 'First prompt' }),
      transcriptEvent('second', { author: 'user', text: 'Second prompt' }),
      transcriptEvent('reply'),
    ].map((event) => ({ type: 'SESSION_TRANSCRIPT', event })),
  });
  assert.deepEqual(select(state).promptHistory, ['First prompt', 'Second prompt']);

  state = reducer(state, { type: 'SESSION_TRANSCRIPT', event: transcriptEvent('delta') });
  assert.deepEqual(select(state).promptHistory, ['First prompt', 'Second prompt']);
  state = reducer(state, {
    type: 'SESSION_TRANSCRIPT',
    event: transcriptEvent('third', { author: 'user', text: 'Third prompt' }),
  });
  assert.deepEqual(select(state).promptHistory, ['First prompt', 'Second prompt', 'Third prompt']);

  state = reducer(state, {
    type: 'SESSION_HISTORY',
    appSessionId: 'parent',
    mode: 'prepend',
    progress: [],
    transcripts: [transcriptEvent('older', { author: 'user', text: 'Older prompt', ts: 0 })],
  });
  assert.deepEqual(select(state).promptHistory, [
    'Older prompt',
    'First prompt',
    'Second prompt',
    'Third prompt',
  ]);
  state = withUpdatedTranscript(
    state,
    'parent',
    [transcriptEvent('replacement', { author: 'user', text: 'Replacement prompt' })],
    0,
  );
  assert.deepEqual(select(state).promptHistory, ['Replacement prompt']);
});

test('composer App context follows streamed fences for the exact target and clears on replacement', () => {
  const primary = createComposerTranscriptSelector('parent', null);
  const child = createComposerTranscriptSelector('parent', 'child');
  let state = reducer(initialState, {
    type: 'SESSION_TRANSCRIPT',
    event: transcriptEvent('primary-app', { text: '```app\n<main>Primary</main>\n' }),
  });
  assert.equal(primary(state).hasAppContext, false);
  state = reducer(state, {
    type: 'SESSION_TRANSCRIPT',
    event: transcriptEvent('close-fence', { text: '```' }),
  });
  assert.equal(primary(state).hasAppContext, true);
  assert.equal(child(state).hasAppContext, false);
  state = reducer(state, {
    type: 'SESSION_TRANSCRIPT',
    event: transcriptEvent('child-app', {
      role: 'worker',
      sourceSessionId: 'child',
      text: '```app\n<main>Child</main>\n```',
    }),
  });
  assert.equal(child(state).hasAppContext, true);

  state = withUpdatedTranscript(state, 'parent', [transcriptEvent('plain')], 0);
  assert.equal(primary(state).hasAppContext, false);
  assert.equal(child(state).hasAppContext, false);
  state = reducer(state, {
    type: 'SESSION_TRANSCRIPT',
    event: transcriptEvent('user-app', { author: 'user', text: '```app\n<main>User</main>\n```' }),
  });
  assert.equal(primary(state).hasAppContext, false);
  assert.equal(createComposerTranscriptSelector(null, null)(state).hasAppContext, false);
});

test('an idle queued prompt resumes only when an update window returns control', () => {
  assert.equal(shouldResumeQueuedPromptAfterUpdate(true, false, false, true, 'presented'), true);
  assert.equal(shouldResumeQueuedPromptAfterUpdate(true, false, false, true, 'downloaded'), false);
  assert.equal(shouldResumeQueuedPromptAfterUpdate(false, false, false, true, 'presented'), false);
  assert.equal(shouldResumeQueuedPromptAfterUpdate(true, false, true, true, 'presented'), false);
  assert.equal(shouldResumeQueuedPromptAfterUpdate(true, false, false, false, 'presented'), false);
});

test('queued primary delivery reads App context from the primary transcript', () => {
  const events: TranscriptEvent[] = [
    {
      id: 'primary-app',
      appSessionId: 'parent',
      sourceSessionId: 'provider-parent',
      role: 'primary',
      kind: 'text',
      author: 'assistant',
      text: '```app\n<main>Primary App</main>\n```',
      ts: 1,
    },
    {
      id: 'child-prose',
      appSessionId: 'parent',
      sourceSessionId: 'child-1',
      role: 'worker',
      kind: 'text',
      author: 'assistant',
      text: 'No app here',
      ts: 2,
    },
  ];
  assert.equal(hasAppContextForTranscript(events, null), true);
  assert.equal(hasAppContextForTranscript(events, 'child-1'), false);
});

test('turn-start feedback settles when creation fails or the visible target changes', () => {
  const pendingCompose = { 'client-1': {} };
  const base = {
    isLive: false,
    startingTargetKey: 'chat-draft',
    visibleTargetKey: 'chat-draft',
    pendingClientRef: 'client-1',
    pendingWasRegistered: true,
    pendingCompose,
    lastCreatedSessionRequest: null,
  };

  assert.equal(shouldStopTurnStarting(base), false);
  assert.equal(shouldStopTurnStarting({ ...base, pendingCompose: {} }), true);
  assert.equal(shouldStopTurnStarting({ ...base, visibleTargetKey: 'primary:s2' }), true);
  assert.equal(
    shouldStopTurnStarting({
      ...base,
      pendingCompose: {},
      visibleTargetKey: 'primary:created-session',
      lastCreatedSessionRequest: {
        clientRef: 'client-1',
        appSessionId: 'created-session',
      },
    }),
    false,
  );
  assert.equal(
    shouldStopTurnStarting({
      ...base,
      pendingCompose: {},
      visibleTargetKey: 'primary:unrelated-session',
      lastCreatedSessionRequest: {
        clientRef: 'client-1',
        appSessionId: 'created-session',
      },
    }),
    true,
  );
});
