import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import type { SessionFileChange } from './sessionFileCache.js';
import { createSessionManagerTestContext } from './testing/sessionManagerTestContext.js';
import type { ChildSessionSummary, SessionSummary, ServerEvent } from './protocol.js';

type SessionHistoryEvent = Extract<ServerEvent, { type: 'session.history' }>;

function isSessionHistory(event: ServerEvent): event is SessionHistoryEvent {
  return event.type === 'session.history';
}

function writeHistorySession(
  home: string,
  id: string,
  lines: unknown[],
  sessionStart: Record<string, unknown> = {},
): SessionFileChange {
  const dir = path.join(home, '.factory', 'sessions', '2026', '07');
  mkdirSync(dir, { recursive: true });
  const sessionPath = path.join(dir, `${id}.jsonl`);
  writeFileSync(
    sessionPath,
    [
      JSON.stringify({
        type: 'session_start',
        id,
        cwd: home,
        sessionTitle: 'History',
        settings: { interactionMode: 'auto' },
        ...sessionStart,
      }),
      ...lines.map((line) => JSON.stringify(line)),
    ].join('\n') + '\n',
  );
  return { providerSessionId: id, path: sessionPath };
}

function assistantMessage(id: string, text: string, timestamp: number): Record<string, unknown> {
  return {
    type: 'message',
    id,
    timestamp: new Date(timestamp).toISOString(),
    message: { role: 'assistant', content: [{ type: 'text', text }] },
  };
}

function summary(appSessionId: string, providerSessionId: string): SessionSummary {
  const now = Date.now();
  return {
    appSessionId,
    providerSessionId,
    provider: 'droid',
    sessionPurpose: 'chat',
    interactionMode: 'auto',
    role: 'primary',
    title: `Historical ${appSessionId}`,
    goal: '',
    cwd: '',
    workspaceKind: 'none',
    autonomy: 'low',
    phase: 'paused',
    streaming: false,
    queuedSends: 0,
    features: [],
    tokensIn: 0,
    tokensOut: 0,
    contextTokens: 0,
    createdAt: now,
    updatedAt: now,
  };
}

function linkedWorker(
  parentAppSessionId: string,
  childSessionId: string,
  toolUseId: string,
  status: ChildSessionSummary['status'] = 'completed',
): ChildSessionSummary {
  return {
    parentAppSessionId,
    childSessionId,
    role: 'worker',
    status,
    modelId: 'model-default',
    spawnLink: { kind: 'tool-use', id: toolUseId },
    transcriptAvailable: true,
    streamFidelity: 'state',
  };
}

test('child.loadHistory serves each logical child its own pages and rejects unknown children', async () => {
  const h = createSessionManagerTestContext();
  try {
    h.fixture.publishSessionFiles([
      writeHistorySession(h.home, 'provider-child-a', [
        assistantMessage('oldest', 'oldest', 1),
        assistantMessage('middle', 'middle', 2),
        assistantMessage('newest', 'newest', 3),
      ]),
      writeHistorySession(h.home, 'provider-child-b', [assistantMessage('b', 'child b', 1)]),
    ]);
    const record = (
      childSessionId: string,
      providerSessionId: string,
      role: ChildSessionSummary['role'],
      status: ChildSessionSummary['status'],
    ) => ({
      parentAppSessionId: 'parent',
      childSessionId,
      providerSessionId,
      role,
      status,
      modelId: 'model-default',
      transcriptAvailable: true,
      updatedAt: 1,
    });
    h.history.seedChildSessions([
      record('logical-a', 'provider-child-a', 'worker', 'completed'),
      record('logical-b', 'provider-child-b', 'validator', 'completed'),
      record('logical-empty', 'provider-child-empty', 'worker', 'running'),
    ]);
    const load = async (childSessionId: string, cursor?: string): Promise<SessionHistoryEvent> => {
      await h.handle({
        type: 'child.loadHistory',
        parentAppSessionId: 'parent',
        childSessionId,
        limit: 2,
        ...(cursor ? { cursor } : {}),
      });
      const page = h.events.filter(isSessionHistory).at(-1);
      assert.ok(page);
      assert.equal(page.childSessionId, childSessionId);
      return page;
    };
    const rows = (page: SessionHistoryEvent) =>
      page.transcripts.map((event) => [
        event.text,
        event.appSessionId,
        event.sourceSessionId,
        event.role,
      ]);

    const initial = await load('logical-a');
    assert.equal(initial.mode, 'replace');
    assert.equal(initial.hasMore, true);
    assert.deepEqual(rows(initial), [
      ['middle', 'parent', 'logical-a', 'worker'],
      ['newest', 'parent', 'logical-a', 'worker'],
    ]);
    assert.equal(
      h.calls.some((call) => call.target === 'history' && call.method === 'recordEvent'),
      false,
      'child history pages are replayed, not re-recorded into the parent timeline',
    );
    const older = await load('logical-a', initial.olderCursor);
    assert.equal(older.mode, 'prepend');
    assert.equal(older.hasMore, false);
    assert.deepEqual(rows(older), [['oldest', 'parent', 'logical-a', 'worker']]);

    assert.deepEqual(rows(await load('logical-b')), [
      ['child b', 'parent', 'logical-b', 'validator'],
    ]);
    const empty = await load('logical-empty');
    assert.equal(empty.mode, 'replace');
    assert.deepEqual(empty.transcripts, []);

    const pages = h.events.filter(isSessionHistory).length;
    await h.handle({
      type: 'child.loadHistory',
      parentAppSessionId: 'parent',
      childSessionId: 'missing-child',
    });
    assert.equal(
      h.events.some(
        (event) =>
          event.type === 'child.error' &&
          event.code === 'child.not_in_session' &&
          event.childSessionId === 'missing-child',
      ),
      true,
    );
    assert.equal(h.events.filter(isSessionHistory).length, pages);
  } finally {
    await h.dispose();
  }
});

