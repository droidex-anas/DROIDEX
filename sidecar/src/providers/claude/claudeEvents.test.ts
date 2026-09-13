import assert from 'node:assert/strict';
import test from 'node:test';

import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { TranscriptEvent } from '../../protocol.js';
import { ClaudeEventMapper } from './claudeEvents.js';

// The cross-provider contract: a Claude turn has to reach the transcript in the
// same shapes Droid writes, and the SDK repeats every block as a snapshot, so
// these are the sequences where "once" is easy to get wrong.
const message = (value: unknown): SDKMessage => value as SDKMessage;

const streamEvent = (event: unknown, parent: string | null = null): SDKMessage =>
  message({ type: 'stream_event', event, parent_tool_use_id: parent });

const assistant = (content: unknown[], parent: string | null = null): SDKMessage =>
  message({ type: 'assistant', message: { content }, parent_tool_use_id: parent });

function transcripts(messages: SDKMessage[]): TranscriptEvent[] {
  const mapper = new ClaudeEventMapper('app-1');
  return messages.flatMap((entry) =>
    mapper
      .map(entry)
      .flatMap((normalized) => (normalized.transcript ? [normalized.transcript] : [])),
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
  const events = transcripts([assistant([{ type: 'text', text: 'Recovered' }])]);
  assert.deepEqual(
    events.map((event) => [event.kind, event.text]),
    [['text', 'Recovered']],
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

test("a subagent's narration is dropped while its tool call is kept", () => {
  const events = transcripts([
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
    events.map((event) => [event.kind, event.toolName, event.toolArgs]),
    [['tool_call', 'Read', { file_path: 'a.ts' }]],
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
