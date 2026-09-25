import assert from 'node:assert/strict';
import test from 'node:test';
import { ProjectActivity, transcriptEnding } from './activity.js';
import type { TranscriptEvent } from '../protocol.js';

test('only the bounded final primary reply survives a turn, never thinking or tool output', () => {
  const activity = new ProjectActivity();
  const emit = (
    kind: TranscriptEvent['kind'],
    text: string,
    role: TranscriptEvent['role'] = 'primary',
  ) => {
    activity.append({
      id: text,
      appSessionId: 'thread',
      sourceSessionId: 'thread',
      ts: 1,
      kind,
      text,
      role,
    });
  };
  assert.equal(activity.open('thread'), true);
  emit('text', 'Before checking files');
  emit('tool_call', 'Read');
  emit('tool_result', 'SECRET TOOL PAYLOAD');
  emit('thinking', 'PRIVATE THINKING');
  emit('text', 'Foreign child reply', 'worker');
  emit('text', 'x'.repeat(9_000));
  assert.equal(activity.open('thread'), false);
  emit('text', ' finished');
  const turn = activity.finish('thread');
  assert.equal(turn?.text.length, 8_192);
  assert.ok(turn?.text.endsWith(' finished'));
  assert.doesNotMatch(turn?.text ?? '', /SECRET|PRIVATE|Before|Foreign/);
  assert.equal(activity.finish('thread'), undefined);

  // A reply can reach here before the summary that says the turn started, and
  // a turn nobody opened would be reported to its owner as silence.
  emit('text', 'Replied without a streaming update');
  emit('error', 'Provider refused the request');
  const recovered = activity.finish('thread');
  assert.equal(recovered?.text, 'Replied without a streaming update');
  assert.equal(recovered?.error, 'Provider refused the request');
});

test("a stored transcript ends with its last turn's final reply, read the way a live turn is", () => {
  let id = 0;
  const event = (
    kind: TranscriptEvent['kind'],
    text: string,
    extra: Partial<TranscriptEvent> = {},
  ): TranscriptEvent => ({
    id: String((id += 1)),
    appSessionId: 'chat',
    sourceSessionId: 'chat',
    role: 'primary',
    ts: id,
    kind,
    text,
    ...extra,
  });
  const answered = [
    event('text', 'First question', { author: 'user' }),
    event('text', 'An old answer'),
    event('text', 'Second question', { author: 'user' }),
    event('text', 'Let me look'),
    event('tool_call', 'Read'),
    event('text', 'A worker aside', { role: 'worker' }),
    event('text', 'The final answer'),
  ];
  assert.deepEqual(transcriptEnding(answered), { reply: 'The final answer', last: 'reply' });
  // A prompt still waiting on its reply shows no reply from an earlier turn.
  assert.deepEqual(
    transcriptEnding([...answered, event('text', 'And then?', { author: 'user' })]),
    {
      reply: '',
      last: 'prompt',
    },
  );
  assert.deepEqual(transcriptEnding([]), { reply: '' });
});
