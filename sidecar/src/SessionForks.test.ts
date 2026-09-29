import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { ServerEvent, SessionSummary } from './protocol.js';
import type { ProviderForkSource } from './providers/session.js';
import type { SessionBranch, SessionCreateCommand } from './SessionLifecycle.js';
import { SessionLineageStore, sessionLineagePath } from './sessionLineage.js';
import type { SessionSummaryPatch } from './SessionRegistry.js';
import { formatSideChatPrompt } from './sideChatPrompt.js';

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

function storeDroidTranscript(providerSessionId: string, assistantText: string): void {
  const dir = join(home, '.factory', 'sessions', '2026', '06');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${providerSessionId}.jsonl`);
  const lines = [
    { type: 'session_start', id: providerSessionId, cwd: home, sessionTitle: 'Source chat' },
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
  return {
    providerSessionId: overrides.appSessionId,
    provider: 'droid',
    sessionPurpose: 'chat',
    interactionMode: 'spec',
    role: 'primary',
    title: 'Source chat',
    goal: 'Plan the migration',
    cwd: '/repo',
    autonomy: 'medium',
    phase: 'paused',
    features: [],
    tokensIn: 0,
    tokensOut: 0,
    contextTokens: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function harness(
  options: {
    streaming?: boolean;
    provider?: 'droid' | 'claude';
    duringFork?: (stored: Map<string, SessionSummary>) => void;
  } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), 'session-forks-'));
  const lineage = new SessionLineageStore(sessionLineagePath(dir));
  const stored = new Map<string, SessionSummary>([
    [
      'source',
      summary({
        appSessionId: 'source',
        provider: options.provider ?? 'droid',
        modelId: 'claude-opus',
        reasoningEffort: 'high',
      }),
    ],
  ]);
  const forkSources: ProviderForkSource[] = [];
  const events: ServerEvent[] = [];
  const errors: { code: string; clientRef?: string; message: string }[] = [];
  const order: string[] = [];
  const created: { command: SessionCreateCommand; branch: SessionBranch }[] = [];

  const forks = new SessionForks({
    provider: () => ({
      kind: 'droid',
      create: () => Promise.reject(new Error('not used')),
      resume: () => Promise.reject(new Error('not used')),
      fork: (source) => {
        forkSources.push(source);
        options.duringFork?.(stored);
        return Promise.resolve({ providerSessionId: 'copy' });
      },
    }),
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
    indexSessionFiles: () => {
      order.push(lineage.project(summary({ appSessionId: 'copy' })).lineage ? 'lineage' : 'none');
      // Indexing the copied file is what makes the copy a stored row.
      stored.set('copy', summary({ appSessionId: 'copy', title: 'Provider title' }));
      return Promise.resolve();
    },
    readTranscript: () => Promise.reject(new Error('not used')),
    updateModel: (appSessionId, settings) => {
      order.push(
        `model ${appSessionId}: ${String(settings.modelId)} ${String(settings.reasoningEffort)}`,
      );
      return Promise.resolve(true);
    },
    isShutdownStarted: () => false,
    create: (command, branch) => {
      created.push({ command, branch });
      return Promise.resolve();
    },
    send: (appSessionId, text) => {
      order.push(`send ${appSessionId}: ${text}`);
      return Promise.resolve();
    },
    emit: (event) => {
      order.push(event.type);
      events.push(event);
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
    cleanup: () => {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('a same-harness fork copies the conversation and answers with the copied chat', async (t) => {
  const h = harness();
  t.after(h.cleanup);

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
  const lineage = event.session.lineage;
  assert.equal(lineage?.kind, 'fork');
  assert.equal(lineage.sourceAppSessionId, 'source');
  assert.equal(typeof lineage.forkedAt, 'number');

  // The lineage survives a restart: a fresh store reads it back from disk.
  const reloaded = new SessionLineageStore(sessionLineagePath(h.dir));
  assert.deepEqual(reloaded.project(summary({ appSessionId: 'copy' })).lineage, lineage);
});

test('a same-harness side chat takes its question as the first message after the copy', async (t) => {
  const h = harness();
  t.after(h.cleanup);

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
});

test('a chat with a turn in progress is not forked', async (t) => {
  const h = harness({ streaming: true });
  t.after(h.cleanup);

  await h.forks.fork({
    type: 'session.fork',
    clientRef: 'ref-2',
    appSessionId: 'source',
    lineage: 'fork',
    title: 'Source chat (fork)',
  });

  assert.deepEqual(h.forkSources, []);
  assert.deepEqual(h.events, []);
  assert.equal(h.errors.length, 1);
  assert.equal(h.errors[0].code, 'session.create_failed');
  assert.equal(h.errors[0].clientRef, 'ref-2');
});

test('a side chat on a chat with a turn in progress branches from its stored transcript', async (t) => {
  const h = harness({ streaming: true });
  t.after(h.cleanup);
  storeDroidTranscript('source', 'Step one moves the schema.');

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

test('a fork to another harness needs a first message', async (t) => {
  const h = harness();
  t.after(h.cleanup);

  await h.forks.fork({
    type: 'session.fork',
    clientRef: 'ref-3',
    appSessionId: 'source',
    lineage: 'side',
    title: 'Side chat',
    provider: 'codex',
    prompt: '   ',
  });

  assert.deepEqual(h.forkSources, []);
  assert.equal(h.errors.length, 1);
  assert.equal(h.errors[0].clientRef, 'ref-3');
  assert.match(h.errors[0].message, /first message/);
});

test('a copy taken while the source was replaced is not kept', async (t) => {
  const h = harness({
    provider: 'claude',
    duringFork: (stored) => {
      const source = stored.get('source');
      if (source) stored.set('source', { ...source, providerSessionId: 'replacement' });
    },
  });
  t.after(h.cleanup);

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
