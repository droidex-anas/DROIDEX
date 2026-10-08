import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  AutonomyLevel,
  DecompSessionType,
  InitializeSessionResultSchema,
  McpServerStatus,
  McpServerType,
  SettingsLevel,
} from '@factory/droid-sdk';

import type * as Protocol from './protocol.js';
import { ProviderTranscriptFile } from './providers/ProviderTranscriptFile.js';
import { startupFactoryDefaults, validateFactoryDefaults } from './SessionManager.js';
import { assistantTextDelta, FakeFactorySession } from './testing/fakeFactoryRuntime.js';
import { writeProviderConversation } from './testing/historyCharacterizationSupport.js';
import {
  chatCommand,
  createSessionManagerTestContext,
  errorEvents,
  historicalSummary,
  providerCloses,
  sessionUpdates,
  type ErrorEvent,
  type SessionCreateInput,
  type SessionManagerTestContext,
} from './testing/sessionManagerTestContext.js';

// The facade suite covers only what the module suites cannot reach: command
// validation and routing, how a create or resume is composed from the modules,
// settings that cross modules, and autonomy, which the manager owns.

test('bridge commands are validated before any provider session starts', async () => {
  const h = createSessionManagerTestContext();
  try {
    // A client that predates the required autonomy snapshot.
    await h.handle({
      type: 'session.create',
      clientRef: 'missing-autonomy',
      title: 'Missing autonomy',
      goal: 'go',
      sessionPurpose: 'chat',
      interactionMode: 'auto',
    } as unknown as Protocol.ClientCommand);
    // Version skew: a renderer newer than this sidecar sends a command it does
    // not know. Requesters correlate on the echoed requestId.
    await h.handle({
      type: 'session.someFutureCommand',
      requestId: 'req-7',
    } as unknown as Protocol.ClientCommand);

    const [missingAutonomy, unsupported] = errorEvents(h.events);
    assert.equal(errorEvents(h.events).length, 2);
    assert.match(missingAutonomy?.message ?? '', /requires an explicit autonomy/);
    assert.equal(unsupported?.code, 'bridge.unsupported_command');
    assert.equal(unsupported.requestId, 'req-7');
    assert.match(unsupported.message, /someFutureCommand/);
    assert.match(unsupported.message, /Restart the app/);
    assert.equal(
      h.events.some((event) => event.type === 'session.created'),
      false,
    );
    assert.equal(h.runtime.createCalls.length, 0);

    await h.handle({ type: 'runtime.status' });
    await h.handle({ type: 'history.indexingIdle', isIdle: true });
    await h.handle({ type: 'history.indexingIdle', isIdle: false });
    assert.ok(h.events.some((event) => event.type === 'runtime.updated'));
    assert.deepEqual(h.history.indexingIdleStates, [true, false]);
    assert.equal(errorEvents(h.events).length, 2);
  } finally {
    await h.dispose();
  }
});

