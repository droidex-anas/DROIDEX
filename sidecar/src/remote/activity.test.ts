import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appendActivity, settleActivity } from './activity.js';
import { trimTranscript } from './sessionProjection.js';
import type { RemoteMessage } from './types.js';
import type { TranscriptEvent } from '../protocol.js';

const event = (patch: Partial<TranscriptEvent>): TranscriptEvent => ({ id: 'event', appSessionId: 'session', sourceSessionId: 'session', role: 'primary', kind: 'text', ts: 1, ...patch });
const message = (): RemoteMessage => ({ id: 'message', role: 'assistant', text: '', steps: [] });

test('thinking unfolds genuine content and tool deltas keep a single stable operation', () => {
  const output = message();
  appendActivity(output, event({ kind: 'thinking', text: 'First ' }));
  appendActivity(output, event({ id: 'thought-2', kind: 'thinking', text: 'second' }));
  appendActivity(output, event({ id: 'call', kind: 'tool_call', toolUseId: 'tool-1', toolName: 'Read', toolArgs: { path: 'file.ts' } }));
  appendActivity(output, event({ id: 'delta', kind: 'tool_call', toolUseId: 'tool-1', toolName: 'Read', toolArgs: { path: 'file.ts' } }));
  assert.equal(output.activity?.length, 2);
  assert.equal(output.activity?.[0]?.detail, 'First second');
  assert.equal(output.activity?.[0]?.status, 'completed');
  assert.equal(output.activity?.[1]?.status, 'running');
  appendActivity(output, event({ kind: 'tool_result', toolUseId: 'tool-1', toolName: 'Read', text: 'Permission denied', isError: true }));
  assert.equal(output.activity?.[1]?.status, 'failed');
});

test('a turn finishing never invents a successful tool result', () => {
  const output = message();
  appendActivity(output, event({ kind: 'tool_call', toolUseId: 'missing-result', toolName: 'Exec' }));
  settleActivity([output], false, 10);
  assert.equal(output.activity?.[0]?.status, 'interrupted');
  assert.equal(output.activity?.[0]?.endedAt, 10);
});

test('large activity payloads are bounded without stopping a desktop session', () => {
  const messages = Array.from({ length: 100 }, (_, index) => {
    const output = message(); output.id = String(index); output.text = 'Recent output';
    for (let i = 0; i < 60; i += 1) appendActivity(output, event({ id: `${index}:${i}`, kind: 'tool_result', text: 'x'.repeat(8_000), toolName: 'Read' }));
    return output;
  });
  assert.equal(trimTranscript(messages), true);
  const activities = messages.flatMap((output) => output.activity || []);
  assert.ok(activities.length <= 120);
  assert.ok(activities.reduce((sum, item) => sum + (item.detail?.length || 0), 0) <= 32_000);
  assert.equal(messages.at(-1)?.text, 'Recent output');
});
