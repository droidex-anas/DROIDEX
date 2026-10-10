import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import type { ServerEvent, SessionSummary, TranscriptEvent } from './protocol.js';
import { SessionEventFlow } from './SessionEventFlow.js';
import { SessionTimeline } from './SessionTimeline.js';
import type { ProviderSession, ProviderVoiceEvent } from './providers/session.js';
import { providerSessionJsonl } from './testing/providerSessionFixtures.js';
import { sessionSummary } from './testing/sessionSummaryFixture.js';
import { reconciledHistorySessions } from './testing/historyCharacterizationSupport.js';

const originalHome = process.env.HOME;
const originalUserDataDir = process.env.DROIDEX_USER_DATA_DIR;
const home = mkdtempSync(join(tmpdir(), 'droid-history-session-scan-home-'));
process.env.HOME = home;
// The scan's second root lives beside the profile, so a profile override in the
// developer's environment would aim this suite at their real session files.
delete process.env.DROIDEX_USER_DATA_DIR;

const { HistoryIndex, SESSION_INDEX_FILENAME, createHistorySessionFileCache } =
  await import('./history.js');
const { parseFullSessionTranscript, SessionTranscriptReader } =
  await import('./sessionTranscript.js');
const { writeProviderSessionSettings } = await import('./providers/providerSessionSettings.js');
const { ProviderTranscriptFile, forkedTranscript, writeForkedTranscript } =
  await import('./providers/ProviderTranscriptFile.js');
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

// Changes written between reconciles must appear in the next cached list.

test('files created, rewritten, given settings, or deleted between scans show in the next scan', () => {
  seq += 1;
  const id = `scan-fresh-${seq}`;
  const scanned = () => reconciledHistorySessions().find((row) => row.summary.appSessionId === id);
  writeSession(id, 'before the rewrite');
  assert.equal(scanned()?.summary.title, 'before the rewrite');
  assert.equal(scanned()?.summary.modelId, undefined);

  writeSession(id, 'after the rewrite — changed on disk');
  assert.equal(scanned()?.summary.title, 'after the rewrite — changed on disk');

  writeFileSync(
    join(home, '.factory', 'sessions', `${id}.settings.json`),
    JSON.stringify({ modelId: 'scan-test-model' }),
  );
  assert.equal(scanned()?.summary.modelId, 'scan-test-model');

  unlinkSync(join(home, '.factory', 'sessions', `${id}.jsonl`));
  assert.equal(scanned(), undefined);
});

