import test from 'node:test';
import assert from 'node:assert/strict';
import type { SessionSummary, SidebarRequest } from '../types/bridge';
import { withLocalStorageMap } from '../test/localStorage';
import { DEFAULT_SIDEBAR_PREFERENCES } from './sidebarActivity';
import { answerSidebarRequest } from './sidebarRequests';
import { sidebarPreferences, updateSidebarPreferences } from './sidebarPreferences';

type SidebarState = Parameters<typeof answerSidebarRequest>[1];

function chat(appSessionId: string, updatedAt = 100): SessionSummary {
  return {
    appSessionId,
    title: `Chat ${appSessionId}`,
    goal: '',
    cwd: '/workspace',
    provider: 'droid',
    sessionPurpose: 'chat',
    interactionMode: 'auto',
    role: 'primary',
    autonomy: 'off',
    phase: 'completed',
    streaming: false,
    createdAt: 1,
    updatedAt,
    features: [],
    tokensIn: 0,
    tokensOut: 0,
    contextTokens: 0,
  };
}

function sidebarState(sessions: SessionSummary[]): SidebarState {
  return {
    sessions: Object.fromEntries(sessions.map((session) => [session.appSessionId, session])),
    sessionOrder: sessions.map((session) => session.appSessionId),
    chatMetadata: {},
    projects: [],
    pendingPermissions: {},
    pendingQuestions: {},
    activeAppSessionId: null,
    sessionLastSeen: {},
  };
}

function request(query: SidebarRequest['query']): SidebarRequest {
  return { requestId: 'request-1', expiresAt: Date.now() + 3_000, query };
}

// The preferences owner caches what it loaded, so each test starts it clean.
function withCleanPreferences(run: () => void): void {
  withLocalStorageMap({}, () => {
    updateSidebarPreferences({ ...DEFAULT_SIDEBAR_PREFERENCES, settled: {} });
    run();
  });
}

test('a request too close to expiring is neither answered nor acted on', () => {
  const archived: string[] = [];
  const result = answerSidebarRequest(
    {
      ...request({
        kind: 'mark',
        mark: 'archived',
        targets: [{ appSessionId: 'a', updatedAt: 100 }],
      }),
      expiresAt: Date.now() + 500,
    },
    sidebarState([chat('a')]),
    (id) => archived.push(id),
  );
  assert.equal(result, null);
  assert.deepEqual(archived, []);
});

test('rows are the chats the sidebar shows, with what each waits on', () => {
  withCleanPreferences(() => {
    const state = sidebarState([
      chat('lead'),
      chat('thread'),
      chat('archived'),
      chat('deleted'),
      chat('asking'),
    ]);
    state.chatMetadata = {
      archived: { archivedAt: 5 },
      deleted: { deletedAt: 5 },
      lead: { pinnedAt: 5, displayTitle: 'Payments' },
    };
    state.projects = [
      {
        id: 'project-1',
        title: 'Payments',
        paused: false,
        launching: 0,
        plan: [],
        queued: 0,
        uncertain: 0,
        threads: [
          { appSessionId: 'lead', title: 'Payments', waiting: false },
          { appSessionId: 'thread', ownerAppSessionId: 'lead', title: 'Tests', waiting: false },
        ],
      },
    ];
    state.activeAppSessionId = 'lead';
    state.pendingPermissions = {
      lead: {
        appSessionId: 'lead',
        requestId: 'permission-1',
        kind: 'exec',
        title: 'Run command',
        detail: 'pnpm test',
        raw: {},
      },
    };
    state.pendingQuestions = {
      asking: {
        appSessionId: 'asking',
        requestId: 'question-1',
        questions: [{ index: 0, question: 'Which API version?', options: ['v2', 'v3'] }],
      },
    };

    const result = answerSidebarRequest(request({ kind: 'rows' }), state, () => undefined);

    assert.ok(result?.kind === 'rows');
    assert.deepEqual(result.rows, [
      {
        appSessionId: 'lead',
        title: 'Payments',
        status: 'approval',
        label: 'Needs approval',
        unread: false,
        onScreen: true,
        pinned: true,
        permission: { title: 'Run command', detail: 'pnpm test' },
      },
      {
        appSessionId: 'asking',
        title: 'Chat asking',
        status: 'input',
        label: 'Needs input',
        unread: false,
        question: {
          requestId: 'question-1',
          questions: [{ index: 0, question: 'Which API version?', options: ['v2', 'v3'] }],
        },
      },
    ]);
  });
});

test('archive acts only on chats the sidebar shows and never on the chat on screen', () => {
  withCleanPreferences(() => {
    const state = sidebarState([chat('open'), chat('done'), chat('gone')]);
    state.activeAppSessionId = 'open';
    state.chatMetadata = { gone: { archivedAt: 5 } };
    const targets = ['open', 'done', 'gone', 'unknown', '__proto__'].map((appSessionId) => ({
      appSessionId,
      updatedAt: 100,
    }));
    const archived: string[] = [];

    const result = answerSidebarRequest(
      request({ kind: 'mark', mark: 'archived', targets }),
      state,
      (id) => archived.push(id),
    );

    assert.ok(result?.kind === 'mark');
    assert.deepEqual(result.outcomes, [
      { appSessionId: 'open', done: false, reason: 'It is open on screen.' },
      { appSessionId: 'done', done: true },
      { appSessionId: 'gone', done: false, reason: 'Not in the sidebar.' },
      { appSessionId: 'unknown', done: false, reason: 'Not in the sidebar.' },
      { appSessionId: '__proto__', done: false, reason: 'Not in the sidebar.' },
    ]);
    assert.deepEqual(archived, ['done']);
  });
});

test('settle is refused after new activity and otherwise saved where the Sidebar reads it', () => {
  withCleanPreferences(() => {
    const state = sidebarState([chat('moved', 200), chat('quiet', 100)]);

    const result = answerSidebarRequest(
      request({
        kind: 'mark',
        mark: 'settled',
        targets: [
          { appSessionId: 'moved', updatedAt: 150 },
          { appSessionId: 'quiet', updatedAt: 100 },
        ],
      }),
      state,
      () => undefined,
    );

    assert.ok(result?.kind === 'mark');
    assert.deepEqual(result.outcomes, [
      { appSessionId: 'moved', done: false, reason: 'It has new activity.' },
      { appSessionId: 'quiet', done: true },
    ]);
    assert.deepEqual(sidebarPreferences().settled, { quiet: 100 });
    const rows = answerSidebarRequest(
      request({ kind: 'rows', appSessionIds: ['quiet'] }),
      state,
      () => undefined,
    );
    assert.ok(rows?.kind === 'rows');
    assert.equal(rows.rows[0].status, 'settled');
  });
});