test('Factory defaults keep model ids only once a catalog validates them', () => {
  const models: Protocol.ModelInfo[] = [
    {
      id: 'model-a',
      displayName: 'Model A',
      isDefault: true,
      isCustom: false,
      supportedReasoningEfforts: ['low', 'medium'],
      defaultReasoningEffort: 'medium',
    },
    {
      id: 'model-b',
      displayName: 'Model B',
      isCustom: false,
      supportedReasoningEfforts: ['high'],
      defaultReasoningEffort: 'high',
    },
  ];
  assert.deepEqual(
    startupFactoryDefaults(
      {
        modelId: 'missing-model',
        reasoningEffort: 'high',
        compactionModel: 'missing-model',
        compactionTokenLimit: 200_000,
        compactionTokenLimitPerModel: { 'missing-model': 150_000 },
        autonomy: 'high',
        interactionMode: 'auto',
        workerModelId: 'missing-worker',
      },
      [],
    ),
    {
      autonomy: 'high',
      interactionMode: 'auto',
      compactionTokenLimit: 200_000,
      compactionTokenLimitPerModel: { 'missing-model': 150_000 },
    },
  );
  assert.deepEqual(
    validateFactoryDefaults(
      {
        modelId: 'missing-model',
        reasoningEffort: 'high',
        compactionModel: 'missing-model',
        compactionTokenLimit: 200_000,
        compactionTokenLimitPerModel: { 'model-b': 150_000, missing: 90_000 },
        specModelId: 'model-b',
        specReasoningEffort: 'low',
        workerModelId: 'model-b',
        workerReasoningEffort: 'medium',
        validatorModelId: 'missing-validator',
      },
      models,
    ),
    {
      modelId: 'model-a',
      reasoningEffort: 'medium',
      compactionModel: 'current-model',
      compactionTokenLimit: 200_000,
      compactionTokenLimitPerModel: { 'model-b': 150_000 },
      specModelId: 'model-b',
      specReasoningEffort: 'high',
      workerModelId: 'model-b',
      workerReasoningEffort: 'high',
      validatorModelId: 'model-a',
      validatorReasoningEffort: undefined,
    },
  );
  // Saved defaults remain intact while the catalog is unavailable.
  const saved = {
    modelId: 'saved-model',
    reasoningEffort: 'high',
    specModelId: 'saved-spec-model',
    workerModelId: 'saved-worker',
    validatorModelId: 'saved-validator',
    compactionModel: 'saved-compaction-model',
  } as const;
  assert.deepEqual(
    validateFactoryDefaults(
      {
        ...saved,
        compactionTokenLimit: 200_000.9,
        compactionTokenLimitPerModel: { 'saved-model': 150_000.5 },
      },
      [],
    ),
    {
      ...saved,
      compactionTokenLimit: 200_000,
      compactionTokenLimitPerModel: { 'saved-model': 150_000 },
    },
  );
});

test('ordinary create initializes CLI and DROIDEX MCP servers without persisting them', async () => {
  const h = createSessionManagerTestContext();
  try {
    await h.create(chatCommand('ordinary'));

    const options = h.runtime.createCalls[0];
    assert.ok(options);
    assert.equal(options.interactionMode, 'auto');
    assert.equal(options.autonomyLevel, 'low');
    assert.deepEqual(
      options.mcpServers?.map((server) => server.name),
      ['test-cli', 'test-browser', 'droidex-automations', 'droidex-sessions'],
      'the effective CLI MCP config and DROIDEX’s own tool servers must initialize together',
    );
    assert.equal(
      h.calls.some((call) => call.target === 'provider' && call.method === 'addMcpServer'),
      false,
      'DROIDEX-owned runtime servers must never be persisted into Droid user config',
    );
    assert.deepEqual(h.provider.session('provider-1').prompts, ['hello']);
  } finally {
    await h.dispose();
  }
});

test('create maps purpose and interaction mode independently onto provider options', async () => {
  const cases: {
    command: Partial<SessionCreateInput>;
    options: Record<string, unknown>;
    created: Partial<Protocol.SessionSummary>;
  }[] = [
    {
      command: { interactionMode: 'spec', modelId: 'spec-model', reasoningEffort: 'high' },
      options: { interactionMode: 'spec', specModeModelId: 'spec-model', workerModelId: undefined },
      created: { sessionPurpose: 'chat', interactionMode: 'spec' },
    },
    {
      command: { sessionPurpose: 'design' },
      options: { decompSessionType: undefined },
      created: { sessionPurpose: 'design', interactionMode: 'auto', missionId: undefined },
    },
    {
      command: { interactionMode: 'agi' },
      options: { decompSessionType: undefined },
      created: { sessionPurpose: 'chat', interactionMode: 'agi', missionId: undefined },
    },
    {
      command: {
        sessionPurpose: 'mission-control',
        interactionMode: 'agi',
        workerModel: 'worker',
        validatorModel: 'validator',
      },
      options: {
        decompSessionType: DecompSessionType.Orchestrator,
        workerModelId: 'worker',
        validatorModelId: 'validator',
      },
      created: { sessionPurpose: 'mission-control' },
    },
  ];

  for (const { command, options, created } of cases) {
    const h = createSessionManagerTestContext();
    try {
      await h.create(chatCommand('mapped', command));
      const createOptions = h.runtime.createCalls[0] as unknown as Record<string, unknown>;
      for (const [key, value] of Object.entries(options)) {
        assert.deepEqual(createOptions[key], value, `${JSON.stringify(command)}: ${key}`);
      }
      const session = h.events.find((event) => event.type === 'session.created')?.session;
      for (const [key, value] of Object.entries(created)) {
        assert.deepEqual(
          session?.[key as keyof Protocol.SessionSummary],
          value,
          `${JSON.stringify(command)}: ${key}`,
        );
      }
    } finally {
      await h.dispose();
    }
  }
});

