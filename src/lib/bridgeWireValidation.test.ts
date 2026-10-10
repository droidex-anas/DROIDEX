import assert from 'node:assert/strict';
import test from 'node:test';

import { serverWireMessage } from './bridgeWireValidation';

function batch(event: unknown): unknown {
  return {
    type: 'events.batch',
    generation: 'generation-1',
    firstSeq: 1,
    lastSeq: 1,
    events: [{ seq: 1, event }],
  };
}

function assertAccepted(event: unknown): void {
  assert.notEqual(serverWireMessage(batch(event)), null, JSON.stringify(event));
}

function assertRejected(event: unknown): void {
  assert.equal(serverWireMessage(batch(event)), null, JSON.stringify(event));
}

test('canvas asset replies accept owned images and reject malformed metadata', () => {
  const asset = {
    assetId: 'a'.repeat(64),
    mediaType: 'image/png',
    byteLength: 512,
    width: 32,
    height: 16,
  };
  const result = { type: 'canvas.result', requestId: 'assets-1', ok: true };
  assertAccepted({ ...result, reply: { kind: 'assets', assets: [asset] } });
  assertAccepted({ ...result, reply: { kind: 'assets', assets: [] } });
  for (const malformed of [
    { ...asset, assetId: 'not-an-image-digest' },
    { ...asset, mediaType: 'image/svg+xml' },
    { ...asset, byteLength: 0 },
    { ...asset, width: 1.5 },
    { ...asset, height: 8193 },
  ]) {
    assertRejected({ ...result, reply: { kind: 'assets', assets: [malformed] } });
  }
});

test('interaction wire validation preserves rich questions and approval eligibility', () => {
  const request = {
    appSessionId: 'app',
    requestId: 'approval',
    kind: 'edit',
    title: 'Update file',
    detail: '/a.ts',
    diff: '-old\n+new',
    canAlwaysAllow: false,
    raw: {},
  };
  assertAccepted({ type: 'approval.requested', request });
  assertRejected({
    type: 'approval.requested',
    request: { ...request, canAlwaysAllow: undefined },
  });
  assertRejected({
    type: 'approval.requested',
    request: { ...request, kind: 'unknown-permission' },
  });
  const question = {
    appSessionId: 'app',
    requestId: 'question',
    questions: [
      {
        index: 0,
        question: 'Choose',
        header: 'Features',
        multiSelect: true,
        options: [{ label: 'Search', description: 'Find records' }],
      },
    ],
  };
  assertAccepted({ type: 'question.requested', question });
  assertRejected({
    type: 'question.requested',
    question: { ...question, questions: [{ ...question.questions[0], options: ['Search'] }] },
  });
});

test('accepts provider statuses and rejects unknown providers or readiness', () => {
  const model = {
    id: 'droid-core',
    displayName: 'Droid Core',
    isCustom: false,
    supportedReasoningEfforts: ['low', 'high'],
  };
  const status = { provider: 'droid', readiness: 'ready', message: 'ok', models: [model] };
  const providerStatus = (statuses: unknown) => ({ type: 'provider.status', statuses });
  assertAccepted(providerStatus([status]));
  assertAccepted(providerStatus([{ ...status, defaultModelId: 'droid-core' }]));
  for (const malformed of [
    { ...status, provider: 'aider' },
    { ...status, readiness: 'busy' },
    { ...status, models: [{ ...model, id: '' }] },
    { ...status, models: [{ ...model, supportedReasoningEfforts: [7] }] },
    { ...status, message: 7 },
    { ...status, defaultModelId: 7 },
  ]) {
    assertRejected(providerStatus([malformed]));
  }
  assertRejected(providerStatus({}));
});

test('search results require the indexing flag and object rows; object payloads reject arrays', () => {
  const search = { type: 'sessions.searchResults', requestId: 'req-1', results: [] };
  assertRejected(search);
  assertAccepted({ ...search, indexingIncomplete: false });
  assertRejected({ ...search, results: [[]], indexingIncomplete: false });
  assertRejected({ type: 'settings.defaults', defaults: [] });
  assertAccepted({ type: 'settings.defaults', defaults: {} });
});

