import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProviderTranscriptFile } from './ProviderTranscriptFile.js';
import { parseFullSessionTranscript } from '../sessionTranscript.js';
import type { SessionSummary, TranscriptEvent } from '../protocol.js';

function reply(messageId: string, text: string): TranscriptEvent {
  return {
    id: `${messageId}-${text}`,
    appSessionId: 'chat',
    sourceSessionId: 'chat',
    role: 'primary',
    ts: 1,
    kind: 'text',
    text,
    textUpdate: { kind: 'delta', messageId },
  };
}

test('a line a crash left half-written does not swallow the replies after it', async (t) => {
  const userData = mkdtempSync(join(tmpdir(), 'provider-transcript-'));
  process.env.DROIDEX_USER_DATA_DIR = userData;
  t.after(() => {
    delete process.env.DROIDEX_USER_DATA_DIR;
    rmSync(userData, { recursive: true, force: true });
  });
  const file = new ProviderTranscriptFile('chat', () => ({}) as SessionSummary);
  mkdirSync(join(userData, 'provider-sessions'));
  writeFileSync(
    file.path,
    `${JSON.stringify({ type: 'session_start', id: 'chat' })}\n{"type":"message","message":{"rol`,
  );

  for (const [messageId, text] of [
    ['first', 'one'],
    ['second', 'two'],
  ]) {
    file.append(reply(messageId, text));
    await file.flush();
  }

  assert.deepEqual(
    parseFullSessionTranscript('chat', 'codex', file.path, 'primary').map((event) => event.text),
    ['one', 'two'],
  );
});