test("a session's live model catalog replaces the help-text catalog and is cached", async () => {
  const h = createSessionManagerTestContext();
  const session = new FakeFactorySession('live-catalog', {}, h.calls);
  session.initResult = InitializeSessionResultSchema.parse({
    ...session.initResult,
    availableModels: [
      {
        id: 'auto',
        displayName: 'Auto',
        shortDisplayName: 'Auto',
        modelProvider: 'factory',
        supportedReasoningEfforts: [],
        defaultReasoningEffort: 'medium',
      },
    ],
  });
  h.runtime.createQueue.push(session);

  try {
    await h.create(chatCommand('live-catalog'));

    const catalog = h.events.findLast(
      (event) => event.type === 'catalog.updated' && event.catalog === 'models',
    );
    assert.ok(catalog?.type === 'catalog.updated');
    assert.deepEqual(
      (catalog.items as Protocol.ModelInfo[]).map((model) => model.id),
      ['auto'],
    );
    const cached = JSON.parse(
      readFileSync(path.join(h.home, '.factory', 'droidex', 'model-catalog.json'), 'utf8'),
    ) as { source: string; models: { id: string }[] };
    assert.equal(cached.source, 'session');
    assert.deepEqual(
      cached.models.map((model) => model.id),
      ['auto'],
    );
  } finally {
    await h.dispose();
  }
});

test('App response formats enrich the provider prompt and unsupported ones never reach it', async () => {
  const h = createSessionManagerTestContext();

  try {
    await h.create(
      chatCommand('app-format-create', {
        goal: '/visualize compare renderer timings',
        responseFormat: 'app-create',
      }),
    );

    const createPrompt = h.provider.session('provider-1').prompts[0];
    assert.match(createPrompt, /^DROIDEX App request:/);
    assert.match(createPrompt, /\/visualize compare renderer timings/);
    assert.match(createPrompt, /fenced `app` block/);

    await h.handle({
      type: 'session.send',
      appSessionId: 'provider-1',
      text: '/visualize turn this into a timeline',
      responseFormat: 'app-create',
    });
    await h.provider.waitForPrompts('provider-1', 2);
    const sendPrompt = h.provider.session('provider-1').prompts[1];
    assert.match(sendPrompt, /^DROIDEX App request:/);
    assert.match(sendPrompt, /\/visualize turn this into a timeline/);

    await assert.rejects(
      h.handle({
        type: 'session.send',
        appSessionId: 'provider-1',
        text: 'keep going',
        responseFormat: 'future-app-format',
      } as never),
      /Unsupported response format: future-app-format/,
    );
    assert.equal(h.provider.session('provider-1').prompts.length, 2);
  } finally {
    await h.dispose();
  }
});

test('resuming an AGI chat preserves its explicit non-Mission-Control purpose', async () => {
  const h = createSessionManagerTestContext();

  try {
    h.fixture.seedHistorySummaries([
      { ...historicalSummary('app-agi-chat', 'provider-agi-chat'), interactionMode: 'agi' },
    ]);
    writeProviderConversation(h.home, 'provider-agi-chat', 'AGI chat');
    h.runtime.loadQueue.set('provider-agi-chat', [
      new FakeFactorySession('provider-agi-chat', {}, h.calls, {
        settings: { interactionMode: 'agi' },
        mission: { state: 'running', features: [] },
      }),
    ]);

    await h.handle({ type: 'session.resume', appSessionId: 'app-agi-chat' });

    const resumed = h.events.find((event) => event.type === 'session.created')?.session;
    assert.equal(resumed?.sessionPurpose, 'chat');
    assert.equal(resumed?.interactionMode, 'agi');
    assert.equal(resumed?.missionId, undefined);
    assert.deepEqual(resumed?.features, []);
    assert.equal(resumed?.phase, 'paused');
    assert.equal(
      h.events.some((event) => event.type === 'mission.features'),
      false,
    );
  } finally {
    await h.dispose();
  }
});

