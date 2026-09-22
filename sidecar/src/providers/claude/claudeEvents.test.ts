import assert from 'node:assert/strict';
import test from 'node:test';

import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { TranscriptEvent } from '../../protocol.js';
import type { ChildSessionSignal } from '../../subagentSignals.js';
import { ClaudeEventMapper } from './claudeEvents.js';

// The cross-provider contract: a Claude turn has to reach the transcript in the
// same shapes Droid writes, and the SDK repeats every block as a snapshot, so
// these are the sequences where "once" is easy to get wrong.
const message = (value: unknown): SDKMessage => value as SDKMessage;

const streamEvent = (event: unknown, parent: string | null = null): SDKMessage =>
  message({ type: 'stream_event', event, parent_tool_use_id: parent });

const assistant = (content: unknown[], parent: string | null = null): SDKMessage =>
  message({ type: 'assistant', message: { content }, parent_tool_use_id: parent });

// The child-session signals one mapper reports, message by message.
const childrenOf =
  (mapper: ClaudeEventMapper) =>
  (entry: SDKMessage): ChildSessionSignal[] =>
    mapper.map(entry).flatMap((n) => (n.childSession ? [n.childSession] : []));

function transcripts(messages: SDKMessage[]): TranscriptEvent[] {
  return mapped(messages).map(({ transcript }) => transcript);
}

// Transcript rows with the spawn each one is attributed to. A subagent's rows
// carry the tool_use that spawned it; the main thread's carry nothing.
function mapped(messages: SDKMessage[]): { transcript: TranscriptEvent; owner?: string }[] {
  const mapper = new ClaudeEventMapper('app-1');
  return messages.flatMap((entry) =>
    mapper
      .map(entry)
      .flatMap((normalized) =>
        normalized.transcript
          ? [{ transcript: normalized.transcript, owner: normalized.childOwner?.id }]
          : [],
      ),
  );
}

test('streamed text reaches the transcript once, not again from the snapshot', () => {
  const events = transcripts([
    streamEvent({ type: 'content_block_start', index: 0, content_block: { type: 'text' } }),
    streamEvent({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'Hello ' },
    }),
    streamEvent({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'world' },
    }),
    // The CLI snapshots each block as it finishes, carrying its whole text.
    assistant([{ type: 'text', text: 'Hello world' }]),
    streamEvent({ type: 'content_block_stop', index: 0 }),
  ]);

  assert.deepEqual(
    events.map((event) => [event.kind, event.text]),
    [
      ['text', 'Hello '],
      ['text', 'world'],
    ],
  );
});

test('a message that streamed nothing is reported from its snapshot', () => {
  const events = transcripts([
    message({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Usage limit reached' }] },
      parent_tool_use_id: null,
      error: 'rate_limit',
    }),
  ]);
  assert.deepEqual(
    events.map((event) => [event.kind, event.text, event.errorKind]),
    [
      ['text', 'Usage limit reached', undefined],
      ['error', 'rate_limit', 'usage_limit'],
    ],
  );
});

test('a tool call carries its streamed input and pairs with its result by id', () => {
  const events = transcripts([
    streamEvent({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'toolu_1', name: 'Bash' },
    }),
    streamEvent({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '{"command"' },
    }),
    streamEvent({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: ':"ls"}' },
    }),
    assistant([{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } }]),
    streamEvent({ type: 'content_block_stop', index: 0 }),
    message({
      type: 'user',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_1', content: 'a.txt', is_error: false },
        ],
      },
    }),
  ]);

  assert.deepEqual(
    events.map((event) => [
      event.kind,
      event.toolUseId,
      event.toolName,
      event.toolArgs,
      event.text,
    ]),
    [
      ['tool_call', 'toolu_1', 'Bash', { command: 'ls' }, undefined],
      ['tool_result', 'toolu_1', undefined, undefined, 'a.txt'],
    ],
  );
});

test("a subagent's rows carry the spawn that owns them, never the parent's feed", () => {
  const events = mapped([
    streamEvent(
      { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
      'toolu_task',
    ),
    streamEvent(
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'inner chatter' },
      },
      'toolu_task',
    ),
    streamEvent(
      {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'tool_use', id: 'toolu_2', name: 'Read' },
      },
      'toolu_task',
    ),
    streamEvent(
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '{"file_path":"a.ts"}' },
      },
      'toolu_task',
    ),
    streamEvent({ type: 'content_block_stop', index: 1 }, 'toolu_task'),
  ]);

  assert.deepEqual(
    events.map(({ transcript, owner }) => [transcript.kind, transcript.toolName, owner]),
    [
      ['text', undefined, 'toolu_task'],
      ['tool_call', 'Read', 'toolu_task'],
    ],
  );
});

