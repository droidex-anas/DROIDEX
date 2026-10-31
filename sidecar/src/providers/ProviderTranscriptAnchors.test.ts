import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProviderTranscriptAnchors } from './ProviderTranscriptAnchors.js';
import type { StoredMessageLine } from '../sessionTranscriptParser.js';

function assistantDelta(messageId: string, text: string, messageStartLine?: number) {
  return {
    type: 'message',
    id: `${messageId}-${text}`,
    timestamp: new Date(0).toISOString(),
    message: {
      role: 'assistant',
      content: [
        {
          type: 'text',
          text,
          textUpdate: { kind: 'delta', messageId },
          ...(messageStartLine === undefined ? {} : { messageStartLine }),
        },
      ],
    },
  } as StoredMessageLine;
}

test('a corrupt saved line does not stop new replies from being anchored', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'transcript-anchors-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'chat.jsonl');
  writeFileSync(
    path,
    [
      JSON.stringify({ type: 'session_start', id: 'chat' }),
      JSON.stringify(assistantDelta('reply', 'Hel', 1)),
      '{"type":"message","message":{"role":"assis',
      '',
    ].join('\n'),
  );
  const anchors = new ProviderTranscriptAnchors();

  const continued = await anchors.prepare(assistantDelta('reply', 'lo'), path, false);
  continued.commit();
  const next = await anchors.prepare(assistantDelta('next', 'Hi'), path, false);

  const startOf = (line: StoredMessageLine) =>
    (line.message?.content?.[0] as { messageStartLine?: number }).messageStartLine;
  assert.equal(startOf(continued.line), 1);
  // The corrupt line still counts as line 2, so the next message starts at 4.
  assert.equal(startOf(next.line), 4);
});