test('mixed stable and provider identities preserve output across turns', async () => {
  const h = createSessionManagerTestContext();

  try {
    h.fixture.seedHistorySummaries([historicalSummary('app-alias', 'provider-alias')]);
    writeProviderConversation(h.home, 'provider-alias', 'Alias');
    const provider = new FakeFactorySession('provider-alias', {}, h.calls);
    provider.queueStreamEvents([assistantTextDelta('first answer', 'first-message')]);
    provider.queueStreamEvents([assistantTextDelta('second answer', 'second-message')]);
    h.runtime.loadQueue.set('provider-alias', [provider]);

    await h.handle({ type: 'session.send', appSessionId: 'app-alias', text: 'first' });
    await h.handle({ type: 'session.send', appSessionId: 'provider-alias', text: 'second' });

    const textEvents = h.events.flatMap((event) =>
      event.type === 'event.appended' && event.event.kind === 'text' ? [event.event] : [],
    );
    assert.deepEqual(provider.prompts, ['first', 'second']);
    assert.ok(h.runtime.loadCalls[0]?.handlers.permissionHandler);
    assert.ok(h.runtime.loadCalls[0]?.handlers.askUserHandler);
    assert.deepEqual(
      textEvents.map((event) => [event.text, event.appSessionId]),
      [
        ['first answer', 'app-alias'],
        ['second answer', 'app-alias'],
      ],
    );
  } finally {
    await h.dispose();
  }
});

test('closed provider sessions preserve fast-only, explicit off and omitted settings updates', async () => {
  const h = createSessionManagerTestContext();
  const stored: Protocol.SessionSummary = {
    ...historicalSummary('stored-fast', 'stored-fast'),
    provider: 'codex',
    resumeId: 'thread-fast',
    modelId: 'model-default',
    reasoningEffort: 'high',
    fastMode: false,
  };
  const patch = () => h.history.summaryPatchesAndHidden().patches.get(stored.appSessionId);
  const update = (settings: { fastMode?: boolean; reasoningEffort?: 'low' }) =>
    h.handle({ type: 'session.updateSettings', appSessionId: stored.appSessionId, ...settings });
  try {
    const transcript = new ProviderTranscriptFile(stored.appSessionId, () => stored);
    await transcript.appendPrompt('hello');
    await transcript.append({
      id: 'reply',
      appSessionId: stored.appSessionId,
      sourceSessionId: stored.appSessionId,
      role: 'primary',
      kind: 'text',
      text: 'hello',
      ts: 1,
    });
    await transcript.flush();
    h.fixture.seedHistorySummaries([stored]);
    await update({ fastMode: true });
    assert.equal(patch()?.fastMode, true);
    await update({ fastMode: false });
    await update({ reasoningEffort: 'low' });
    assert.equal(patch()?.fastMode, false);
    assert.equal(patch()?.reasoningEffort, 'low');

    await h.create({ ...chatCommand('unsupported-fast', { goal: '' }), fastMode: true });
    assert.equal(h.runtime.createCalls.length, 0);
    assert.ok(
      errorEvents(h.events).some((event) => /does not support fast mode/.test(event.message)),
    );
  } finally {
    await h.dispose();
  }
});

