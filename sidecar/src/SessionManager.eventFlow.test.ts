import assert from 'node:assert/strict';
import test from 'node:test';

import type { DroidStreamEvent } from '@factory/droid-sdk';

import type { ServerEvent } from './protocol.js';
import {
  assistantTextDelta,
  FakeFactorySession,
  successfulResultEvent,
  type RecordedCall,
} from './testing/fakeFactoryRuntime.js';
import { notifyCompaction } from './testing/compactionCharacterizationScenarios.js';
import {
  createSessionManagerTestContext,
  type SessionManagerTestContext,
} from './testing/sessionManagerTestContext.js';

async function createSession(
  context: SessionManagerTestContext,
  sessionPurpose: 'chat' | 'mission-control' = 'chat',
): Promise<FakeFactorySession> {
  await context.create({
    sessionPurpose,
    clientRef: 'event-flow',
    title: 'Event flow',
    goal: 'initial',
    interactionMode: sessionPurpose === 'chat' ? 'auto' : 'agi',
    autonomy: 'low',
  });
  await context.provider.waitForPrompts('provider-1', 1);
  await context.waitForIdle();
  return context.provider.session('provider-1');
}

function send(context: SessionManagerTestContext, text: string): Promise<void> {
  return context.handle({ type: 'session.send', appSessionId: 'provider-1', text });
}

/** A Task tool call and the result that names the child provider session. */
function taskRun(toolUseId: string, subagentType: string, result: string): DroidStreamEvent[] {
  return [
    {
      type: 'tool_call',
      toolUse: {
        type: 'tool_use',
        id: toolUseId,
        name: 'Task',
        input: { subagent_type: subagentType, description: `${subagentType} work` },
      },
    },
    { type: 'tool_result', toolName: 'Task', toolUseId, content: result, isError: false },
  ];
}

function taskProgress(toolUseId: string, subagentSessionId: string): DroidStreamEvent {
  return {
    type: 'tool_progress',
    toolName: 'Task',
    toolUseId,
    content: '',
    update: {
      type: 'tool_call',
      subagentSessionId,
      parameters: { subagent_type: 'worker' },
    },
  };
}

function appendedTexts(events: ServerEvent[]): string[] {
  const texts: string[] = [];
  for (const event of events) {
    if (event.type === 'event.appended' && event.event.text) texts.push(event.event.text);
  }
  return texts;
}

function hasAppendedFrom(events: ServerEvent[], text: string, sourceSessionId: string): boolean {
  return events.some(
    (event) =>
      event.type === 'event.appended' &&
      event.event.text === text &&
      event.event.appSessionId === 'provider-1' &&
      event.event.sourceSessionId === sourceSessionId,
  );
}

function designToolPolicies(session: FakeFactorySession): unknown[] {
  return session.settings
    .filter((settings) => settings['disabledToolIds'] !== undefined)
    .map((settings) => settings['disabledToolIds']);
}

function latestSessionUpdate(events: ServerEvent[]) {
  return events
    .filter(
      (event): event is Extract<ServerEvent, { type: 'session.updated' }> =>
        event.type === 'session.updated',
    )
    .at(-1);
}

function isRecordedTranscript(call: RecordedCall, text: string): boolean {
  const event = call.args[0];
  return (
    call.target === 'history' &&
    call.method === 'recordEvent' &&
    typeof event === 'object' &&
    event !== null &&
    'text' in event &&
    event.text === text
  );
}

function isAppendedTranscript(call: RecordedCall, text: string): boolean {
  const event = call.args[0];
  if (
    call.target !== 'protocol' ||
    call.method !== 'event' ||
    typeof event !== 'object' ||
    event === null ||
    !('type' in event) ||
    event.type !== 'event.appended' ||
    !('event' in event) ||
    typeof event.event !== 'object' ||
    event.event === null
  )
    return false;
  return 'text' in event.event && event.event.text === text;
}

