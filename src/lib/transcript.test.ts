import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyEvent,
  isChatContent,
  isDiagnosticContent,
  scopeTranscriptToAgent,
} from './transcript';
import type { TranscriptEvent } from '../types/bridge';

function ev(extra: Partial<TranscriptEvent>): TranscriptEvent {
  return {
    id: 'e',
    appSessionId: 'm',
    sourceSessionId: 'primary',
    role: 'primary',
    ts: 0,
    kind: 'text',
    ...extra,
  } as TranscriptEvent;
}

test('classifyEvent separates chat, plan, child, edit, tool, and error content', () => {
  const cases: Array<[Partial<TranscriptEvent>, string]> = [
    [{ kind: 'text', author: 'user', text: 'hi' }, 'user'],
    [{ kind: 'text', text: 'answer' }, 'assistant_chat'],
    [{ kind: 'thinking', text: '...' }, 'thought'],
    // A TodoWrite is a plan update, not a file edit.
    [
      { kind: 'tool_call', toolName: 'TodoWrite', toolArgs: { todos: '1. [pending] x' } },
      'plan_update',
    ],
    [
      { kind: 'tool_call', toolName: 'Task', toolArgs: { subagent_type: 'worker' } },
      'child_session_event',
    ],
    [
      {
        kind: 'tool_call',
        toolName: 'Edit',
        toolArgs: { file_path: '/a.ts', old_str: 'a', new_str: 'b' },
      },
      'file_edit',
    ],
    [{ kind: 'tool_call', toolName: 'Grep', toolArgs: {} }, 'tool_activity'],
    [{ kind: 'compaction' }, 'compaction'],
    [{ kind: 'status', text: 'Working' }, 'status'],
    [{ kind: 'error', text: 'boom', isError: true }, 'error'],
    [{ kind: 'tool_result', toolName: 'Execute', isError: true }, 'error'],
  ];
  for (const [event, expected] of cases) {
    assert.equal(classifyEvent(ev(event)), expected, JSON.stringify(event));
  }
});

test('chat vs diagnostic partitioning', () => {
  assert.equal(isChatContent('assistant_chat'), true);
  assert.equal(isChatContent('user'), true);
  assert.equal(isChatContent('plan_update'), false);
  assert.equal(isDiagnosticContent('plan_update'), true);
  assert.equal(isDiagnosticContent('tool_activity'), true);
  assert.equal(isDiagnosticContent('assistant_chat'), false);
});

test('scopeTranscriptToAgent keeps primary events by default and isolates a child by id', () => {
  const events = [
    ev({ id: 'p1', role: 'primary', sourceSessionId: 'primary' }),
    ev({ id: 'c1', role: 'worker', sourceSessionId: 'child-1' }),
    ev({ id: 'c2', role: 'worker', sourceSessionId: 'child-2' }),
  ];
  assert.deepEqual(
    scopeTranscriptToAgent(events, null).map((e) => e.id),
    ['p1'],
  );
  assert.deepEqual(
    scopeTranscriptToAgent(events, 'child-1').map((e) => e.id),
    ['c1'],
  );
});
