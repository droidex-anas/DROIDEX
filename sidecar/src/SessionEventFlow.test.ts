import assert from 'node:assert/strict';
import test from 'node:test';

import { MissionState, type DroidStreamEvent } from '@factory/droid-sdk';

import {
  SessionEventFlow,
  type NormalizedSideEffects,
  type NormalizedTokenUsage,
} from './SessionEventFlow.js';
import type { TranscriptEvent } from './protocol.js';
import { assistantTextDelta, successfulResultEvent } from './testing/fakeFactoryRuntime.js';

function createHarness(
  options: {
    flushError?: Error;
    childScope?: { childSessionId: string; role: 'worker' } | 'ambiguous';
  } = {},
) {
  const transcripts: TranscriptEvent[] = [];
  const sideEffects: Array<{
    appSessionId: string;
    value: NormalizedSideEffects;
  }> = [];
  const usage: Array<{
    appSessionId: string;
    sourceProviderSessionId: string;
    value: NormalizedTokenUsage;
  }> = [];
  const trace: string[] = [];
  const eventFlow = new SessionEventFlow({
    appendTranscript: (event) => {
      trace.push(`append:${event.kind}`);
      transcripts.push(event);
    },
    flushTranscript: (appSessionId, sourceSessionId) => {
      trace.push(`flush:${appSessionId}:${sourceSessionId}`);
      if (options.flushError) throw options.flushError;
    },
    applySideEffects: (appSessionId, value) => {
      trace.push(`side:${sideEffectKind(value)}`);
      sideEffects.push({ appSessionId, value });
    },
    recordUsage: (appSessionId, sourceProviderSessionId, value) => {
      trace.push('usage:tokens');
      usage.push({ appSessionId, sourceProviderSessionId, value });
    },
    resolveChildScope: () => options.childScope,
  });
  return { eventFlow, sideEffects, trace, transcripts, usage };
}

function sideEffectKind(sideEffects: NormalizedSideEffects): string {
  if (sideEffects.childSession) return 'child';
  if (sideEffects.features) return 'features';
  if (sideEffects.progress) return 'progress';
  if (sideEffects.missionState) return 'missionState';
  if (sideEffects.missionChild) return 'missionChild';
  return 'unknown';
}

function taskToolCall(toolUseId: string): DroidStreamEvent {
  return {
    type: 'tool_call',
    toolUse: {
      type: 'tool_use',
      id: toolUseId,
      name: 'Task',
      input: { subagent_type: 'worker', prompt: 'Inspect the event flow' },
    },
  };
}

function failedTaskResult(toolUseId: string): DroidStreamEvent {
  return {
    type: 'tool_result',
    toolName: 'Task',
    toolUseId,
    content: 'worker failed',
    isError: true,
  };
}

function assistantNotification(text: string): Record<string, unknown> {
  return {
    type: 'assistant_text_delta',
    messageId: `message-${text}`,
    blockIndex: 0,
    textDelta: text,
  };
}

function childNotification(providerSessionId: string): Record<string, unknown> {
  return {
    type: 'tool_progress_update',
    toolName: 'Task',
    toolUseId: 'task-notification',
    update: {
      type: 'tool_call',
      subagentSessionId: providerSessionId,
      parameters: { subagent_type: 'worker' },
    },
  };
}

test('stream ingress appends an accepted transcript before one side-effect callback', () => {
  const harness = createHarness();

  harness.eventFlow.applyStreamEvent('app-1', 'provider-1', 'primary', taskToolCall('task-1'));

  assert.deepEqual(harness.trace, ['append:tool_call', 'flush:app-1:app-1', 'side:child']);
  assert.equal(harness.transcripts[0]?.sourceSessionId, 'provider-1');
  assert.equal(harness.sideEffects.length, 1);
  assert.equal(harness.sideEffects[0]?.appSessionId, 'app-1');
});

// A subagent's rows arrive inside the parent's stream tagged with the spawn that
// started it. Where they land decides both whether the agent has any visible
// steps and whether the parent's own answer stays whole.
const childRow = (appSessionId: string) => ({
  transcript: {
    id: 'row-1',
    appSessionId,
    sourceSessionId: appSessionId,
    role: 'primary' as const,
    kind: 'tool_call' as const,
    ts: 1,
  },
  childOwner: { kind: 'tool-use' as const, id: 'toolu_1' },
});