test('design turns synchronize TodoWrite and unexpected AbortErrors fail the turn', async () => {
  const context = createSessionManagerTestContext();
  try {
    const provider = await createSession(context);

    await send(
      context,
      'Design Mode reference pack:\n- URL: about:blank\n\nUser instruction:\nMake the hero cleaner',
    );
    await send(context, 'restore normal tools');
    await send(context, 'normal tools stay restored');

    assert.deepEqual(designToolPolicies(provider), [[], ['TodoWrite'], []]);

    const abort = new Error('The operation was aborted');
    abort.name = 'AbortError';
    provider.nextStreamError = abort;
    await send(context, 'unexpected abort');

    assert.equal(
      context.events.some(
        (event) =>
          event.type === 'error' &&
          event.appSessionId === 'provider-1' &&
          event.message === abort.message,
      ),
      true,
    );
    assert.equal(latestSessionUpdate(context.events)?.session.phase, 'failed');
  } finally {
    await context.dispose();
  }
});

test('a buffered streaming tail is emitted before failed turn settlement', async () => {
  const context = createSessionManagerTestContext({ streamingCoalesceMs: 1_000 });
  try {
    const provider = await createSession(context);
    context.events.length = 0;

    provider.queueStreamEvents([assistantTextDelta('buffered before failure')]);
    provider.nextStreamError = new Error('provider failed');
    await send(context, 'fail after a partial response');
    await context.waitForIdle();

    const appendedIndex = context.events.findIndex(
      (event) => event.type === 'event.appended' && event.event.text === 'buffered before failure',
    );
    const errorIndex = context.events.findIndex(
      (event) => event.type === 'error' && event.message === 'provider failed',
    );
    const failedIndex = context.events.findIndex(
      (event) => event.type === 'session.updated' && event.session.phase === 'failed',
    );
    const errorRows = context.events.flatMap((event) =>
      event.type === 'event.appended' && event.event.kind === 'error' ? [event.event] : [],
    );
    assert.equal(errorRows.length, 1);
    assert.equal(errorRows[0]?.text, 'provider failed');
    assert.ok(appendedIndex >= 0);
    assert.ok(errorIndex > appendedIndex);
    assert.ok(failedIndex > errorIndex);
  } finally {
    await context.dispose();
  }
});

test('primary streaming persistence failures still settle and refresh context', async () => {
  const context = createSessionManagerTestContext({ streamingCoalesceMs: 1_000 });
  try {
    const provider = await createSession(context);
    const contextStatsCallsBeforeTurn = provider.contextStatsCalls;
    context.events.length = 0;

    provider.queueStreamEvents([assistantTextDelta('cannot persist this tail')]);
    context.history.recordEventErrorForText = {
      text: 'cannot persist this tail',
      error: new Error('history write failed'),
    };
    await send(context, 'trigger a streaming persistence failure');
    await context.waitForIdle();

    assert.equal(
      context.events.filter(
        (event) =>
          event.type === 'error' &&
          event.message === 'Could not persist streaming transcript: history write failed',
      ).length,
      1,
    );
    assert.equal(latestSessionUpdate(context.events)?.session.phase, 'failed');
    assert.ok(provider.contextStatsCalls >= contextStatsCallsBeforeTurn + 2);
    assert.equal(appendedTexts(context.events).includes('cannot persist this tail'), false);
  } finally {
    await context.dispose();
  }
});