test('rejects malformed features in session summaries and mission updates', () => {
  const malformedFeature = { status: 'pending' };
  const session = {
    appSessionId: 'app-1',
    sessionPurpose: 'mission-control',
    interactionMode: 'agi',
    role: 'primary',
    title: 'Mission',
    goal: 'Ship safely',
    cwd: '/repo',
    autonomy: 'high',
    phase: 'running',
    features: [malformedFeature],
    tokensIn: 0,
    tokensOut: 0,
    contextTokens: 0,
    createdAt: 1,
    updatedAt: 1,
  };

  assertRejected({ type: 'session.updated', session });
  assertRejected({ type: 'mission.features', appSessionId: 'app-1', features: [malformedFeature] });
});

test('validates complete automation snapshot records', () => {
  const draft = {
    title: 'Morning summary',
    prompt: 'Summarize the repository.',
    target: { kind: 'new-session' },
    files: [],
    workspaceCwd: '/repo',
    executionMode: 'worktree',
    enabled: true,
    schedule: { kind: 'daily', time: '09:00' },
    timezone: 'UTC',
    modelId: 'model-a',
    reasoningEffort: 'high',
    autonomy: 'low',
  };
  const automation = {
    id: 'automation-1',
    ...draft,
    nextRunAt: 2,
    lastRunAt: 1,
    lastRunStatus: 'completed',
    lastRunError: null,
    lastRunDurationMs: 100,
    lastAppSessionId: 'session-1',
    completedAt: null,
    createdAt: 1,
    updatedAt: 2,
  };
  const run = {
    id: 'run-1',
    automationId: automation.id,
    automation: {
      id: automation.id,
      title: automation.title,
      prompt: automation.prompt,
      target: automation.target,
      files: automation.files,
      workspaceCwd: automation.workspaceCwd,
      executionMode: automation.executionMode,
      timezone: automation.timezone,
      modelId: automation.modelId,
      reasoningEffort: automation.reasoningEffort,
      autonomy: automation.autonomy,
    },
    scheduledAt: 1,
    requestedAt: 1,
    trigger: 'manual',
    status: 'completed',
    startedAt: 1,
    finishedAt: 2,
    clientRef: 'automation:run-1',
    appSessionId: 'session-1',
    resolvedCwd: '/repo/.worktrees/run-1',
    error: null,
    effectiveModelId: 'model-a',
    effectiveReasoningEffort: 'high',
    selectionVerified: true,
  };
  const proposal = {
    id: 'proposal-1',
    sourceAppSessionId: 'source-1',
    draft,
    status: 'confirmed',
    missingFields: [],
    automationId: automation.id,
    createdAt: 1,
    updatedAt: 2,
    confirmedAt: 2,
  };
  const snapshot = {
    automations: [automation],
    runs: [run],
    proposals: [proposal],
    sessionOrigins: {
      'session-1': {
        automationId: automation.id,
        automationTitle: automation.title,
        runId: run.id,
        trigger: 'manual',
      },
    },
    queuedRunCount: 0,
    activeRunCount: 0,
    scheduler: { ready: true, nextWakeAt: null, activeRunId: null },
  };
  assertAccepted({ type: 'automations.snapshot', snapshot });

  const malformed = [
    { ...snapshot, automations: [{ id: automation.id }] },
    { ...snapshot, runs: [{ id: run.id }] },
    { ...snapshot, proposals: [{ id: proposal.id }] },
    {
      ...snapshot,
      automations: [{ ...automation, schedule: { kind: 'hourly', minute: 60 } }],
    },
    {
      ...snapshot,
      runs: [{ ...run, automation: { ...run.automation, reasoningEffort: 'turbo' } }],
    },
    {
      ...snapshot,
      proposals: [{ ...proposal, draft: { ...draft, executionMode: 'remote' } }],
    },
    {
      ...snapshot,
      automations: [{ ...automation, timezone: 'Not/A_Timezone' }],
    },
    {
      ...snapshot,
      automations: [{ ...automation, schedule: { kind: 'daily', time: '9:00' } }],
    },
    {
      ...snapshot,
      automations: [{ ...automation, schedule: { kind: 'cron', expression: '61 * * * *' } }],
    },
    {
      ...snapshot,
      sessionOrigins: { 'session-1': { automationId: automation.id, runId: run.id } },
    },
    { ...snapshot, scheduler: { ...snapshot.scheduler, nextWakeAt: Number.NaN } },
  ];
  for (const candidate of malformed) {
    assertRejected({ type: 'automations.snapshot', snapshot: candidate });
  }
});