test('a spawn-tagged row lands on its admitted agent, is dropped before admission, and stays on the parent when ambiguous', () => {
  const cases = [
    [{ childSessionId: 'child-1', role: 'worker' }, [['child-1', 'worker']]],
    [undefined, []],
    ['ambiguous', [['app-1', 'primary']]],
  ] as const;
  for (const [childScope, expected] of cases) {
    const harness = createHarness(childScope ? { childScope } : {});

    harness.eventFlow.apply('app-1', 'app-1', 'primary', childRow('app-1'));

    assert.deepEqual(
      harness.transcripts.map((event) => [event.sourceSessionId, event.role]),
      expected,
    );
  }
});

test('notification ingress converges on the same transcript gating and side-effect path', () => {
  const harness = createHarness();

  harness.eventFlow.applyNotification(
    'app-1',
    'worker-1',
    'worker',
    assistantNotification('before terminal'),
  );
  harness.eventFlow.applyStreamEvent(
    'app-1',
    'worker-1',
    'worker',
    successfulResultEvent('worker-1'),
  );
  harness.eventFlow.applyNotification(
    'app-1',
    'worker-1',
    'worker',
    assistantNotification('late tail'),
  );
  harness.eventFlow.applyNotification('app-1', 'worker-1', 'worker', childNotification('worker-2'));

  assert.deepEqual(
    harness.transcripts.map((event) => event.text),
    ['before terminal'],
  );
  assert.equal(harness.sideEffects.length, 1);
  assert.equal(harness.sideEffects[0]?.value.childSession?.providerSessionId, 'worker-2');
});

test('a new primary turn preserves an admitted child Canvas call while clearing primary bindings', () => {
  const { eventFlow, transcripts } = createHarness({
    childScope: { childSessionId: 'child-1', role: 'worker' },
  });
  const call: TranscriptEvent = {
    ...childRow('canvas-child-turn').transcript,
    toolUseId: 'same',
    toolName: 'mcp__droidex-canvas__canvas_write',
    toolArgs: { designId: 'design-1' },
  };
  eventFlow.beginTurn('canvas-child-turn', 'canvas-child-turn');
  eventFlow.apply('canvas-child-turn', 'canvas-child-turn', 'primary', { transcript: call });
  eventFlow.apply('canvas-child-turn', 'canvas-child-turn', 'primary', {
    transcript: call,
    childOwner: { kind: 'tool-use', id: 'spawn-1' },
  });
  eventFlow.beginTurn('canvas-child-turn', 'canvas-child-turn');
  const result: TranscriptEvent = {
    ...call,
    id: 'result',
    kind: 'tool_result',
    toolName: undefined,
    toolArgs: undefined,
    text: 'CANVAS_INTERNAL_GUIDANCE_7E4B',
  };
  eventFlow.apply('canvas-child-turn', 'canvas-child-turn', 'primary', {
    transcript: result,
    childOwner: { kind: 'tool-use', id: 'spawn-1' },
  });
  assert.equal(transcripts.at(-1)?.text, 'Updated design');
  assert.equal(transcripts.at(-1)?.sourceSessionId, 'child-1');
  assert.deepEqual(transcripts.at(-1)?.canvasActivity?.designIds, ['design-1']);
  eventFlow.apply('canvas-child-turn', 'canvas-child-turn', 'primary', {
    transcript: { ...result, text: 'ordinary output' },
  });
  assert.equal(transcripts.at(-1)?.text, 'ordinary output');
  assert.equal(transcripts.at(-1)?.canvasActivity, undefined);
});

