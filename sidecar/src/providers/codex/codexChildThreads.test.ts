import assert from 'node:assert/strict';
import test from 'node:test';

import type { NormalizedEvent } from '../../normalize.js';
import { codexSession, fakeClient } from './codexTestSupport.js';

test('root agent activity keeps parent output in its own transcript without hiding descendants', async (t) => {
  const { client, notifications } = fakeClient((method) => {
    if (method !== 'thread/start') return undefined;
    notifications.get('thread/started')?.({ thread: { id: 'parent-thread' } });
    return { thread: { id: 'parent-thread' }, model: 'model' };
  });
  const session = codexSession(client, 'app-parent');
  t.after(() => session.close());
  await session.open();
  assert.doesNotThrow(() =>
    session.restoreChildren([
      {
        providerSessionId: 'parent-thread',
        role: 'worker',
        status: 'running',
        modelId: 'model',
        transcriptAvailable: true,
      },
    ]),
  );
  const events: NormalizedEvent[] = [];
  session.onBackgroundEvent((event) => events.push(event));
  notifications.get('item/completed')?.({
    threadId: 'parent-thread',
    item: {
      type: 'subAgentActivity',
      id: 'root-activity',
      kind: 'interacted',
      agentThreadId: 'parent-thread',
      agentPath: '/root',
    },
  });
  for (const [id, parentThreadId] of [
    ['native-child', 'parent-thread'],
    ['native-descendant', 'native-child'],
  ])
    notifications.get('thread/started')?.({ thread: { id, parentThreadId } });
  notifications.get('item/completed')?.({
    threadId: 'native-child',
    item: {
      type: 'subAgentActivity',
      id: 'child-root-activity',
      kind: 'interacted',
      agentThreadId: 'parent-thread',
      agentPath: '/root',
    },
  });
  for (const threadId of ['parent-thread', 'native-child', 'native-descendant'])
    notifications.get('item/agentMessage/delta')?.({
      threadId,
      itemId: 'reply',
      delta: threadId,
    });
  assert.deepEqual(
    events
      .filter((event) => event.childSession)
      .map((event) => event.childSession?.providerSessionId),
    ['native-child', 'native-descendant'],
  );
  assert.deepEqual(
    events
      .filter((event) => event.transcript)
      .map((event) => [event.childOwner?.id, event.transcript?.text]),
    [
      [undefined, 'parent-thread'],
      ['native-child', 'native-child'],
      ['native-descendant', 'native-descendant'],
    ],
  );
});