test('terminal results quarantine only later generation from the same turn', async () => {
  const context = createSessionManagerTestContext();
  try {
    const provider = await createSession(context);
    context.history.seedSessionLaunchSettings('worker-1', { modelId: 'model-default' });
    context.events.length = 0;
    provider.queueStreamEvents([
      assistantTextDelta('final answer'),
      successfulResultEvent('provider-1'),
      assistantTextDelta('leaked tail'),
      {
        type: 'tool_call',
        toolUse: {
          type: 'tool_use',
          id: 'task-1',
          name: 'Task',
          input: { subagent_type: 'worker' },
        },
      },
      taskProgress('task-1', 'worker-1'),
      {
        type: 'tool_result',
        toolName: 'Execute',
        toolUseId: 'execute-1',
        content: 'boom',
        isError: true,
      },
    ]);
    await send(context, 'terminal turn');

    const recordIndex = context.calls.findIndex((call) =>
      isRecordedTranscript(call, 'final answer'),
    );
    const emitIndex = context.calls.findIndex((call) => isAppendedTranscript(call, 'final answer'));
    assert.ok(recordIndex >= 0);
    assert.ok(emitIndex > recordIndex);
    assert.deepEqual(appendedTexts(context.events), ['final answer', 'boom']);
    assert.equal(
      context.events.some(
        (event) =>
          event.type === 'session.child' &&
          event.child.status === 'running' &&
          event.child.childSessionId === 'child-1',
      ),
      true,
    );
    assert.equal(
      context.events.some(
        (event) =>
          event.type === 'event.appended' &&
          event.event.kind === 'tool_call' &&
          event.event.toolName === 'Task',
      ),
      false,
    );

    provider.queueStreamEvents([assistantTextDelta('next turn answer')]);
    await send(context, 'next turn');
    assert.equal(appendedTexts(context.events).includes('next turn answer'), true);
  } finally {
    await context.dispose();
  }
});

test('terminal enforcement is scoped to each provider and includes notification events', async () => {
  const context = createSessionManagerTestContext();
  try {
    const primary = await createSession(context, 'mission-control');
    context.history.seedSessionLaunchSettings('worker-logical', { modelId: 'model-default' });
    primary.queueStreamEvents([taskProgress('task-1', 'worker-logical')]);
    await send(context, 'spawn worker');
    const worker = new FakeFactorySession('worker-backend', {}, context.calls);
    context.runtime.loadQueue.set('worker-logical', [worker]);
    await context.handle({
      type: 'child.open',
      parentAppSessionId: 'provider-1',
      childSessionId: 'child-1',
      requestId: 'open-child-1',
    });

    // The primary's turn is terminal; the child's notifications and its own
    // turn still land on the parent's transcript under the child's identity.
    context.provider.emitNotification('worker-backend', {
      type: 'assistant_text_delta',
      messageId: 'worker-message-1',
      blockIndex: 0,
      textDelta: 'worker notification before terminal',
    });
    assert.equal(
      hasAppendedFrom(context.events, 'worker notification before terminal', 'child-1'),
      true,
    );

    worker.queueStreamEvents([assistantTextDelta('worker still talking')]);
    await context.handle({
      type: 'child.send',
      parentAppSessionId: 'provider-1',
      childSessionId: 'child-1',
      text: 'worker turn',
    });
    assert.equal(hasAppendedFrom(context.events, 'worker still talking', 'child-1'), true);

    context.provider.emitNotification('worker-backend', {
      type: 'assistant_text_delta',
      messageId: 'worker-message-2',
      blockIndex: 0,
      textDelta: 'late worker tail',
    });
    assert.equal(appendedTexts(context.events).includes('late worker tail'), false);
  } finally {
    await context.dispose();
  }
});

test('current SDK Task result persists and opens the exact completed child', async () => {
  const context = createSessionManagerTestContext();
  try {
    const provider = await createSession(context);
    context.history.seedSessionLaunchSettings('provider-child-current', {
      modelId: 'model-default',
    });
    provider.queueStreamEvents(
      taskRun('task-current', 'worker', 'session_id: provider-child-current\nCHILD_SMOKE_OK'),
    );
    await send(context, 'spawn worker');

    const child = context.history.childSessions('provider-1')[0];
    assert.equal(child?.parentAppSessionId, 'provider-1');
    assert.equal(child?.childSessionId, 'child-1');
    assert.equal(child?.providerSessionId, 'provider-child-current');
    assert.equal(child?.status, 'completed');
    assert.equal(child?.transcriptAvailable, true);
    assert.deepEqual(child?.spawnLink, { kind: 'tool-use', id: 'task-current' });

    await context.handle({
      type: 'child.open',
      parentAppSessionId: 'provider-1',
      childSessionId: 'child-1',
      requestId: 'open-current-child',
    });
    assert.equal(
      context.events.some(
        (event) =>
          event.type === 'child.updated' &&
          event.access === 'history' &&
          event.parentAppSessionId === 'provider-1' &&
          event.childSessionId === 'child-1' &&
          event.requestId === 'open-current-child',
      ),
      true,
    );
  } finally {
    await context.dispose();
  }
});