test('validates automation command results by outcome', () => {
  const result = { type: 'automations.result', requestId: 'request-1' };
  assertAccepted({ ...result, ok: true, runId: 'run-1' });
  assertAccepted({ ...result, ok: false, error: 'Automation not found.' });
  assertRejected({ ...result, ok: false });
  assertRejected({ ...result, ok: true, runId: 4 });
});

test('validates session.processes events and rejects malformed process entries', () => {
  const process = {
    pid: 123,
    name: 'ripgrep',
    command: 'rg foo',
    originCommand: 'rg foo &',
    startedAt: 1,
    ports: [],
  };
  const sessionProcesses = (entry: unknown) => ({
    type: 'session.processes',
    appSessionId: 'app-1',
    processes: [entry],
  });
  assertAccepted(sessionProcesses(process));
  assertAccepted({ type: 'sessions.processes', processes: { 'app-1': [process] } });
  const malformed = { ...process, originCommand: 123 };
  assertRejected(sessionProcesses(malformed));
  assertRejected({ type: 'sessions.processes', processes: { 'app-1': [malformed] } });
  assert.equal(
    serverWireMessage({
      type: 'bridge.snapshot',
      generation: 'generation-1',
      lastSeq: 1,
      reason: 'replay_unavailable',
      snapshot: {
        runtime: { mode: 'cli_auth', droidPath: '/bin/droid', apiKeyConfigured: false },
        sessions: [],
        children: [],
        processes: { 'app-1': [malformed] },
        persistence: { durable: true, hadUnflushedWork: false },
        interrupted: [],
      },
    }),
    null,
  );
  // pid feeds session.processes.stop, so a non-integer or out-of-range number
  // must not reach the reducer either.
  for (const pid of ['not-a-number', 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assertRejected(sessionProcesses({ ...process, pid }));
  }
  assertRejected(sessionProcesses({ ...process, ports: ['8080', null] }));
  assertRejected(sessionProcesses({ ...process, ports: [0] }));
  assertRejected(sessionProcesses({ ...process, startedAt: -1 }));
});

test('accepts the sidebar requests the sidecar sends and rejects unknown marks', () => {
  const request = (query: unknown) => ({
    type: 'sidebar.request',
    request: { requestId: 'r-1', expiresAt: 4_000, query },
  });
  assertAccepted(request({ kind: 'rows' }));
  assertAccepted(request({ kind: 'rows', appSessionIds: ['chat-a'] }));
  const targets = [{ appSessionId: 'chat-a', updatedAt: 100 }];
  assertAccepted(request({ kind: 'mark', mark: 'archived', targets }));
  assertRejected(request({ kind: 'mark', mark: 'deleted', targets }));
});

test('the chat preferences on a summary accept only their own values', () => {
  const summary = {
    appSessionId: 'app-fast',
    provider: 'codex',
    sessionPurpose: 'chat',
    interactionMode: 'auto',
    role: 'primary',
    title: 'Fast',
    goal: '',
    cwd: '',
    autonomy: 'low',
    phase: 'paused',
    features: [],
    tokensIn: 0,
    tokensOut: 0,
    contextTokens: 0,
    createdAt: 1,
    updatedAt: 1,
  };
  const updated = (session: Record<string, unknown>) => ({ type: 'session.updated', session });
  for (const fastMode of [true, false, undefined])
    assertAccepted(updated({ ...summary, fastMode }));
  for (const fastMode of ['true', 1, null]) assertRejected(updated({ ...summary, fastMode }));
  for (const contextWindowTokens of [200000, 1000000, undefined])
    assertAccepted(updated({ ...summary, contextWindowTokens }));
  for (const contextWindowTokens of [500000, '200000', null])
    assertRejected(updated({ ...summary, contextWindowTokens }));
});

test('transient transcript events accept only the literal true or an absent flag', () => {
  const event = {
    id: 'event-1',
    appSessionId: 'app-1',
    sourceSessionId: 'provider-1',
    role: 'primary',
    kind: 'status',
    ts: 1,
  };
  for (const transient of [undefined, true]) {
    assertAccepted({ type: 'event.appended', event: { ...event, transient } });
  }
  for (const transient of ['false', false, 1, null]) {
    assertRejected({ type: 'event.appended', event: { ...event, transient } });
  }
  // A prompt's pinned frames are names the bubble maps over, so nothing else gets in.
  assertAccepted({ type: 'event.appended', event: { ...event, canvasFrames: ['Pricing · Wide'] } });
  for (const canvasFrames of ['Pricing · Wide', [1], [null], {}]) {
    assertRejected({ type: 'event.appended', event: { ...event, canvasFrames } });
  }
});

test('droidproxy reports and outcomes accept known providers and phases only', () => {
  const account = {
    provider: 'codex',
    id: 'codex-dev.json',
    email: 'dev@example.com',
    disabled: false,
  };
  const provider = { provider: 'codex', enabled: true, canLoginHere: true, accounts: [account] };
  const status = {
    appInstalled: true,
    proxyRunning: true,
    backendRunning: true,
    loginBinaryAvailable: true,
    metaContributorMode: false,
    factoryModelCount: 12,
    factoryModelsInstalled: true,
    providers: [provider],
  };
  const report = (overrides: Record<string, unknown>) => ({
    type: 'droidproxy.report',
    status: { ...status, ...overrides },
  });
  for (const overrides of [
    {},
    { loginInProgress: 'codex' },
    { installInProgress: 'downloading' },
    { installUnavailable: 'unsupported-arch' },
  ]) {
    assertAccepted(report(overrides));
  }
  for (const overrides of [
    { providers: [{ ...provider, provider: 'cursor' }] },
    { providers: [{ ...provider, accounts: [{ ...account, disabled: 'no' }] }] },
    { factoryModelCount: undefined },
    { loginInProgress: 'cursor' },
    { installInProgress: 'seeding' },
    { installUnavailable: 'windows-rt' },
  ]) {
    assertRejected(report(overrides));
  }

  const accountUpdate = {
    type: 'droidproxy.account.updated',
    provider: 'codex',
    id: 'codex-dev.json',
  };
  for (const event of [
    { ...accountUpdate, enabled: false, ok: true },
    { type: 'droidproxy.login.started', provider: 'kimi' },
    { type: 'droidproxy.login.done', provider: 'kimi', ok: true },
    { type: 'droidproxy.login.done', provider: 'kimi', ok: false, cancelled: true },
    { type: 'droidproxy.factoryModels.applied', ok: true, applied: 12, removed: 12 },
    {
      type: 'droidproxy.install.progress',
      phase: 'downloading',
      receivedBytes: 1024,
      totalBytes: 2048,
    },
    { type: 'droidproxy.install.progress', phase: 'launching' },
    { type: 'droidproxy.install.done', ok: true },
    { type: 'droidproxy.install.done', ok: false, cancelled: true, message: 'Install cancelled.' },
  ]) {
    assertAccepted(event);
  }
  for (const event of [
    { ...accountUpdate, enabled: 'no', ok: true },
    { type: 'droidproxy.login.started', provider: 'cursor' },
    { type: 'droidproxy.login.done', provider: 'kimi', ok: false, cancelled: 'yes' },
    { type: 'droidproxy.factoryModels.applied', ok: true, applied: '12', removed: 0 },
    { type: 'droidproxy.install.progress', phase: 'seeding' },
    { type: 'droidproxy.install.progress', phase: 'downloading', receivedBytes: 'lots' },
    { type: 'droidproxy.install.done', ok: 'yes' },
  ]) {
    assertRejected(event);
  }
});
