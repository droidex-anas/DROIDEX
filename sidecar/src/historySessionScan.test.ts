import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { SessionSummary, TranscriptEvent } from './protocol.js';
import type { ProviderSession, ProviderVoiceEvent } from './providers/session.js';
import { providerSessionJsonl } from './testing/providerSessionFixtures.js';

const originalHome = process.env.HOME;
const originalUserDataDir = process.env.DROIDEX_USER_DATA_DIR;
const home = mkdtempSync(join(tmpdir(), 'droid-history-session-scan-home-'));
process.env.HOME = home;
// The scan's second root lives beside the profile, so a profile override in the
// developer's environment would aim this suite at their real session files.
delete process.env.DROIDEX_USER_DATA_DIR;

const { loadHistoricalSessions } = await import('./history.js');
const { parseFullSessionTranscript, SessionTranscriptReader } =
  await import('./sessionTranscript.js');
const { ProviderTranscriptFile } = await import('./providers/ProviderTranscriptFile.js');
const { writeProviderSessionSettings } = await import('./providers/providerSessionSettings.js');
const { resumeSettings } = await import('./sessionHelpers.js');
const { SessionVoice } = await import('./providers/SessionVoice.js');
const { providerSessionsDir } = await import('./droidexPaths.js');

test.after(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalUserDataDir !== undefined) process.env.DROIDEX_USER_DATA_DIR = originalUserDataDir;
  rmSync(home, { recursive: true, force: true });
});