// An idle parent is woken once its background agent finishes; the wake waits for
// either kind of compaction to complete first.
for (const compaction of ['manual', 'automatic'] as const)
  test(`background Task completion wakes once after ${compaction} compaction`, async () => {
    const context = createSessionManagerTestContext();
    try {
      const provider = await createSession(context);
      context.events.length = 0;
      context.history.seedSessionLaunchSettings('provider-child-background', {
        modelId: 'custom:glm-5.2',
        reasoningEffort: 'max',
      });

      provider.queueStreamEvents(
        taskRun(
          'task-background',
          'worker-2',
          'Task launched in background.\ntask_id: provider-child-background\nsession_id: provider-child-background',
        ),
      );
      await send(context, 'launch background worker');

      const launched = context.history.childSessions('provider-1')[0];
      assert.equal(launched?.status, 'running');
      assert.equal(launched?.label, 'worker-2');
      assert.equal(launched?.modelId, 'custom:glm-5.2');
      assert.equal(launched?.reasoningEffort, 'max');

      const compactGate =
        compaction === 'manual' ? context.provider.deferNextCompaction('provider-1') : undefined;
      const compacting =
        compaction === 'manual'
          ? context.handle({ type: 'session.compact', appSessionId: 'provider-1' })
          : undefined;
      if (compaction === 'automatic') notifyCompaction(context, 'provider-1', 'started');
      await context.waitForIdle();
      context.provider.emitNotification('provider-1', {
        jsonrpc: '2.0',
        method: 'droid.session_notification',
        params: {
          notification: {
            type: 'create_message',
            message: {
              id: 'background-completion-message',
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: 'Background task completed.\ntask_id: provider-child-background\noutput: done',
                },
              ],
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
          },
        },
      });

      assert.equal(context.history.childSessions('provider-1')[0]?.status, 'completed');
      assert.equal(
        context.events.some(
          (event) =>
            event.type === 'session.child' &&
            event.child.childSessionId === 'child-1' &&
            event.child.status === 'completed',
        ),
        true,
      );

      assert.equal(provider.prompts.length, 2);
      compactGate?.resolve();
      await compacting;
      if (compaction === 'automatic') notifyCompaction(context, 'provider-1', 'completed');
      await provider.waitForPrompts(3);
      await context.waitForIdle();
      assert.deepEqual(provider.prompts.slice(2), [
        [
          'The agents you started have finished while this chat was idle.',
          '- worker-2: completed',
          'Continue from these results.',
        ].join('\n'),
      ]);
      const appended = context.events.filter((event) => event.type === 'event.appended');
      assert.equal(
        appended.filter(
          (event) =>
            event.event.kind === 'status' && event.event.text === 'Agents finished; continuing',
        ).length,
        1,
      );
      assert.equal(
        appended.some((event) => event.event.role === 'primary' && event.event.author === 'user'),
        false,
      );
    } finally {
      await context.dispose();
    }
  });

