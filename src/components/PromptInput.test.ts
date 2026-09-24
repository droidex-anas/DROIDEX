import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldStopTurnStarting } from './PromptInput';
import type { TranscriptEvent } from '../types/bridge';
import { hasAppContextForTranscript } from '../lib/composePrompt';
import { shouldResumeQueuedPromptAfterUpdate } from './composer/useQueuedPromptDelivery';

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