let seq = 0;
function writeSession(id: string, title: string): void {
  const dir = join(home, '.factory', 'sessions');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${id}.jsonl`),
    providerSessionJsonl({
      type: 'session_start',
      cwd: '',
      sessionTitle: title,
      settings: { interactionMode: 'auto' },
    }),
  );
}

function titles(): string[] {
  return loadHistoricalSessions()
    .map((row) => row.summary.title)
    .sort();
}

// These tests pin the uncached scan's freshness contract: it backs the
// session file cache reconcile, so a change written between two scans must
// show up in the second one.

test('a session file rewritten between scans serves its new summary', () => {
  seq += 1;
  const id = `scan-rewrite-${seq}`;
  writeSession(id, 'before the rewrite');
  assert.ok(titles().includes('before the rewrite'));

  writeSession(id, 'after the rewrite — changed on disk');
  const after = titles();
  assert.ok(after.includes('after the rewrite — changed on disk'));
  assert.ok(!after.includes('before the rewrite'));
});

test('a settings sidecar written between scans invalidates the summary', () => {
  seq += 1;
  const id = `scan-settings-${seq}`;
  writeSession(id, `settings session ${seq}`);
  const before = loadHistoricalSessions().find((row) => row.summary.appSessionId === id);
  assert.equal(before?.summary.modelId, undefined);

  writeFileSync(
    join(home, '.factory', 'sessions', `${id}.settings.json`),
    JSON.stringify({ modelId: 'scan-test-model' }),
  );
  const after = loadHistoricalSessions().find((row) => row.summary.appSessionId === id);
  assert.equal(after?.summary.modelId, 'scan-test-model');
});

test('a session file created between scans appears, and a deleted one disappears', () => {
  seq += 1;
  const id = `scan-create-${seq}`;
  writeSession(id, `created late ${seq}`);
  assert.ok(titles().includes(`created late ${seq}`));

  unlinkSync(join(home, '.factory', 'sessions', `${id}.jsonl`));
  assert.ok(!titles().includes(`created late ${seq}`));
});

test('an unreadable subdirectory is skipped without aborting the scan', () => {
  // chmod is ineffective for root (CI containers), where a 000 dir is still
  // readable; skip there so the test stays deterministic everywhere else.
  if (process.getuid?.() === 0) return;
  seq += 1;
  const good = `scan-resilient-${seq}`;
  writeSession(good, `resilient ${seq}`);
  const locked = join(home, '.factory', 'sessions', 'locked-dir');
  mkdirSync(locked, { recursive: true });
  chmodSync(locked, 0o000);
  try {
    // A parallel run removing or locking a sessions subtree must not abort
    // the reconcile scan; the readable sibling session is still enumerated.
    const found = titles();
    assert.ok(found.includes(`resilient ${seq}`), 'the scan completes past the locked subtree');
  } finally {
    chmodSync(locked, 0o755);
    rmSync(locked, { recursive: true, force: true });
  }
});

// The one cross-provider contract in this path: what ProviderTranscriptFile
// writes for a non-Droid session is what the scan admits and the parser
// replays. Nothing types can check — a drifted head key or content block reads
// as "the session is missing, and empty when reopened".
test('a transcript DROIDEX writes for a non-Droid session is enumerated and replays', () => {
  const appSessionId = 'provider-transcript-scan';
  const summary: SessionSummary = {
    appSessionId,
    provider: 'claude',
    resumeId: 'thread-abc',
    sessionPurpose: 'chat',
    interactionMode: 'auto',
    role: 'primary',
    title: 'Claude session',
    goal: 'Claude session',
    cwd: '',
    modelId: 'claude-sonnet-4-5',
    fastMode: true,
    autonomy: 'medium',
    phase: 'paused',
    queuedSends: 0,
    features: [],
    tokensIn: 0,
    tokensOut: 0,
    contextTokens: 0,
    createdAt: 1,
    updatedAt: 1,
  };
  const transcript = new ProviderTranscriptFile(summary.appSessionId, () => summary);
  transcript.appendPrompt('what is here?');
  transcript.append(transcriptEvent(appSessionId, 'text', { text: 'Looking.' }));
  transcript.append(
    transcriptEvent(appSessionId, 'tool_call', {
      toolName: 'Read',
      toolUseId: 'toolu_1',
      toolArgs: { path: '.' },
    }),
  );
  transcript.append(
    transcriptEvent(appSessionId, 'tool_result', { toolUseId: 'toolu_1', text: 'AGENTS.md' }),
  );
  transcript.append(transcriptEvent(appSessionId, 'thinking', { text: 'Found' }));
  transcript.append(transcriptEvent(appSessionId, 'thinking', { text: ' the file.' }));
  transcript.append(transcriptEvent(appSessionId, 'text', { text: 'The file is' }));
  transcript.append(transcriptEvent(appSessionId, 'text', { text: ' ' }));
  transcript.append(transcriptEvent(appSessionId, 'text', { text: 'AGENTS.md.' }));
  // A live progress line is shown once and never stored. The plan-mode notice
  // and the crash row are what this chat ended on, so both must come back.
  transcript.append(
    transcriptEvent(appSessionId, 'status', { text: 'Reconnecting…', transient: true }),
  );
  transcript.append(
    transcriptEvent(appSessionId, 'status', { text: 'Planning on opus, the plan-mode model.' }),
  );
  transcript.append(
    transcriptEvent(appSessionId, 'error', {
      text: 'Session process was killed (SIGKILL).',
      isError: true,
    }),
  );
  transcript.flush();

  const listed = loadHistoricalSessions().find((row) => row.summary.appSessionId === appSessionId);
  assert.equal(listed?.summary.provider, 'claude');
  assert.equal(listed?.summary.resumeId, 'thread-abc');
  // Without a model on the head line the restored session cannot be resumed.
  assert.equal(listed?.summary.modelId, 'claude-sonnet-4-5');
  assert.equal(listed?.summary.title, 'Claude session');
  assert.equal(listed?.summary.fastMode, true);
  writeProviderSessionSettings(appSessionId, { fastMode: false });
  writeProviderSessionSettings(appSessionId, { reasoningEffort: 'high' });
  const restored = loadHistoricalSessions().find(
    (row) => row.summary.appSessionId === appSessionId,
  );
  assert.equal(restored?.summary.fastMode, false);
  assert.equal(resumeSettings(restored?.summary).fastMode, false);

  const events = parseFullSessionTranscript(
    appSessionId,
    appSessionId,
    join(providerSessionsDir(), `${appSessionId}.jsonl`),
    'primary',
  );
  assert.deepEqual(
    events.map((event) => [event.kind, event.author ?? event.text, event.toolUseId]),
    [
      ['text', 'user', undefined],
      ['text', 'Looking.', undefined],
      ['tool_call', undefined, 'toolu_1'],
      // The call's id survives, so the renderer pairs the result with its call.
      ['tool_result', 'AGENTS.md', 'toolu_1'],
      ['thinking', 'Found the file.', undefined],
      ['text', 'The file is AGENTS.md.', undefined],
      ['status', 'Planning on opus, the plan-mode model.', undefined],
      ['error', 'Session process was killed (SIGKILL).', undefined],
    ],
  );
});

test('spoken rows replay with their mark, speaker, and latest corrected text', () => {
  const appSessionId = 'spoken-transcript-scan';
  const summary: SessionSummary = {
    appSessionId,
    provider: 'codex',
    sessionPurpose: 'chat',
    interactionMode: 'auto',
    role: 'primary',
    title: 'Voice chat',
    goal: 'Voice chat',
    cwd: '',
    autonomy: 'medium',
    phase: 'paused',
    features: [],
    tokensIn: 0,
    tokensOut: 0,
    contextTokens: 0,
    createdAt: 1,
    updatedAt: 1,
  };
  const transcript = new ProviderTranscriptFile(appSessionId, () => summary);
  const spokenUser = transcriptEvent(appSessionId, 'text', {
    id: 'voice-user',
    sourceSessionId: 'user',
    author: 'user',
    text: 'please',
    spoken: true,
  });
  transcript.append(spokenUser);
  transcript.append({ ...spokenUser, text: 'please check' });
  transcript.append(
    transcriptEvent(appSessionId, 'text', {
      id: 'voice-assistant',
      sourceSessionId: 'primary',
      text: 'I will.',
      spoken: true,
    }),
  );

  const path = join(providerSessionsDir(), `${appSessionId}.jsonl`);
  const eager = parseFullSessionTranscript(appSessionId, appSessionId, path, 'primary');
  const lazy = new SessionTranscriptReader(
    appSessionId,
    appSessionId,
    path,
    'primary',
  ).windowBackward(20, 0).events;
  for (const events of [eager, lazy]) {
    assert.deepEqual(
      events.map(({ id, sourceSessionId, text, author, spoken }) => ({
        id,
        sourceSessionId,
        text,
        author,
        spoken,
      })),
      [
        {
          id: 'voice-user',
          sourceSessionId: 'user',
          text: 'please check',
          author: 'user',
          spoken: true,
        },
        {
          id: 'voice-assistant',
          sourceSessionId: 'primary',
          text: 'I will.',
          author: undefined,
          spoken: true,
        },
      ],
    );
  }
  assert.ok(loadHistoricalSessions().some((row) => row.summary.appSessionId === appSessionId));
});

test('voice finals append once and extend under the same id across runtime replacement', async () => {
  let listener: ((event: ProviderVoiceEvent) => void) | undefined;
  const voice = {
    isLive: () => true,
    start: async () => undefined,
    stop: async () => undefined,
    listVoices: async () => ({ voices: [] }),
    onEvent: (next: (event: ProviderVoiceEvent) => void) => {
      listener = next;
      return () => {
        listener = undefined;
      };
    },
  };
  const session: ProviderSession = {
    provider: 'codex',
    providerSessionId: 'provider-1',
    voice,
    async *stream() {},
    setAutonomy: async () => undefined,
    setModel: async () => undefined,
    interrupt: async () => undefined,
    close: async () => undefined,
  };
  let currentSession = session;
  const appended: TranscriptEvent[] = [];
  const relay = new SessionVoice({
    liveSession: () => currentSession,
    emit: () => undefined,
    appendTranscript: (event) => appended.push(event),
    liveChanged: () => undefined,
    ensureRunning: () => Promise.resolve(),
  });
  const start = () =>
    relay.handle({
      type: 'voice.start',
      attempt: 'attempt-1',
      appSessionId: 'app-1',
      sdp: 'offer',
    });
  await start();
  assert.ok(listener);
  listener({ kind: 'transcript', role: 'user', text: 'help', final: false });
  assert.equal(appended.length, 0);
  listener({ kind: 'transcript', role: 'user', text: 'help', final: true });
  listener({ kind: 'transcript', role: 'user', text: 'help', final: true });
  listener({ kind: 'transcript', role: 'user', text: 'help me', final: true });
  listener({ kind: 'transcript', role: 'assistant', text: 'Sure.', final: true });
  listener({ kind: 'transcript', role: 'assistant', text: 'Sure. Checking.', final: true });

  assert.deepEqual(
    appended.map((event) => event.text),
    ['help', 'help me', 'Sure.', 'Sure. Checking.'],
  );
  assert.equal(appended[0].id, appended[1].id);
  assert.equal(appended[2].id, appended[3].id);
  assert.deepEqual(
    appended.map(({ sourceSessionId, author, spoken }) => ({ sourceSessionId, author, spoken })),
    [
      { sourceSessionId: 'user', author: 'user', spoken: true },
      { sourceSessionId: 'user', author: 'user', spoken: true },
      { sourceSessionId: 'primary', author: undefined, spoken: true },
      { sourceSessionId: 'primary', author: undefined, spoken: true },
    ],
  );

  currentSession = { ...session, providerSessionId: 'provider-2' };
  await start();
  assert.ok(listener);
  listener({ kind: 'transcript', role: 'user', text: 'after resume', final: true });
  assert.notEqual(appended[0].id, appended[4].id);
});

function transcriptEvent(
  appSessionId: string,
  kind: TranscriptEvent['kind'],
  extra: Partial<TranscriptEvent>,
): TranscriptEvent {
  seq += 1;
  return {
    id: `provider-event-${String(seq)}`,
    appSessionId,
    sourceSessionId: appSessionId,
    role: 'primary',
    ts: 1,
    kind,
    ...extra,
  };
}
