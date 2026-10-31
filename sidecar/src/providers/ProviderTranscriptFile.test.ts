import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import fsPromises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
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

function transcriptFile(t: TestContext): { file: ProviderTranscriptFile; userData: string } {
  const userData = mkdtempSync(join(tmpdir(), 'provider-transcript-'));
  process.env.DROIDEX_USER_DATA_DIR = userData;
  t.after(() => {
    delete process.env.DROIDEX_USER_DATA_DIR;
    rmSync(userData, { recursive: true, force: true });
  });
  return { file: new ProviderTranscriptFile('chat', () => ({}) as SessionSummary), userData };
}

function savedTexts(file: ProviderTranscriptFile): (string | undefined)[] {
  return parseFullSessionTranscript('chat', 'codex', file.path, 'primary').map(
    (event) => event.text,
  );
}

test('a line a crash left half-written does not swallow the replies after it', async (t) => {
  const { file, userData } = transcriptFile(t);
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

  assert.deepEqual(savedTexts(file), ['one', 'two']);
});

test('a write that fails halfway does not break the replies after it', async (t) => {
  const { file } = transcriptFile(t);
  const append = fsPromises.appendFile;
  const appendFile = t.mock.method(fsPromises, 'appendFile');
  appendFile.mock.mockImplementationOnce(async (path, data) => {
    await append(path, String(data).slice(0, -10));
    throw new Error('disk full');
  });
  syncBuiltinESMExports();
  t.after(() => {
    appendFile.mock.restore();
    syncBuiltinESMExports();
  });

  file.append(reply('first', 'one'));
  await assert.rejects(file.flush(), /disk full/);
  file.append(reply('second', 'two'));
  await file.flush();
  const reopened = new ProviderTranscriptFile('chat', () => ({}) as SessionSummary);
  reopened.append(reply('third', 'three'));
  await reopened.flush();

  assert.deepEqual(savedTexts(file), ['two', 'three']);
});