test('MCP commands run on a temporary Droid session in the requested workspace', async () => {
  const h = createSessionManagerTestContext();
  const catalog = new FakeFactorySession('mcp-catalog', {}, h.calls);
  catalog.nextMcpServers = {
    servers: [
      {
        name: 'sentry',
        status: McpServerStatus.Connected,
        source: SettingsLevel.User,
        isManaged: false,
        serverType: McpServerType.Http,
      },
    ],
    summary: { total: 1, connected: 1, connecting: 0, failed: 0, disabled: 0 },
  };
  catalog.nextMcpTools = { tools: [{ serverName: 'sentry', name: 'search', isEnabled: true }] };
  h.runtime.createQueue.push(catalog);
  const catalogs = () =>
    h.events.filter((event) => (event as { type: string }).type === 'mcp.catalog') as unknown as {
      requestId: string;
    }[];
  const server = {
    name: 'linear',
    serverType: 'http',
    url: 'https://mcp.linear.app/mcp',
    headers: { Authorization: 'Bearer secret' },
  };

  try {
    await h.handle({
      type: 'mcp.list',
      requestId: 'list-1',
      cwd: '/workspace/project',
    } as unknown as Protocol.ClientCommand);

    assert.equal(h.runtime.createCalls[0]?.cwd, '/workspace/project');
    assert.deepEqual(catalogs()[0], {
      type: 'mcp.catalog',
      requestId: 'list-1',
      cwd: '/workspace/project',
      servers: catalog.nextMcpServers.servers,
      tools: catalog.nextMcpTools.tools,
      summary: catalog.nextMcpServers.summary,
    });
    assert.deepEqual(providerCloses(h, 'mcp-catalog'), ['mcp-catalog']);

    await h.handle({
      type: 'mcp.add',
      requestId: 'add-1',
      cwd: '/workspace/project',
      server,
    } as unknown as Protocol.ClientCommand);
    assert.deepEqual(
      h.calls.find((call) => call.target === 'runtime' && call.method === 'mcp.addConfigured')
        ?.args,
      [server, '/workspace/project'],
    );
    assert.equal(catalogs().at(-1)?.requestId, 'add-1');
  } finally {
    await h.dispose();
  }
});

test('an interaction-mode change re-arms compaction on the provider and reports a rejection', async () => {
  const h = createSessionManagerTestContext();
  const arms = () =>
    h.provider
      .session('provider-1')
      .settings.filter((settings) => settings['compactionThresholdCheckEnabled'] === true);

  try {
    await h.create(chatCommand('mode', { goal: 'go' }));
    await h.waitForIdle();
    const armsBefore = arms().length;
    await h.handle({
      type: 'session.updateSettings',
      appSessionId: 'provider-1',
      interactionMode: 'spec',
    });
    await h.waitForIdle();
    assert.equal(
      h.calls.some((call) => call.method === 'enterSpecMode'),
      true,
    );
    const updated = sessionUpdates(h.events, 'provider-1').at(-1);
    assert.equal(updated?.interactionMode, 'spec');
    assert.equal(updated?.autonomy, 'low');
    // Spec mode re-arms with its default model: the daemon default (250k)
    // clamped to 80% of the 1k model window.
    assert.equal(arms().length > armsBefore, true);
    assert.equal(arms().at(-1)?.['compactionTokenLimit'], 800);

    const updatesBeforeFailure = sessionUpdates(h.events, 'provider-1').length;
    h.provider.session('provider-1').nextEnterSpecModeError = new Error('mode rejected');
    await h.handle({
      type: 'session.updateSettings',
      appSessionId: 'provider-1',
      interactionMode: 'spec',
    });

    assert.equal(
      errorEvents(h.events).some(
        (event) => event.message === 'Could not switch interaction mode: mode rejected',
      ),
      true,
    );
    assert.equal(sessionUpdates(h.events, 'provider-1').length, updatesBeforeFailure);
  } finally {
    await h.dispose();
  }
});

test('summary patches preserve existing provider transcripts', async () => {
  const h = createSessionManagerTestContext();

  try {
    await h.create(chatCommand('patch', { goal: 'go' }));
    const file = path.join(h.home, '.factory', 'sessions', 'provider-1.jsonl');
    const transcript =
      `${JSON.stringify({ type: 'session_start', sessionId: 'provider-1', sessionTitle: 'L11', cwd: '' })}\n` +
      `${JSON.stringify({
        type: 'message',
        message: { role: 'assistant', content: [{ type: 'text', text: 'preserve me' }] },
      })}\n`;
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, transcript);
    await h.waitForIdle();

    await h.handle({
      type: 'session.updateSettings',
      appSessionId: 'provider-1',
      autonomy: 'high',
    });

    assert.equal(sessionUpdates(h.events, 'provider-1').at(-1)?.autonomy, 'high');
    assert.equal(h.history.summaryPatchesAndHidden().patches.get('provider-1')?.autonomy, 'high');
    assert.equal(readFileSync(file, 'utf8'), transcript);
  } finally {
    await h.dispose();
  }
});