test('native child streams remain separate from the parent turn and stop at settlement or closure', async () => {
  let startTurn: () => void = () => undefined;
  const started = new Promise<void>((resolve) => {
    startTurn = resolve;
  });
  const { client, notifications } = fakeClient((method) => {
    if (method === 'thread/start') return { thread: { id: 'parent-thread' }, model: 'model' };
    if (method === 'turn/start') {
      startTurn();
      return { turn: { id: 'parent-turn' } };
    }
    return undefined;
  });
  const session = codexSession(client, 'app-parent');
  await session.open();
  for (const payload of [null, undefined])
    assert.doesNotThrow(() => notifications.get('item/completed')?.(payload));
  notifications.get('thread/started')?.({
    thread: { id: 'native-first', parentThreadId: 'parent-thread', agentRole: 'worker' },
  });
  notifications.get('item/agentMessage/delta')?.({
    threadId: 'native-first',
    itemId: 'early',
    delta: 'before observer attachment',
  });
  const background: NormalizedEvent[] = [];
  session.onBackgroundEvent((event) => background.push(event));
  const stream = session.stream('start agents');
  const next = stream.next();
  await started;
  for (const id of ['native-first', 'native-second'])
    notifications.get('thread/started')?.({
      thread: {
        id,
        parentThreadId: 'parent-thread',
        agentRole: id === 'native-second' ? 'validator' : 'worker',
        model: 'child-model',
      },
    });
  notifications.get('turn/completed')?.({
    threadId: 'parent-thread',
    turn: { id: 'parent-turn', status: 'completed' },
  });
  assert.equal((await next).value?.done, true);
  await stream.next();
  for (const threadId of ['native-first', 'native-second', 'unrelated-thread']) {
    notifications.get('turn/started')?.({ threadId, turn: { id: `${threadId}-turn` } });
    notifications.get('item/agentMessage/delta')?.({ threadId, itemId: 'reply', delta: threadId });
  }
  notifications.get('thread/tokenUsage/updated')?.({
    threadId: 'native-second',
    tokenUsage: {
      total: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
      last: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
      modelContextWindow: null,
    },
  });
  notifications.get('item/completed')?.({
    threadId: 'parent-thread',
    item: {
      type: 'collabAgentToolCall',
      id: 'poll',
      tool: 'wait',
      status: 'completed',
      senderThreadId: 'parent-thread',
      receiverThreadIds: ['native-second'],
      prompt: null,
      model: null,
      reasoningEffort: null,
      agentsStates: { 'native-second': { status: 'running', message: null } },
    },
  });
  assert.deepEqual(
    background
      .filter((event) => event.transcript && event.childOwner)
      .map((event) => [event.childOwner?.id, event.transcript?.text]),
    [
      ['native-first', 'before observer attachment'],
      ['native-first', 'native-first'],
      ['native-second', 'native-second'],
    ],
  );
  notifications.get('turn/completed')?.({
    threadId: 'native-first',
    turn: { id: 'child-turn', status: 'completed' },
  });
  notifications.get('item/agentMessage/delta')?.({
    threadId: 'native-first',
    itemId: 'late',
    delta: 'late tail',
  });
  assert.ok(!background.some((event) => event.transcript?.text === 'late tail'));
  assert.ok(
    background.some(
      (event) =>
        event.childSession?.providerSessionId === 'native-first' && event.childSession.done,
    ),
  );
  notifications.get('turn/completed')?.({
    threadId: 'native-second',
    turn: { id: 'validator-turn', status: 'completed' },
  });
  assert.ok(
    background
      .filter((event) => event.childSession?.providerSessionId === 'native-second')
      .every((event) => event.childSession?.role === 'validator'),
  );
  const count = background.length;
  await session.close();
  notifications.get('thread/started')?.({
    thread: { id: 'late-child', parentThreadId: 'parent-thread' },
  });
  notifications.get('item/agentMessage/delta')?.({
    threadId: 'native-second',
    itemId: 'late',
    delta: 'after close',
  });
  assert.equal(background.length, count);
});