// The one cross-provider contract in this path: what ProviderTranscriptFile
// writes for a non-Droid session is what the scan admits and the parser
// replays. Nothing types can check — a drifted head key or content block reads
// as "the session is missing, and empty when reopened".
test('a transcript DROIDEX writes for a non-Droid session is enumerated and replays', async () => {
  const appSessionId = 'provider-transcript-scan';
  const summary = providerSummary(appSessionId, {
    resumeId: 'thread-abc',
    modelId: 'claude-sonnet-4-5[1m]',
    fastMode: true,
    contextWindowTokens: 1000000,
    queuedSends: 0,
  });
  const transcript = new ProviderTranscriptFile(summary.appSessionId, () => summary);
  await transcript.appendPrompt('what is here?');
  transcript.append(transcriptEvent(appSessionId, 'text', { text: 'Looking.' }));
  transcript.append(
    transcriptEvent(appSessionId, 'tool_call', {
      toolName: 'Read',
      toolUseId: 'toolu_1',
      toolArgs: { path: '.' },
      pollsChildSessionId: 'polled-child',
    }),
  );
  transcript.append(
    transcriptEvent(appSessionId, 'tool_result', {
      toolUseId: 'toolu_1',
      text: 'AGENTS.md',
      pollsChildSessionId: 'polled-child',
      interrupted: true,
    }),
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
  await transcript.flush();

  const listed = reconciledHistorySessions().find(
    (row) => row.summary.appSessionId === appSessionId,
  );
  assert.equal(listed?.summary.provider, 'claude');
  assert.equal(listed?.summary.resumeId, 'thread-abc');
  // Without a model on the head line the restored session cannot be resumed.
  assert.equal(listed?.summary.modelId, 'claude-sonnet-4-5[1m]');
  assert.equal(listed?.summary.title, 'Claude session');
  assert.equal(listed?.summary.fastMode, true);
  assert.equal(listed?.summary.contextWindowTokens, 1000000);

  // A later choice lives in the settings file beside the transcript and wins
  // over the head line the chat started from.
  writeProviderSessionSettings(appSessionId, { fastMode: false, contextWindowTokens: 200000 });
  const restored = reconciledHistorySessions().find(
    (row) => row.summary.appSessionId === appSessionId,
  );
  assert.equal(restored?.summary.fastMode, false);
  assert.equal(restored?.summary.contextWindowTokens, 200000);

  const events = parseFullSessionTranscript(
    appSessionId,
    appSessionId,
    join(providerSessionsDir(), `${appSessionId}.jsonl`),
    'primary',
  );
  const paged = new SessionTranscriptReader(
    appSessionId,
    appSessionId,
    join(providerSessionsDir(), `${appSessionId}.jsonl`),
    'primary',
  ).windowBackward(20, 0).events;
  for (const replay of [events, paged]) {
    assert.equal(
      replay.find((event) => event.kind === 'tool_call')?.pollsChildSessionId,
      'polled-child',
    );
    assert.equal(
      replay.find((event) => event.kind === 'tool_result')?.pollsChildSessionId,
      'polled-child',
    );
    assert.equal(replay.find((event) => event.kind === 'tool_result')?.interrupted, true);
    assert.equal(replay.find((event) => event.kind === 'tool_call')?.interrupted, undefined);
  }
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

  const emitted: ServerEvent[] = [];
  const timeline = new SessionTimeline({
    registry: { resolveSummary: () => summary, getLive: () => undefined },
    history: { recordEvent: () => undefined },
    getChildSessions: () => [],
    emit: (event) => emitted.push(event),
    emitError: (error) => assert.fail(error.message),
    streamingCoalesceMs: 0,
  });
  timeline.useTranscript(appSessionId, transcript);
  const flow = new SessionEventFlow({
    appendTranscript: (event) => timeline.appendStreaming(event),
    flushTranscript: (parent, child) => timeline.flushStreamingFor(parent, child),
    applySideEffects: () => undefined,
    recordUsage: () => undefined,
    resolveChildScope: (_parent, spawn) => ({
      childSessionId: spawn.id,
      role: spawn.id === 'child-a' ? 'worker' : 'validator',
    }),
  });
  for (const childSessionId of ['child-a', 'child-b']) {
    timeline.appendPrompt(
      appSessionId,
      'Review the file.',
      childSessionId,
      childSessionId === 'child-a' ? 'worker' : 'validator',
    );
    for (const event of [
      transcriptEvent(appSessionId, 'text', { text: `Answer from ${childSessionId}` }),
      transcriptEvent(appSessionId, 'tool_call', { toolUseId: 'read', toolName: 'Read' }),
      transcriptEvent(appSessionId, 'tool_result', { toolUseId: 'read', text: 'File contents' }),
      transcriptEvent(appSessionId, 'text', { text: 'Finished reviewing.' }),
    ]) {
      flow.apply(appSessionId, 'parent-provider', 'primary', {
        transcript: event,
        childOwner: { kind: 'tool-use', id: childSessionId },
      });
    }
  }
  await transcript.flush();
  // Reconcile files as restart does, then exercise the child pane's real loader.
  const db = new DatabaseSync(':memory:');
  const index = new HistoryIndex();
  const canonical = new DatabaseSync(join(home, '.factory', 'droidex', SESSION_INDEX_FILENAME), {
    readOnly: true,
  });
  try {
    const cache = createHistorySessionFileCache(db, canonical);
    cache.reconcileChanges();
    index.replaceSessionFileSnapshot(cache.snapshot());
    for (const childSessionId of ['child-a', 'child-b']) {
      timeline.loadChildHistory({
        appSessionId,
        childSessionId,
        childProviderSessionIds: [`provider-${childSessionId}`],
        role: childSessionId === 'child-a' ? 'worker' : 'validator',
      });
      const page = emitted.at(-1);
      assert.equal(page?.type, 'session.history');
      if (page?.type !== 'session.history') assert.fail('Expected child history');
      assert.deepEqual(
        page.transcripts.map((event) => event.kind),
        ['text', 'text', 'tool_call', 'tool_result', 'text'],
      );
      assert.equal(page.transcripts[0].author, 'user');
      assert.equal(page.transcripts[0].text, 'Review the file.');
      assert.equal(page.transcripts[1].text, `Answer from ${childSessionId}`);
      assert.ok(
        page.transcripts.every(
          (event) =>
            event.appSessionId === appSessionId &&
            event.sourceSessionId === childSessionId &&
            event.role === (childSessionId === 'child-a' ? 'worker' : 'validator'),
        ),
      );
    }
    assert.ok(
      !reconciledHistorySessions().some((row) => row.summary.appSessionId.startsWith('child-')),
    );
    assert.deepEqual(
      parseFullSessionTranscript(
        appSessionId,
        appSessionId,
        join(providerSessionsDir(), `${appSessionId}.jsonl`),
        'primary',
      ),
      events,
    );
  } finally {
    timeline.releaseTranscript(appSessionId);
    canonical.close();
    index.close();
    db.close();
  }
});

test('a failed transcript write reaches its caller and does not stop the lines after it', async () => {
  const appSessionId = 'blocked-transcript';
  const summary = providerSummary(appSessionId, {
    title: 'Blocked, then not',
    modelId: 'claude-sonnet-4-5',
  });
  const path = join(providerSessionsDir(), `${appSessionId}.jsonl`);
  // A directory where the file belongs fails every append until it is removed.
  mkdirSync(path, { recursive: true });
  const transcript = new ProviderTranscriptFile(appSessionId, () => summary);

  await assert.rejects(transcript.appendPrompt('lost'), /EISDIR/);
  // Nothing is open, so a close right after the failure settles.
  await transcript.flush();
  transcript.append(transcriptEvent(appSessionId, 'text', { text: 'Also lost.' }));
  await assert.rejects(transcript.flush(), /EISDIR/);
  await transcript.flush();

  rmSync(path, { recursive: true });
  await transcript.appendPrompt('kept');
  transcript.append(transcriptEvent(appSessionId, 'text', { text: 'Answer.' }));
  await transcript.flush();

  const events = parseFullSessionTranscript(appSessionId, appSessionId, path, 'primary');
  assert.deepEqual(
    events.map((event) => event.text),
    ['kept', 'Answer.'],
  );
  // The head line went out with the first line that landed.
  const listed = reconciledHistorySessions().find(
    (row) => row.summary.appSessionId === appSessionId,
  );
  assert.equal(listed?.summary.modelId, 'claude-sonnet-4-5');
});

test('spoken rows replay with their mark, speaker, and latest corrected text', async () => {
  const appSessionId = 'spoken-transcript-scan';
  const summary = providerSummary(appSessionId, { provider: 'codex', title: 'Voice chat' });
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
  await transcript.append(
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
  assert.ok(reconciledHistorySessions().some((row) => row.summary.appSessionId === appSessionId));
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
    autonomy: 'off',
    provider: 'codex',
    providerSessionId: 'provider-1',
    voice,
    async *stream() {},
    steer: async () => false,
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

test('a fork reads behind the queued lines and copies the transcript through its answer', async () => {
  const summary = providerSummary('provider-transcript-fork-source');
  const transcript = new ProviderTranscriptFile(summary.appSessionId, () => summary);
  void transcript.appendPrompt('first question');
  transcript.append(
    transcriptEvent(summary.appSessionId, 'text', { text: 'First', forkPointId: 'turn-1' }),
  );
  transcript.append(
    transcriptEvent(summary.appSessionId, 'text', { text: ' answer.', forkPointId: 'turn-1' }),
  );
  void transcript.flush();
  void transcript.appendPrompt('second question');
  transcript.append(
    transcriptEvent(summary.appSessionId, 'text', {
      text: 'Second answer.',
      forkPointId: 'turn-2',
    }),
  );
  void transcript.flush();

  // None of the lines above has been awaited: the read waits behind them all.
  const stored = await transcript.read();
  assert.equal(forkedTranscript(summary.appSessionId, stored).lines.length, 4);
  const path = await writeForkedTranscript(
    forkedTranscript(summary.appSessionId, stored, 'turn-1'),
    {
      appSessionId: 'provider-transcript-fork-copy',
      title: 'Forked chat',
      forkPointRenames: new Map([['turn-1', 'copied-turn-1']]),
    },
  );

  const events = parseFullSessionTranscript(
    'provider-transcript-fork-copy',
    'provider-transcript-fork-copy',
    path,
    'primary',
  );
  assert.deepEqual(
    events.map((event) => [event.author ?? event.text, event.forkPointId]),
    [
      ['user', undefined],
      ['First answer.', 'copied-turn-1'],
    ],
  );
  assert.throws(
    () => forkedTranscript(summary.appSessionId, stored, 'turn-unknown'),
    /saved before/,
  );
});

function providerSummary(
  appSessionId: string,
  overrides: Partial<SessionSummary> = {},
): SessionSummary {
  return sessionSummary({
    appSessionId,
    providerSessionId: undefined,
    provider: 'claude',
    title: 'Claude session',
    autonomy: 'medium',
    ...overrides,
  });
}

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

test('permission migration persists beside old provider transcripts and survives repeated scans', () => {
  for (const [provider, before, after] of [
    ['claude', 'low', 'off'],
    ['claude', 'medium', 'off'],
    ['codex', 'low', 'medium'],
    ['codex', 'medium', 'medium'],
  ] as const) {
    const id = `old-permissions-${provider}-${before}`;
    mkdirSync(providerSessionsDir(), { recursive: true });
    writeFileSync(
      join(providerSessionsDir(), `${id}.jsonl`),
      providerSessionJsonl({
        type: 'session_start',
        provider,
        id,
        title: id,
        autonomyLevel: before,
      }),
    );
    assert.equal(
      reconciledHistorySessions().find((row) => row.summary.appSessionId === id)?.summary.autonomy,
      after,
    );
    const settingsPath = join(providerSessionsDir(), `${id}.settings.json`);
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    assert.equal(settings.permissionSemanticsRevision, 1);
    assert.equal(settings.autonomyLevel, after);
    writeFileSync(settingsPath, JSON.stringify({ ...settings, autonomyLevel: 'low' }));
    assert.equal(
      reconciledHistorySessions().find((row) => row.summary.appSessionId === id)?.summary.autonomy,
      'low',
    );
  }
});