// Autonomy is written to the provider first and only the confirmed level is published.

function createAutonomyChat(h: SessionManagerTestContext): Promise<void> {
  return h.create(chatCommand('autonomy-chat', { goal: 'go' }));
}

function updateAutonomy(
  h: SessionManagerTestContext,
  appSessionId: string,
  autonomy: Protocol.Autonomy,
): Promise<void> {
  return h.handle({
    type: 'session.updateSettings',
    appSessionId,
    autonomy,
    requestId: `autonomy-${autonomy}`,
  });
}

function assertAutonomyError(error: ErrorEvent | undefined, message: RegExp): void {
  assert.equal(error?.code, 'session.autonomy_update_failed');
  assert.equal(error.recoverable, true);
  assert.match(error.message, message);
}

test('live autonomy update writes the provider first and publishes the confirmed level', async () => {
  const h = createSessionManagerTestContext();
  try {
    await updateAutonomy(h, 'missing-session', 'high');
    await h.waitForIdle();
    assertAutonomyError(errorEvents(h.events)[0], /live session/);

    await createAutonomyChat(h);
    await h.waitForIdle();
    await updateAutonomy(h, 'provider-1', 'high');
    await h.waitForIdle();

    const settings = h.provider.session('provider-1').settings;
    assert.deepEqual(settings.at(-1), { autonomyLevel: AutonomyLevel.High });
    assert.equal(sessionUpdates(h.events, 'provider-1').at(-1)?.autonomy, 'high');

    // Asking for the level already confirmed writes nothing.
    const writesBefore = settings.length;
    await updateAutonomy(h, 'provider-1', 'high');
    await h.waitForIdle();
    assert.equal(settings.length, writesBefore);
    assert.equal(errorEvents(h.events).length, 1);
    assert.deepEqual(
      h.events.filter((event) => event.type === 'session.autonomy_update_applied'),
      Array.from({ length: 2 }, () => ({
        type: 'session.autonomy_update_applied',
        appSessionId: 'provider-1',
        requestId: 'autonomy-high',
      })),
    );
    assert.equal(errorEvents(h.events)[0]?.requestId, 'autonomy-high');
  } finally {
    await h.dispose();
  }
});

test('queued autonomy updates serialize and apply in request order', async () => {
  const h = createSessionManagerTestContext();
  try {
    await createAutonomyChat(h);
    await h.waitForIdle();
    const writes = h.provider.session('provider-1').settings;
    const writesBefore = writes.length;

    const gate = h.provider.deferNextUpdateSettings('provider-1');
    const first = updateAutonomy(h, 'provider-1', 'medium');
    await h.waitForIdle();
    const second = updateAutonomy(h, 'provider-1', 'high');
    await h.waitForIdle();

    // The second update must not reach the provider while the first is gated.
    assert.equal(writes.length, writesBefore + 1);

    gate.resolve();
    await Promise.all([first, second]);
    await h.waitForIdle();

    assert.deepEqual(writes.slice(writesBefore), [
      { autonomyLevel: AutonomyLevel.Medium },
      { autonomyLevel: AutonomyLevel.High },
    ]);
    assert.equal(sessionUpdates(h.events, 'provider-1').at(-1)?.autonomy, 'high');
  } finally {
    await h.dispose();
  }
});

test('a superseded native rejection applies the latest autonomy and settles each request once', async () => {
  const h = createSessionManagerTestContext();
  try {
    await createAutonomyChat(h);
    await h.waitForIdle();
    const session = h.provider.session('provider-1');
    session.nextUpdateSettingsError = new Error('provider rejected');
    const writesBefore = session.settings.length;

    await Promise.all([
      updateAutonomy(h, 'provider-1', 'medium'),
      updateAutonomy(h, 'provider-1', 'high'),
    ]);
    await h.waitForIdle();

    assert.deepEqual(errorEvents(h.events), []);
    assert.deepEqual(
      h.events
        .filter((event) => event.type === 'session.autonomy_update_applied')
        .map((event) => event.requestId),
      ['autonomy-medium', 'autonomy-high'],
    );
    assert.equal(
      sessionUpdates(h.events, 'provider-1').some((summary) => summary.autonomy === 'medium'),
      false,
    );
    // The failed write settles before the loop dispatches the newest choice.
    assert.deepEqual(session.settings.slice(writesBefore), [
      { autonomyLevel: AutonomyLevel.Medium },
      { autonomyLevel: AutonomyLevel.High },
    ]);
    assert.equal(sessionUpdates(h.events, 'provider-1').at(-1)?.autonomy, 'high');
  } finally {
    await h.dispose();
  }
});