test('a linked child opens, replays, and keeps its status beside live Task children', async () => {
  const h = createSessionManagerTestContext();

  try {
    h.fixture.seedHistorySummaries([summary('app-a2', 'provider-a2')]);
    h.fixture.seedChildSessions([
      linkedWorker('app-a2', 'worker-a2', 'tool-a2', 'paused'),
      linkedWorker('app-a2', 'worker-unknown-a2', 'tool-unknown-a2'),
    ]);
    h.fixture.publishSessionFiles([
      writeHistorySession(h.home, 'provider-a2', [
        {
          type: 'message',
          id: 'user-a2',
          timestamp: new Date(0).toISOString(),
          message: { role: 'user', content: [{ type: 'text', text: 'parent prompt' }] },
        },
        assistantMessage('parent-a2', 'parent response', 1),
      ]),
      writeHistorySession(h.home, 'worker-a2', [assistantMessage('child-a2', 'child replay', 0)], {
        callingSessionId: 'provider-a2',
        callingToolUseId: 'tool-a2',
      }),
    ]);

    await h.handle({ type: 'session.loadHistory', appSessionId: 'app-a2' });
    const historical = h.events.filter(isSessionHistory).at(-1);
    assert.ok(historical);
    assert.equal(
      historical.childSessions?.find((child) => child.childSessionId === 'worker-a2')?.status,
      'paused',
    );
    assert.equal(
      historical.childSessions?.find((child) => child.childSessionId === 'worker-unknown-a2')
        ?.status,
      'completed',
    );

    await h.handle({ type: 'session.resume', appSessionId: 'app-a2' });
    await h.handle({
      type: 'child.open',
      parentAppSessionId: 'app-a2',
      childSessionId: 'worker-a2',
      requestId: 'open-worker-a2',
    });
    const primary = h.provider.session('provider-a2');
    h.history.seedSessionLaunchSettings('worker-completed-a2', {
      modelId: 'model-default',
    });
    h.history.seedSessionLaunchSettings('worker-running-a2', {
      modelId: 'model-default',
    });
    primary.queueStreamEvents([
      {
        type: 'tool_progress',
        toolName: 'Task',
        toolUseId: 'tool-completed-a2',
        content: '',
        update: {
          type: 'tool_call',
          subagentSessionId: 'worker-completed-a2',
          parameters: { subagent_type: 'worker' },
        },
      },
      {
        type: 'tool_result',
        toolName: 'Task',
        toolUseId: 'tool-completed-a2',
        content: 'done',
        isError: false,
      },
      {
        type: 'tool_progress',
        toolName: 'Task',
        toolUseId: 'tool-running-a2',
        content: '',
        update: {
          type: 'tool_call',
          subagentSessionId: 'worker-running-a2',
          parameters: { subagent_type: 'worker' },
        },
      },
    ]);
    await h.handle({
      type: 'session.send',
      appSessionId: 'app-a2',
      text: 'run child',
    });
    await h.handle({ type: 'session.loadHistory', appSessionId: 'app-a2' });

    assert.equal(h.runtime.loadCalls.at(-1)?.sessionId, 'worker-a2');
    assert.equal(
      h.events.some(
        (event) =>
          event.type === 'child.updated' &&
          event.childSessionId === 'worker-a2' &&
          event.access === 'ready',
      ),
      true,
    );
    assert.equal(
      h.events.some(
        (event) =>
          event.type === 'session.history' &&
          event.childSessionId === 'worker-a2' &&
          event.transcripts.some(
            (transcript) =>
              transcript.sourceSessionId === 'worker-a2' && transcript.text === 'child replay',
          ),
      ),
      true,
    );
    const live = h.events.filter(isSessionHistory).at(-1);
    assert.ok(live);
    assert.equal(
      live.childSessions?.find((child) => child.childSessionId === 'worker-a2')?.status,
      'paused',
    );
    assert.equal(
      live.childSessions?.find((child) => child.spawnLink?.id === 'tool-completed-a2')?.status,
      'completed',
    );
    assert.equal(
      live.childSessions?.find((child) => child.spawnLink?.id === 'tool-running-a2')?.status,
      'running',
    );
    assert.equal(
      live.childSessions?.find((child) => child.childSessionId === 'worker-unknown-a2')?.status,
      'completed',
    );
  } finally {
    await h.dispose();
  }
});

test('opening a child for a non-live historical session settles honestly', async () => {
  const h = createSessionManagerTestContext();

  try {
    h.fixture.seedHistorySummaries([summary('app-a4', 'provider-a4')]);
    h.fixture.seedChildSessions([linkedWorker('app-a4', 'worker-a4', 'tool-a4')]);

    await h.handle({
      type: 'child.open',
      parentAppSessionId: 'app-a4',
      childSessionId: 'worker-a4',
      requestId: 'open-worker-a4',
    });

    assert.equal(h.runtime.loadCalls.length, 0);
    assert.equal(
      h.events.some(
        (event) =>
          event.type === 'child.updated' &&
          event.parentAppSessionId === 'app-a4' &&
          event.childSessionId === 'worker-a4' &&
          event.access === 'history',
      ),
      true,
    );
    assert.equal(
      h.events.some(
        (event) =>
          event.type === 'child.error' &&
          event.parentAppSessionId === 'app-a4' &&
          event.childSessionId === 'worker-a4',
      ),
      false,
    );
  } finally {
    await h.dispose();
  }
});