test('post-terminal errors plus child, Mission, and token side effects still flow', () => {
  const harness = createHarness();
  harness.eventFlow.applyStreamEvent(
    'app-1',
    'worker-1',
    'worker',
    successfulResultEvent('worker-1'),
  );

  harness.eventFlow.applyStreamEvent('app-1', 'worker-1', 'worker', failedTaskResult('task-1'));
  harness.eventFlow.applyStreamEvent('app-1', 'worker-1', 'worker', {
    type: 'mission_state_changed',
    state: MissionState.Running,
  });
  harness.eventFlow.applyStreamEvent('app-1', 'worker-1', 'worker', {
    type: 'token_usage_update',
    inputTokens: 5,
    outputTokens: 2,
    cacheCreationTokens: 1,
    cacheReadTokens: 3,
    thinkingTokens: 0,
  });

  assert.deepEqual(harness.trace, [
    'append:tool_result',
    'flush:app-1:worker-1',
    'side:child',
    'flush:app-1:worker-1',
    'side:missionState',
    'usage:tokens',
  ]);
  assert.equal(harness.transcripts[0]?.isError, true);
  assert.equal(harness.transcripts[0]?.text, 'worker failed');
  assert.equal(harness.sideEffects[0]?.value.childSession?.done, true);
  assert.equal(harness.sideEffects[1]?.value.missionState, MissionState.Running);
  assert.deepEqual(harness.usage[0]?.value, {
    tokensIn: 9,
    tokensOut: 2,
    contextTokens: 10,
  });
});

test('notification persistence failures do not escape the SDK callback', () => {
  const harness = createHarness({ flushError: new Error('disk full') });

  assert.doesNotThrow(() => {
    harness.eventFlow.applyNotification(
      'app-1',
      'worker-1',
      'worker',
      childNotification('worker-2'),
      'child-1',
    );
  });

  assert.deepEqual(harness.trace, ['flush:app-1:child-1']);
  assert.deepEqual(harness.sideEffects, []);
});

test('primary notifications flush the stable app transcript after provider replacement', () => {
  const harness = createHarness();

  harness.eventFlow.applyNotification(
    'app-1',
    'replacement-provider-1',
    'primary',
    childNotification('worker-2'),
  );

  assert.deepEqual(harness.trace, ['flush:app-1:app-1', 'side:child']);
});

test('terminal gates are per app and source, and reopen only for the source that begins or the app that is forgotten', () => {
  const harness = createHarness();
  const text = (rows: Array<readonly [string, string, 'primary' | 'worker', string]>) => {
    for (const [app, source, role, value] of rows)
      harness.eventFlow.applyStreamEvent(app, source, role, assistantTextDelta(value));
  };
  for (const [app, source, role] of [
    ['app-1', 'primary-1', 'primary'],
    ['app-1', 'worker-1', 'worker'],
    ['app-2', 'worker-1', 'worker'],
  ] as const)
    harness.eventFlow.applyStreamEvent(app, source, role, successfulResultEvent(source));

  text([
    ['app-1', 'primary-1', 'primary', 'primary blocked'],
    ['app-1', 'worker-1', 'worker', 'worker one blocked'],
    ['app-1', 'worker-2', 'worker', 'worker two accepted'],
    ['app-2', 'primary-1', 'primary', 'other app accepted'],
  ]);
  harness.eventFlow.beginTurn('app-1', 'worker-1');
  harness.eventFlow.forgetSession('app-2');
  text([
    ['app-1', 'worker-1', 'worker', 'begun source accepted'],
    ['app-1', 'primary-1', 'primary', 'other source still blocked'],
    ['app-2', 'worker-1', 'worker', 'forgotten app accepted'],
  ]);

  assert.deepEqual(
    harness.transcripts.map((event) => event.text),
    [
      'worker two accepted',
      'other app accepted',
      'begun source accepted',
      'forgotten app accepted',
    ],
  );
});

test('Task admission carries one spawn identity: the transcript id when idless, the provider id across deltas', () => {
  const idless = createHarness();
  idless.eventFlow.applyStreamEvent('app-1', 'provider-1', 'primary', taskToolCall(''));
  const event = idless.transcripts[0];
  assert.ok(event);
  assert.equal(idless.sideEffects[0]?.value.childSession?.toolUseId, event.id);

  const harness = createHarness();
  const call = taskToolCall('stable-spawn');
  assert.equal(call.type, 'tool_call');
  if (call.type !== 'tool_call') return;
  const delta: DroidStreamEvent = { ...call, type: 'tool_call_delta' };
  harness.eventFlow.applyStreamEvent('app-1', 'provider-1', 'primary', delta);
  harness.eventFlow.applyStreamEvent('app-1', 'provider-1', 'primary', delta);
  assert.deepEqual(
    harness.sideEffects.map((effect) => effect.value.childSession?.toolUseId),
    ['stable-spawn', 'stable-spawn'],
  );
});