test('a later failed escalation still publishes the level native already accepted', async () => {
  const h = createSessionManagerTestContext();
  try {
    await createAutonomyChat(h);
    await h.waitForIdle();
    const session = h.provider.session('provider-1');
    const write = session.updateSettings.bind(session);
    session.updateSettings = async (settings) => {
      if (settings.autonomyLevel === AutonomyLevel.High) throw new Error('grant refused');
      return write(settings);
    };
    const gate = h.provider.deferNextUpdateSettings('provider-1');
    const medium = updateAutonomy(h, 'provider-1', 'medium');
    await h.waitForIdle();
    const high = updateAutonomy(h, 'provider-1', 'high');
    gate.resolve();
    await Promise.all([medium, high]);
    await h.waitForIdle();
    assert.equal(sessionUpdates(h.events, 'provider-1').at(-1)?.autonomy, 'medium');
    assert.equal(h.history.summaryPatchesAndHidden().patches.get('provider-1')?.autonomy, 'medium');
    assertAutonomyError(errorEvents(h.events).at(-1), /grant refused/);
    assert.equal(errorEvents(h.events).at(-1)?.requestId, 'autonomy-high');
  } finally {
    await h.dispose();
  }
});

test('choosing confirmed Off after a failed grant replaces the pending native choice', async () => {
  const h = createSessionManagerTestContext();
  try {
    await createAutonomyChat(h);
    await h.waitForIdle();
    await updateAutonomy(h, 'provider-1', 'off');
    const session = h.provider.session('provider-1');
    const write = session.updateSettings.bind(session);
    let highAttempts = 0;
    session.updateSettings = async (settings) => {
      if (settings.autonomyLevel === AutonomyLevel.High) {
        highAttempts += 1;
        throw new Error('grant refused');
      }
      return write(settings);
    };
    await updateAutonomy(h, 'provider-1', 'high');
    assertAutonomyError(errorEvents(h.events).at(-1), /grant refused/);
    const attemptsBeforeOff = highAttempts;
    await updateAutonomy(h, 'provider-1', 'off');
    await h.handle({ type: 'session.send', appSessionId: 'provider-1', text: 'continue' });
    await h.waitForIdle();
    assert.equal(highAttempts, attemptsBeforeOff);
    assert.deepEqual(session.prompts, ['go', 'continue']);
    assert.equal(sessionUpdates(h.events, 'provider-1').at(-1)?.autonomy, 'off');
  } finally {
    await h.dispose();
  }
});

test('an autonomy update dropped by a close settles the caller and publishes nothing', async () => {
  const h = createSessionManagerTestContext();
  try {
    await createAutonomyChat(h);
    await h.waitForIdle();

    const gate = h.provider.deferNextUpdateSettings('provider-1');
    const update = updateAutonomy(h, 'provider-1', 'high');
    await h.waitForIdle();
    await h.handle({ type: 'session.close', appSessionId: 'provider-1' });
    gate.resolve();
    await update;
    await h.waitForIdle();

    assert.equal(
      sessionUpdates(h.events, 'provider-1').some((session) => session.autonomy === 'high'),
      false,
    );
    // The dropped confirmation settles the caller with a recoverable error
    // instead of leaving its pending state spinning forever.
    const errors = errorEvents(h.events);
    assert.equal(errors.length, 1);
    assertAutonomyError(errors[0], /interrupted/);
    assert.equal(errors[0]?.requestId, 'autonomy-high');
  } finally {
    await h.dispose();
  }
});
