import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import {
  buildSessionSearchSnippet,
  DEFAULT_SEARCH_SLICE_BYTES,
  readSessionSearchSlice,
  type SessionSearchCandidate,
  type SessionSearchRecord,
} from './sessionSearch.js';

function messageLine(
  id: string,
  role: 'user' | 'assistant',
  text: string,
  ts: number,
  visibility?: string,
): string {
  return JSON.stringify({
    id,
    type: 'message',
    timestamp: new Date(ts).toISOString(),
    message: {
      role,
      ...(visibility ? { visibility } : {}),
      content: [{ type: 'text', text }],
    },
  });
}

function toolUseLine(id: string, input: string, ts: number): string {
  return JSON.stringify({
    id,
    type: 'message',
    timestamp: new Date(ts).toISOString(),
    message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input }] },
  });
}

/** A provider session file in a scratch directory removed after the test. */
function writeSession(t: TestContext, lines: string[]): SessionSearchCandidate {
  const directory = mkdtempSync(join(tmpdir(), 'session-search-extraction-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'provider.jsonl');
  writeFileSync(path, `${lines.join('\n')}\n`);
  return {
    providerSessionId: 'provider',
    appSessionId: 'app',
    path,
    sizeBytes: statSync(path).size,
  };
}

async function readAll(
  candidate: SessionSearchCandidate,
  initialByteOffset = 0,
): Promise<SessionSearchRecord[]> {
  const records: SessionSearchRecord[] = [];
  let byteOffset = initialByteOffset;
  for (;;) {
    const slice = await readSessionSearchSlice(candidate, byteOffset);
    assert.ok(slice.nextByteOffset > byteOffset || slice.reachedEnd);
    records.push(...slice.records);
    byteOffset = slice.nextByteOffset;
    if (slice.reachedEnd) return records;
  }
}

function content(
  records: SessionSearchRecord[],
): Omit<SessionSearchRecord, 'sourceByteOffset' | 'eventIndex'>[] {
  return records.map(({ ts, author, text }) => ({ ts, author, text }));
}

test('extracts flattened user and assistant text, never tool IO, llm-only context, notices or corrupt lines', async (t) => {
  const candidate = writeSession(t, [
    messageLine('one', 'user', 'hello\nthere', 1_000),
    toolUseLine('tool', 'grep secret src/', 1_500),
    messageLine('hidden', 'user', 'private review instructions', 2_000, 'llm_only'),
    messageLine(
      'internal',
      'user',
      '<system-notification>private review instructions</system-notification>',
      3_000,
    ),
    '{not-json',
    messageLine('visible', 'user', 'the token llm_only is ordinary chat here', 4_000),
    messageLine('two', 'assistant', 'general   kenobi', 5_000),
  ]);
  assert.deepEqual(content(await readAll(candidate)), [
    { ts: 1_000, author: 'user', text: 'hello there' },
    { ts: 4_000, author: 'user', text: 'the token llm_only is ordinary chat here' },
    { ts: 5_000, author: 'assistant', text: 'general kenobi' },
  ]);
});

test('oversized JSONL records are discarded and scanning resumes at the next record', async (t) => {
  const oversized = messageLine(
    'oversized',
    'user',
    `do not retain ${'x'.repeat(DEFAULT_SEARCH_SLICE_BYTES * 4)}`,
    1_000,
  );
  const wanted = messageLine('wanted', 'assistant', 'bounded otter marker', 2_000);
  const candidate = writeSession(t, [oversized, wanted]);
  const first = await readSessionSearchSlice(candidate, 0, DEFAULT_SEARCH_SLICE_BYTES);
  assert.ok(first.nextByteOffset > DEFAULT_SEARCH_SLICE_BYTES);
  assert.deepEqual(first.records, []);
  assert.deepEqual(content(await readAll(candidate, first.nextByteOffset)), [
    { ts: 2_000, author: 'assistant', text: 'bounded otter marker' },
  ]);
});

test('centers and ellipsizes a case-insensitive search snippet', () => {
  const text = `${'x'.repeat(120)} Needle in a haystack ${'y'.repeat(120)}`;
  const snippet = buildSessionSearchSnippet(text, 'needle');
  assert.ok(snippet);
  assert.ok(snippet.startsWith('…'));
  assert.ok(snippet.endsWith('…'));
  assert.ok(snippet.includes('Needle in a haystack'));
  assert.equal(buildSessionSearchSnippet(text, 'missing'), null);
});