test('an agent that settles inside the parent turn does not wake it a second time', async () => {
  const context = createSessionManagerTestContext();
  try {
    const provider = await createSession(context);
    context.history.seedSessionLaunchSettings('provider-child-foreground', {
      modelId: 'custom:glm-5.2',
    });

    provider.queueStreamEvents(
      taskRun('task-foreground', 'worker-2', 'session_id: provider-child-foreground\n\ndone'),
    );
    await send(context, 'run worker in this turn');
    await context.waitForIdle();

    // The agent ran and finished inside the parent's own turn, which read its
    // result: a wake would only repeat what the parent already has.
    assert.equal(context.history.childSessions('provider-1')[0]?.status, 'completed');
    assert.deepEqual(provider.prompts, ['initial', 'run worker in this turn']);
  } finally {
    await context.dispose();
  }
});

test('worker token usage updates totals without replacing the primary context reading', async () => {
  const context = createSessionManagerTestContext();
  try {
    const primary = await createSession(context, 'mission-control');
    primary.queueStreamEvents([
      {
        type: 'token_usage_update',
        inputTokens: 5,
        outputTokens: 2,
        cacheCreationTokens: 1,
        cacheReadTokens: 2,
        thinkingTokens: 0,
      },
    ]);
    await send(context, 'primary usage');
    assert.equal(latestSessionUpdate(context.events)?.session.contextTokens, 9);
    assert.equal(latestSessionUpdate(context.events)?.session.contextAccuracy, 'exact');

    context.history.seedChildSessions([
      {
        parentAppSessionId: 'provider-1',
        childSessionId: 'child-tokens',
        providerSessionId: 'worker-tokens',
        role: 'worker',
        status: 'paused',
        modelId: 'model-default',
        transcriptAvailable: true,
        updatedAt: Date.now(),
      },
    ]);
    await context.handle({
      type: 'child.open',
      parentAppSessionId: 'provider-1',
      childSessionId: 'child-tokens',
      requestId: 'open-child-tokens',
    });
    context.provider.session('worker-tokens').queueStreamEvents([
      {
        type: 'token_usage_update',
        inputTokens: 50,
        outputTokens: 20,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        thinkingTokens: 0,
      },
    ]);
    await context.handle({
      type: 'child.send',
      parentAppSessionId: 'provider-1',
      childSessionId: 'child-tokens',
      text: 'worker usage',
    });

    const summary = latestSessionUpdate(context.events)?.session;
    assert.equal(summary?.tokensIn, 50);
    assert.equal(summary?.tokensOut, 20);
    assert.equal(summary?.contextTokens, 9);
    assert.equal(summary?.contextAccuracy, 'exact');
  } finally {
    await context.dispose();
  }
});

test('loaded child context follows its parent-scoped logical identity', async () => {
  const context = createSessionManagerTestContext();
  try {
    const primary = await createSession(context, 'mission-control');
    context.history.seedSessionLaunchSettings('worker-history-id', { modelId: 'model-default' });
    primary.queueStreamEvents([taskProgress('task-context', 'worker-history-id')]);
    await send(context, 'spawn worker');
    context.runtime.loadQueue.set('worker-history-id', [
      new FakeFactorySession('worker-runtime-id', {}, context.calls),
    ]);
    await context.handle({
      type: 'child.open',
      parentAppSessionId: 'provider-1',
      childSessionId: 'child-1',
      requestId: 'open-child-history',
    });
    notifyCompaction(context, 'worker-runtime-id', 'started');
    notifyCompaction(context, 'worker-runtime-id', 'completed');
    await context.waitForIdle();
    context.events.length = 0;

    await context.handle({
      type: 'child.send',
      parentAppSessionId: 'provider-1',
      childSessionId: 'child-1',
      text: 'measure context',
    });

    const runtimeContext = context.events.find(
      (event) =>
        event.type === 'context.updated' &&
        event.appSessionId === 'provider-1' &&
        event.sourceSessionId === 'child-1' &&
        event.parentAppSessionId === 'provider-1' &&
        event.childSessionId === 'child-1',
    );
    assert.equal(runtimeContext?.type, 'context.updated');
    assert.equal(runtimeContext.stats.compactions, 1);
  } finally {
    await context.dispose();
  }
});