// Shapes taken from a real six-agent workflow run: the fan-out is reported only
// as a snapshot array on the workflow's own task_progress, and its agents never
// get a task_started of their own.
test("a workflow's agents come from its progress snapshot, with a phase and a model", () => {
  const workflowAgent = (index: number, label: string, over: Record<string, unknown> = {}) => ({
    type: 'workflow_agent',
    index,
    label,
    phaseIndex: 1,
    phaseTitle: 'Echo',
    model: 'claude-haiku-4-5',
    promptPreview: `Reply with ${label} and stop.`,
    state: 'start',
    ...over,
  });
  const progress = (agents: unknown[]) =>
    message({
      type: 'system',
      subtype: 'task_progress',
      task_id: 'wf-1',
      tool_use_id: 'toolu_workflow',
      description: 'Echo',
      usage: { total_tokens: 0, tool_uses: 0, duration_ms: 1 },
      workflow_progress: [{ type: 'workflow_phase', index: 1, title: 'Echo' }, ...agents],
    });

  const children = childrenOf(new ClaudeEventMapper('app-1', 'claude-haiku-4-5'));

  assert.deepEqual(
    children(
      message({
        type: 'system',
        subtype: 'task_started',
        task_id: 'wf-1',
        tool_use_id: 'toolu_workflow',
        description: 'Six trivial agents',
        task_type: 'local_workflow',
        workflow_name: 'echo-six',
      }),
    ),
    [],
  );

  // An agent still waiting for a slot has no id yet and cannot be identified.
  const started = children(
    progress([workflowAgent(1, 'echo:ONE', { agentId: 'agent-1' }), workflowAgent(2, 'echo:TWO')]),
  );
  assert.deepEqual(
    started.map((child) => [child.providerSessionId, child.label, child.status, child.phase]),
    [['agent-1', 'echo:ONE', 'running', 'Echo']],
  );
  assert.deepEqual(
    [started[0].toolUseId, started[0].group, started[0].modelId, started[0].prompt],
    ['toolu_workflow', 'echo-six', 'claude-haiku-4-5', 'Reply with echo:ONE and stop.'],
  );

  // The same snapshot repeats every agent, so an unchanged one says nothing.
  assert.deepEqual(
    children(
      progress([
        workflowAgent(1, 'echo:ONE', { agentId: 'agent-1' }),
        workflowAgent(2, 'echo:TWO', { agentId: 'agent-2' }),
      ]),
    ).map((child) => child.providerSessionId),
    ['agent-2'],
  );

  // The workflow stopping settles an agent its last snapshot still showed working.
  assert.deepEqual(
    children(
      message({
        type: 'system',
        subtype: 'task_notification',
        task_id: 'wf-1',
        tool_use_id: 'toolu_workflow',
        status: 'completed',
      }),
    ).map((child) => [child.providerSessionId, child.status]),
    [
      ['agent-1', 'completed'],
      ['agent-2', 'completed'],
    ],
  );
});

test('the result reports only the denials that never reached the transcript', () => {
  const events = transcripts([
    message({
      type: 'user',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_1', content: 'declined', is_error: true },
        ],
      },
    }),
    message({
      type: 'result',
      modelUsage: {},
      permission_denials: [
        { tool_name: 'Write', tool_use_id: 'toolu_1', tool_input: {} },
        { tool_name: 'Bash', tool_use_id: 'toolu_2', tool_input: {} },
      ],
    }),
  ]);

  assert.deepEqual(
    events.map((event) => [event.kind, event.toolUseId, event.text, event.isError]),
    [
      ['tool_result', 'toolu_1', 'declined', true],
      ['tool_result', 'toolu_2', 'Bash was denied.', true],
    ],
  );
});

// The SDK's background-task list carries ids only, and an agent's id leaves it
// when the agent finishes exactly as it does when one is stopped. Reading the
// gap as a stop flashed every completing agent through "Awaiting approval".
test('an agent leaving the background task list is not reported as paused', () => {
  const children = childrenOf(new ClaudeEventMapper('app-1', 'claude-haiku-4-5'));

  assert.deepEqual(
    children(
      message({
        type: 'system',
        subtype: 'task_started',
        task_id: 'task-1',
        tool_use_id: 'toolu_task',
        description: 'Check the diff',
        task_type: 'local_agent',
      }),
    ).map((child) => child.status),
    ['running'],
  );

  const backgroundTasks = (tasks: unknown[]) =>
    children(message({ type: 'system', subtype: 'background_tasks_changed', tasks }));

  assert.deepEqual(
    backgroundTasks([{ task_id: 'task-1', task_type: 'local_agent', ambient: false }]),
    [],
  );
  // The agent drops off the list a beat before its own terminal notification.
  assert.deepEqual(backgroundTasks([]), []);

  assert.deepEqual(
    children(
      message({
        type: 'system',
        subtype: 'task_notification',
        task_id: 'task-1',
        status: 'completed',
      }),
    ).map((child) => child.status),
    ['completed'],
  );
});
