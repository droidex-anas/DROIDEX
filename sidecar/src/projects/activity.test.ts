import assert from 'node:assert/strict';
import test from 'node:test';
import { ProjectActivity } from './activity.js';
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