test('native child history recovers genuine rows once and discards a read that outlives closure', async () => {
  for (const closeBeforeRead of [false, true]) {
    let finishRead: (value: unknown) => void = () => undefined;
    const read = new Promise<unknown>((resolve) => {
      finishRead = resolve;
    });
    const { client, notifications } = fakeClient((method) => {
      if (method === 'thread/start') return { thread: { id: 'parent-thread' }, model: 'model' };
      if (method === 'thread/turns/list') return read;
      return undefined;
    });
    const session = codexSession(client, 'app-parent');
    await session.open();
    const events: NormalizedEvent[] = [];
    session.restoreChildren([
      {
        providerSessionId: 'native-child',
        role: 'validator',
        status: 'paused',
        modelId: 'model',
        transcriptAvailable: false,
      },
    ]);
    notifications.get('item/agentMessage/delta')?.({
      threadId: 'native-child',
      itemId: 'reply',
      delta: 'child reply',
    });
    notifications.get('item/completed')?.({
      threadId: 'native-child',
      item: { type: 'agentMessage', id: 'reply', text: 'child reply' },
    });
    session.onBackgroundEvent((event) => events.push(event));
    if (closeBeforeRead) await session.close();
    finishRead({
      data: [
        {
          id: 'child-turn',
          status: 'completed',
          items: [
            { type: 'userMessage', id: 'task', content: [{ type: 'text', text: 'child task' }] },
            { type: 'agentMessage', id: 'reply', text: 'child reply' },
          ],
        },
      ],
      nextCursor: null,
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(
      events
        .filter((event) => event.transcript)
        .map((event) => [event.childOwner?.id, event.transcript?.author, event.transcript?.text]),
      closeBeforeRead
        ? []
        : [
            ['native-child', 'user', 'child task'],
            ['native-child', undefined, 'child reply'],
          ],
    );
    if (!closeBeforeRead) {
      assert.ok(events.some((event) => event.childSession?.transcriptAvailable));
      notifications.get('item/completed')?.({
        threadId: 'parent-thread',
        item: {
          type: 'collabAgentToolCall',
          id: 'restored-poll',
          tool: 'wait',
          status: 'completed',
          senderThreadId: 'parent-thread',
          receiverThreadIds: ['native-child'],
          prompt: null,
          model: null,
          reasoningEffort: null,
          agentsStates: { 'native-child': { status: 'completed', message: null } },
        },
      });
      notifications.get('item/completed')?.({
        threadId: 'parent-thread',
        item: {
          type: 'subAgentActivity',
          id: 'restored-activity',
          kind: 'completed',
          agentThreadId: 'native-child',
          agentPath: 'parent/validator',
        },
      });
      assert.ok(
        events
          .filter((event) => event.childSession)
          .every((event) => event.childSession?.role === 'validator'),
      );
      await session.close();
    }
  }
});

test('restoring an active child shows its snapshot and appends the validated completion without duplicated deltas', async () => {
  let finishRead: (value: unknown) => void = () => undefined;
  const read = new Promise<unknown>((resolve) => {
    finishRead = resolve;
  });
  const { client, notifications } = fakeClient((method) => {
    if (method === 'thread/start') return { thread: { id: 'parent-thread' }, model: 'model' };
    if (method === 'thread/turns/list') return read;
    return undefined;
  });
  const session = codexSession(client, 'app-parent');
  await session.open();
  const events: NormalizedEvent[] = [];
  session.onBackgroundEvent((event) => events.push(event));
  session.restoreChildren([
    {
      providerSessionId: 'native-child',
      role: 'worker',
      status: 'paused',
      modelId: 'model',
      transcriptAvailable: false,
    },
  ]);
  const notify = (method: string, params: Record<string, unknown>) =>
    notifications.get(method)?.({ threadId: 'native-child', ...params });
  notify('item/agentMessage/delta', { itemId: 'active', delta: 'already shown' });
  const command = {
    type: 'commandExecution',
    id: 'command',
    command: 'pwd',
    cwd: '/workspace',
    status: 'completed',
    aggregatedOutput: '/workspace',
    exitCode: 0,
  };
  finishRead({
    data: [
      {
        id: 'child-turn',
        status: 'inProgress',
        items: [
          { type: 'userMessage', id: 'task', content: [{ type: 'text', text: 'child task' }] },
          command,
          { type: 'agentMessage', id: 'active', text: 'already shown' },
        ],
      },
    ],
    nextCursor: null,
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(
    events
      .filter((event) => event.transcript)
      .map((event) => [event.transcript?.kind, event.transcript?.text]),
    [
      ['text', 'child task'],
      ['tool_call', undefined],
      ['tool_result', '/workspace'],
      ['text', 'already shown'],
    ],
  );
  notify('item/agentMessage/delta', { itemId: 'active', delta: ' final' });
  notify('item/completed', {
    item: { type: 'agentMessage', id: 'active', text: 'already shown final' },
  });
  notify('item/agentMessage/delta', { itemId: 'next', delta: 'new live item' });
  assert.deepEqual(
    events
      .filter((event) => event.transcript?.kind === 'text' && event.transcript.author !== 'user')
      .map((event) => [event.transcript?.text, event.transcript?.textUpdate]),
    [
      ['already shown', { messageId: 'active', kind: 'snapshot' }],
      [' final', { messageId: 'active', kind: 'delta' }],
      ['new live item', { messageId: 'next', kind: 'delta' }],
    ],
  );
  await session.close();
});

test('a failed native history read reports the error on its exact child', async () => {
  const { client } = fakeClient((method) => {
    if (method === 'thread/start') return { thread: { id: 'parent-thread' }, model: 'model' };
    if (method === 'thread/turns/list') throw new Error('native history unavailable');
    return undefined;
  });
  const session = codexSession(client, 'app-parent');
  await session.open();
  const events: NormalizedEvent[] = [];
  session.onBackgroundEvent((event) => events.push(event));
  session.restoreChildren([
    {
      providerSessionId: 'native-child',
      role: 'worker',
      status: 'paused',
      modelId: 'model',
      transcriptAvailable: false,
    },
  ]);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(events.length, 1);
  assert.deepEqual(events[0]?.childOwner, { kind: 'provider-session', id: 'native-child' });
  assert.equal(events[0]?.transcript?.kind, 'error');
  assert.match(
    events[0]?.transcript?.text ?? '',
    /native history unavailable.*Reopen the parent chat to retry/,
  );
  await session.close();
});
