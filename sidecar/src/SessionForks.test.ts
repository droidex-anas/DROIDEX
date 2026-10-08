import assert from 'node:assert/strict';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import type { ServerEvent, SessionSummary } from './protocol.js';
import type { Provider, ProviderForkSource, ProviderSession } from './providers/session.js';
import { CodexProvider } from './providers/codex/CodexProvider.js';
import { readProviderTranscript } from './providers/ProviderTranscriptFile.js';
import type { SessionBranch, SessionCreateCommand } from './SessionLifecycle.js';
import { SessionLineageStore, sessionLineagePath } from './sessionLineage.js';
import type { SessionSummaryPatch } from './SessionRegistry.js';
import type { SessionForksDependencies } from './SessionForks.js';
import { formatSideChatPrompt } from './sideChatPrompt.js';
import { sessionSummary } from './testing/sessionSummaryFixture.js';

// A branch reads the source's stored transcript, so history lives in a
// throwaway home.
const originalHome = process.env.HOME;
const home = mkdtempSync(join(tmpdir(), 'session-forks-home-'));
process.env.HOME = home;

const { HistoryIndex } = await import('./history.js');
const { SessionForks } = await import('./SessionForks.js');

test.after(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(home, { recursive: true, force: true });
});

function storeTranscript(
  providerSessionId: string,
  assistantText: string,
  provider: 'droid' | 'codex' = 'droid',
): void {
  const dir =
    provider === 'droid'
      ? join(home, '.factory', 'sessions', '2026', '06')
      : join(home, 'Library', 'Application Support', 'DROIDEX', 'provider-sessions');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${providerSessionId}.jsonl`);
  const lines = [
    {
      type: 'session_start',
      id: providerSessionId,
      provider,
      cwd: home,
      sessionTitle: 'Source chat',
    },
    {
      type: 'message',
      id: 'a1',
      timestamp: '2026-06-12T00:00:00.000Z',
      message: { role: 'assistant', content: [{ type: 'text', text: assistantText }] },
    },
  ];
  writeFileSync(path, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);
  const stat = statSync(path);
  const index = new HistoryIndex();
  try {
    assert.equal(
      index.applySessionFileReconciliation({
        previousRevision: 0,
        revision: 1,
        changed: 1,
        upserts: [
          {
            providerSessionId,
            path,
            birthtimeMs: stat.birthtimeMs,
            mtimeMs: stat.mtimeMs,
            sizeBytes: stat.size,
            settingsMtimeMs: null,
            summary: null,
          },
        ],
        removedProviderSessionIds: [],
      }),
      true,
    );
  } finally {
    index.close();
  }
}

function summary(overrides: Partial<SessionSummary> & { appSessionId: string }): SessionSummary {
  return sessionSummary({
    interactionMode: 'spec',
    title: 'Source chat',
    cwd: '/repo',
    autonomy: 'medium',
    ...overrides,
  });
}

/** SessionForks over a stored source chat and a lineage store removed after the test. */
function harness(
  t: TestContext,
  options: {
    streaming?: boolean;
    provider?: 'droid' | 'claude' | 'codex';
    providerInstance?: Provider;
    send?: (appSessionId: string, text: string) => Promise<void>;
    updateModel?: SessionForksDependencies['updateModel'];
    isCloseRequested?: (appSessionId: string) => boolean;
    releaseCopy?: () => Promise<void>;
    onEvent?: (event: ServerEvent) => void;
    contextWindowTokens?: 1000000;
    duringFork?: (stored: Map<string, SessionSummary>) => void;
  } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), 'session-forks-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const lineage = new SessionLineageStore(sessionLineagePath(dir));
  const stored = new Map<string, SessionSummary>([
    [
      'source',
      summary({
        appSessionId: 'source',
        provider: options.provider ?? 'droid',
        ...(options.provider === 'codex' ? { resumeId: 'thread-source' } : {}),
        modelId: 'claude-opus',
        reasoningEffort: 'high',
        ...(options.contextWindowTokens
          ? { contextWindowTokens: options.contextWindowTokens }
          : {}),
      }),
    ],
  ]);
  const forkSources: ProviderForkSource[] = [];
  const events: ServerEvent[] = [];
  const errors: { code: string; clientRef?: string; message: string }[] = [];
  const order: string[] = [];
  const created: { command: SessionCreateCommand; branch: SessionBranch }[] = [];
  const forkOpens = new Set<string>();

  const forks = new SessionForks({
    provider: () =>
      options.providerInstance ?? {
        kind: 'droid',
        create: () => Promise.reject(new Error('not used')),
        resume: () => Promise.reject(new Error('not used')),
        readUsage: () => Promise.reject(new Error('not used')),
        fork: (source) => {
          forkSources.push(source);
          options.duringFork?.(stored);
          return Promise.resolve({ providerSessionId: 'copy', release: options.releaseCopy });
        },
      },
    registry: {
      getLive: (id) =>
        id === 'source' && options.streaming
          ? ({ summary: { ...stored.get('source'), streaming: true } } as never)
          : undefined,
      resolveSummary: (id) => {
        const found = stored.get(id);
        return found ? lineage.project(found) : undefined;
      },
      updateStoredSummary: (id: string, patch: SessionSummaryPatch) => {
        const found = stored.get(id);
        if (!found) return Promise.resolve(undefined);
        const updated = { ...found, ...patch };
        stored.set(id, updated);
        return Promise.resolve(updated);
      },
    },
    lineage,
    indexSessionFiles: (change) => {
      order.push(lineage.project(summary({ appSessionId: 'copy' })).lineage ? 'lineage' : 'none');
      // Indexing the copied file is what makes the copy a stored row.
      const appSessionId = change?.providerSessionId ?? 'copy';
      const head: { resumeId?: string } = change
        ? JSON.parse(readFileSync(change.path, 'utf8').split('\n')[0])
        : {};
      stored.set(
        appSessionId,
        summary({
          appSessionId,
          provider: options.provider ?? 'droid',
          resumeId: head.resumeId,
          title: 'Provider title',
        }),
      );
      return Promise.resolve();
    },
    readTranscript: readProviderTranscript,
    updateModel: (appSessionId, settings) => {
      order.push(
        `model ${appSessionId}: ${String(settings.modelId)} ${String(settings.reasoningEffort)}`,
      );
      const found = stored.get(appSessionId);
      if (found)
        stored.set(appSessionId, {
          ...found,
          modelId: settings.modelId ?? found.modelId,
          reasoningEffort: settings.reasoningEffort ?? undefined,
        });
      return options.updateModel?.(appSessionId, settings) ?? Promise.resolve(true);
    },
    beginForkOpen: (appSessionId) => {
      forkOpens.add(appSessionId);
    },
    endForkOpen: (appSessionId) => {
      forkOpens.delete(appSessionId);
    },
    isCloseRequested: (appSessionId) =>
      forkOpens.has(appSessionId) && (options.isCloseRequested?.(appSessionId) ?? false),
    isShutdownStarted: () => false,
    create: (command, branch) => {
      created.push({ command, branch });
      return Promise.resolve();
    },
    send: (appSessionId, text) => {
      order.push(`send ${appSessionId}: ${text}`);
      return options.send?.(appSessionId, text) ?? Promise.resolve();
    },
    emit: (event) => {
      order.push(event.type);
      events.push(event);
      options.onEvent?.(event);
    },
    emitError: (error) => errors.push(error),
  });

  return {
    forks,
    forkSources,
    events,
    errors,
    order,
    created,
    dir,
    stored,
  };
}

test('a same-harness fork copies the conversation and answers with the copied chat', async (t) => {
  const h = harness(t, { contextWindowTokens: 1000000 });

  await h.forks.fork({
    type: 'session.fork',
    clientRef: 'ref-1',
    appSessionId: 'source',
    lineage: 'fork',
    title: 'Source chat (fork)',
  });

  assert.deepEqual(h.errors, []);
  assert.deepEqual(h.forkSources, [
    { providerSessionId: 'source', cwd: '/repo', title: 'Source chat (fork)' },
  ]);
  // Lineage lands before indexing publishes the copy, so the first list that
  // shows it already knows where it came from.
  assert.deepEqual(h.order, ['lineage', 'session.forked']);
  assert.equal(h.events.length, 1);
  const [event] = h.events;
  assert.equal(event.type, 'session.forked');
  if (event.type !== 'session.forked') return;
  assert.equal(event.clientRef, 'ref-1');
  assert.equal(event.session.appSessionId, 'copy');
  assert.equal(event.session.title, 'Source chat (fork)');
  assert.equal(event.session.interactionMode, 'spec');
  assert.equal(event.session.autonomy, 'medium');
  assert.equal(event.session.modelId, 'claude-opus');
  assert.equal(event.session.contextWindowTokens, 1000000);
  const lineage = event.session.lineage;
  assert.equal(lineage?.kind, 'fork');
  assert.equal(lineage.sourceAppSessionId, 'source');
  assert.equal(typeof lineage.forkedAt, 'number');

  // The lineage survives a restart: a fresh store reads it back from disk.
  const reloaded = new SessionLineageStore(sessionLineagePath(h.dir));
  assert.deepEqual(reloaded.project(summary({ appSessionId: 'copy' })).lineage, lineage);
});

test('a same-harness side chat takes its question as the first message after the copy', async (t) => {
  const h = harness(t, { contextWindowTokens: 1000000 });

  await h.forks.fork({
    type: 'session.fork',
    clientRef: 'ref-4',
    appSessionId: 'source',
    lineage: 'side',
    title: 'Side chat',
    prompt: '  Why this migration order?  ',
    modelId: 'claude-sonnet',
  });

  assert.deepEqual(h.errors, []);
  // The renderer learns of the copy before its first turn starts streaming. A
  // picked model replaces the source's, and the source's effort goes with it.
  assert.deepEqual(h.order, [
    'lineage',
    'session.forked',
    'model copy: claude-sonnet null',
    `send copy: ${formatSideChatPrompt('Why this migration order?')}`,
  ]);
  const [event] = h.events;
  if (event.type !== 'session.forked') return assert.fail('expected session.forked');
  assert.equal(event.session.lineage?.kind, 'side');
  // The source's window belongs to its model; the picked model runs its own.
  assert.equal(event.session.contextWindowTokens, undefined);

  // The picker sends the source's model when the user leaves it alone, and
  // then the window carries over.
  const unchanged = harness(t, { contextWindowTokens: 1000000 });
  await unchanged.forks.fork({
    type: 'session.fork',
    clientRef: 'ref-5',
    appSessionId: 'source',
    lineage: 'side',
    title: 'Side chat',
    prompt: 'And the rollback?',
    modelId: 'claude-opus',
  });
  const [kept] = unchanged.events;
  if (kept.type !== 'session.forked') return assert.fail('expected session.forked');
  assert.equal(kept.session.contextWindowTokens, 1000000);
});

test('closing a native side chat before its first prompt releases the copy without sending', async (t) => {
  for (const closeAt of ['model', 'forked'] as const) {
    let closed = false;
    let releases = 0;
    const h = harness(t, {
      isCloseRequested: (appSessionId) => appSessionId === 'copy' && closed,
      onEvent: (event) => {
        if (event.type === 'session.forked' && closeAt === 'forked') closed = true;
      },
      updateModel: () => {
        if (closeAt === 'model') closed = true;
        return Promise.resolve(true);
      },
      releaseCopy: () => {
        releases += 1;
        return Promise.resolve();
      },
    });

    await h.forks.fork({
      type: 'session.fork',
      clientRef: 'closed-side',
      appSessionId: 'source',
      lineage: 'side',
      title: 'Side chat',
      prompt: 'Do not send this question',
      modelId: 'claude-sonnet',
    });

    assert.deepEqual(h.errors, []);
    assert.equal(h.events[0]?.type, 'session.forked');
    assert.equal(
      h.order.some((step) => step.startsWith('model ')),
      closeAt === 'model',
    );
    assert.equal(
      h.order.some((step) => step.startsWith('send ')),
      false,
    );
    assert.equal(releases, 1);
  }
});

test('a fork that cannot run is refused with its client ref and copies nothing', async (t) => {
  // A plain fork of a chat mid-turn would copy half an answer.
  const streaming = harness(t, { streaming: true });
  await streaming.forks.fork({
    type: 'session.fork',
    clientRef: 'ref-2',
    appSessionId: 'source',
    lineage: 'fork',
    title: 'Source chat (fork)',
  });
  assert.deepEqual(streaming.forkSources, []);
  assert.deepEqual(streaming.events, []);
  assert.deepEqual(
    streaming.errors.map((error) => [error.code, error.clientRef]),
    [['session.create_failed', 'ref-2']],
  );

  // Another harness cannot copy the transcript, so it needs a first message.
  const crossHarness = harness(t);
  await crossHarness.forks.fork({
    type: 'session.fork',
    clientRef: 'ref-3',
    appSessionId: 'source',
    lineage: 'side',
    title: 'Side chat',
    provider: 'codex',
    prompt: '   ',
  });
  assert.deepEqual(crossHarness.forkSources, []);
  assert.equal(crossHarness.errors.length, 1);
  assert.equal(crossHarness.errors[0].clientRef, 'ref-3');
  assert.match(crossHarness.errors[0].message, /first message/);
});

test('a side chat on a chat with a turn in progress branches from its stored transcript', async (t) => {
  const h = harness(t, { streaming: true });
  storeTranscript('source', 'Step one moves the schema.');

  await h.forks.fork({
    type: 'session.fork',
    clientRef: 'ref-5',
    appSessionId: 'source',
    lineage: 'side',
    title: 'Side chat',
    prompt: 'Is step one safe?',
  });

  assert.deepEqual(h.errors, []);
  // The provider would copy half an answer, so nothing is copied natively.
  assert.deepEqual(h.forkSources, []);
  assert.equal(h.created.length, 1);
  const [{ command, branch }] = h.created;
  assert.equal(command.clientRef, 'ref-5');
  assert.equal(command.provider, 'droid');
  assert.equal(command.goal, 'Is step one safe?');
  // Same harness, so it keeps the source's model even without copying.
  assert.equal(command.modelId, 'claude-opus');
  assert.equal(command.reasoningEffort, 'high');
  assert.equal(branch.lineage.kind, 'side');
  assert.equal(branch.lineage.sourceAppSessionId, 'source');
  assert.match(branch.prompt, /Is step one safe\?/);
  assert.match(branch.prompt, /Step one moves the schema\./);
});

test('a settled Codex side chat natively forks and runs on one app-server', async (t) => {
  const provider = new CodexProvider();
  let session: ProviderSession | undefined;
  const originalCodexPath = process.env.CODEX_PATH;
  t.after(async () => {
    await session?.close();
    if (originalCodexPath === undefined) delete process.env.CODEX_PATH;
    else process.env.CODEX_PATH = originalCodexPath;
  });
  const h = harness(t, {
    provider: 'codex',
    providerInstance: provider,
    send: async (appSessionId, text) => {
      const stored = h.stored.get(appSessionId);
      assert.ok(stored);
      session = await provider.resume(appSessionId, {
        appSessionId,
        resumeId: stored.resumeId,
        cwd: h.dir,
        autonomy: stored.autonomy,
        modelId: stored.modelId,
        reasoningEffort: stored.reasoningEffort,
        interactions: {
          isActive: () => true,
          cancelPending: () => undefined,
          requestApproval: async () => 'cancel',
          requestQuestion: async () => ({ cancelled: true, answers: [] }),
        },
      });
      for await (const event of session.stream(text)) assert.equal(event.done, true);
    },
  });
  const executable = join(h.dir, 'fake-codex.mjs');
  const log = join(h.dir, 'requests.jsonl');
  // A stdio stand-in counts real transport spawns without launching a harness.
  writeFileSync(
    executable,
    `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
const log = new URL('./requests.jsonl', import.meta.url);
appendFileSync(log, JSON.stringify({ method: 'spawn' }) + '\\n');
const write = (message) => process.stdout.write(JSON.stringify(message) + '\\n');
createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  appendFileSync(log, line + '\\n');
  if (message.id === undefined) return;
  let result = {};
  if (message.method === 'thread/fork' || message.method === 'thread/resume') {
    result = { thread: { id: 'thread-copy' }, model: 'codex-model' };
  } else if (message.method === 'turn/start') {
    result = { turn: { id: 'turn-copy' } };
  } else if (message.method === 'skills/list' || message.method === 'app/list') {
    result = { data: [], nextCursor: null };
  } else if (message.method === 'plugin/installed') {
    result = { marketplaces: [] };
  }
  write({ id: message.id, result });
  if (message.method === 'turn/start') write({ method: 'turn/completed', params: {
    threadId: 'thread-copy', turn: { id: 'turn-copy', status: 'completed' }
  } });
});
`,
  );
  chmodSync(executable, 0o755);
  process.env.CODEX_PATH = executable;
  const source = h.stored.get('source');
  assert.ok(source);
  h.stored.set('source', { ...source, cwd: h.dir });
  storeTranscript('source', 'Step one moves the schema.', 'codex');

  await h.forks.fork({
    type: 'session.fork',
    clientRef: 'ref-codex-side',
    appSessionId: 'source',
    lineage: 'side',
    title: 'Side chat',
    prompt: 'Is step one safe?',
    modelId: 'codex-model',
    reasoningEffort: 'medium',
  });

  assert.deepEqual(h.errors, []);
  assert.equal(h.created.length, 0);
  const [event] = h.events;
  assert.equal(event?.type, 'session.forked');
  if (event.type !== 'session.forked') return assert.fail('expected session.forked');
  assert.equal(event.clientRef, 'ref-codex-side');
  assert.equal(event.session.lineage?.kind, 'side');
  assert.equal(event.session.lineage.sourceAppSessionId, 'source');
  assert.match(
    await readProviderTranscript(event.session.appSessionId),
    /Step one moves the schema\./,
  );
  const requests: { method: string; params: Record<string, unknown> }[] = readFileSync(log, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.equal(requests.filter(({ method }) => method === 'spawn').length, 1);
  assert.deepEqual(
    requests.filter(({ method }) => method === 'thread/fork').map(({ params }) => params),
    [{ threadId: 'thread-source', excludeTurns: true }],
  );
  assert.equal(
    requests.find(({ method }) => method === 'thread/resume')?.params.threadId,
    'thread-copy',
  );
  assert.equal(
    requests.some(({ method }) => method === 'thread/start' || method === 'thread/settings/update'),
    false,
  );
  const turn = requests.find(({ method }) => method === 'turn/start')?.params;
  assert.ok(turn);
  assert.equal(turn.threadId, 'thread-copy');
  assert.equal(turn.model, 'codex-model');
  assert.equal(turn.effort, 'medium');
  assert.equal(turn.serviceTier, 'default');
  assert.equal(turn.approvalPolicy, 'on-request');
  assert.deepEqual(turn.input, [{ type: 'text', text: formatSideChatPrompt('Is step one safe?') }]);
});

test('a copy taken while the source was replaced is not kept', async (t) => {
  const h = harness(t, {
    provider: 'claude',
    duringFork: (stored) => {
      const source = stored.get('source');
      if (source) stored.set('source', { ...source, providerSessionId: 'replacement' });
    },
  });

  await h.forks.fork({
    type: 'session.fork',
    clientRef: 'ref-6',
    appSessionId: 'source',
    lineage: 'fork',
    title: 'Source chat (fork)',
  });

  assert.equal(h.forkSources.length, 1);
  assert.deepEqual(h.order, []);
  assert.equal(h.errors.length, 1);
  assert.equal(h.errors[0].clientRef, 'ref-6');
  assert.match(h.errors[0].message, /changed while it was being copied/);
});

test('an unreadable lineage file is moved aside instead of overwritten', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'session-lineage-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = sessionLineagePath(dir);
  writeFileSync(path, '{ not json');

  const store = new SessionLineageStore(path);
  const lineage = { kind: 'side', sourceAppSessionId: 'source', forkedAt: 1 } as const;
  store.record('copy', lineage);

  assert.equal(readFileSync(`${path}.unreadable`, 'utf8'), '{ not json');
  const reloaded = new SessionLineageStore(path);
  assert.deepEqual(reloaded.project(summary({ appSessionId: 'copy' })).lineage, lineage);
});
