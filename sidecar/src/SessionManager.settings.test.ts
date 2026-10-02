import assert from 'node:assert/strict';
import test from 'node:test';

import { McpServerStatus, McpServerType, SettingsLevel } from '@factory/droid-sdk';

import { McpSettings } from './McpSettings.js';
import { startupFactoryDefaults, validateFactoryDefaults } from './SessionManager.js';
import { claudeContextEnv, claudeContextModel } from './providers/claude/claudeContextWindow.js';
import { createSessionSettingsForAgent } from './SessionModelSettings.js';
import { createSessionManagerTestContext } from './testing/sessionManagerTestContext.js';
import { ProviderTranscriptFile } from './providers/ProviderTranscriptFile.js';
import type { ClientCommand, ModelInfo, ServerEvent, SessionSummary } from './protocol.js';
import { FakeFactorySession } from './testing/fakeFactoryRuntime.js';

const models: ModelInfo[] = [
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

test('agent settings map to the provider fields used by each role', () => {
  assert.deepEqual(
    createSessionSettingsForAgent('worker', {
      modelId: 'worker-model',
      reasoningEffort: 'high',
    }),
    {
      missionSettings: {
        workerModel: 'worker-model',
        workerReasoningEffort: 'high',
      },
    },
  );
  assert.deepEqual(createSessionSettingsForAgent('primary', { modelId: 'model-b' }), {
    modelId: 'model-b',
    specModeModelId: 'model-b',
  });
  assert.deepEqual(
    createSessionSettingsForAgent('primary', {
      modelId: 'model-b',
      reasoningEffort: 'high',
    }),
    {
      modelId: 'model-b',
      specModeModelId: 'model-b',
      reasoningEffort: 'high',
      specModeReasoningEffort: 'high',
    },
  );
});

test('Factory defaults keep model ids only once a catalog validates them', () => {
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
  assert.deepEqual(
    validateFactoryDefaults(
      {
        modelId: 'saved-model',
        reasoningEffort: 'high',
        specModelId: 'saved-spec-model',
        workerModelId: 'saved-worker',
        validatorModelId: 'saved-validator',
        compactionModel: 'saved-compaction-model',
        compactionTokenLimit: 200_000.9,
        compactionTokenLimitPerModel: { 'saved-model': 150_000.5 },
      },
      [],
    ),
    {
      modelId: 'saved-model',
      reasoningEffort: 'high',
      specModelId: 'saved-spec-model',
      workerModelId: 'saved-worker',
      validatorModelId: 'saved-validator',
      compactionModel: 'saved-compaction-model',
      compactionTokenLimit: 200_000,
      compactionTokenLimitPerModel: { 'saved-model': 150_000 },
    },
  );
});

test('closed provider sessions preserve fast-only, explicit off and omitted settings updates', async () => {
  const h = createSessionManagerTestContext();
  const stored: SessionSummary = {
    appSessionId: 'stored-fast',
    providerSessionId: 'stored-fast',
    provider: 'codex',
    resumeId: 'thread-fast',
    sessionPurpose: 'chat',
    interactionMode: 'auto',
    role: 'primary',
    title: 'Fast settings',
    goal: '',
    cwd: '',
    autonomy: 'low',
    phase: 'paused',
    modelId: 'model-default',
    reasoningEffort: 'high',
    fastMode: false,
    features: [],
    tokensIn: 0,
    tokensOut: 0,
    contextTokens: 0,
    createdAt: 1,
    updatedAt: 1,
  };
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
    await h.handle({
      type: 'session.updateSettings',
      appSessionId: stored.appSessionId,
      fastMode: true,
    });
    assert.equal(
      h.history.summaryPatchesAndHidden().patches.get(stored.appSessionId)?.fastMode,
      true,
    );
    await h.handle({
      type: 'session.updateSettings',
      appSessionId: stored.appSessionId,
      fastMode: false,
    });
    await h.handle({
      type: 'session.updateSettings',
      appSessionId: stored.appSessionId,
      reasoningEffort: 'low',
    });
    const patch = h.history.summaryPatchesAndHidden().patches.get(stored.appSessionId);
    assert.equal(patch?.fastMode, false);
    assert.equal(patch?.reasoningEffort, 'low');
    await h.create({
      clientRef: 'unsupported-fast',
      sessionPurpose: 'chat',
      title: 'Droid',
      goal: '',
      autonomy: 'low',
      fastMode: true,
    });
    assert.equal(h.runtime.createCalls.length, 0);
    assert.ok(
      h.events.some(
        (event) => event.type === 'error' && /does not support fast mode/.test(event.message),
      ),
    );
  } finally {
    await h.dispose();
  }
});

test('Claude context choices round-trip suffixes and isolate the 200k launch environment', () => {
  const catalog = [
    { value: 'sonnet', resolvedModel: 'claude-sonnet-4-6', displayName: 'Sonnet', description: '' },
    { value: 'sonnet[1m]', displayName: 'Sonnet (1M context)', description: 'Extended context' },
    { value: 'native', displayName: 'Native (1M context)', description: '1M context window' },
  ];
  assert.equal(claudeContextModel('claude-sonnet-4-6', 1000000, catalog), 'sonnet[1m]');
  assert.equal(claudeContextModel('sonnet[1M]', 200000, catalog), 'sonnet');
  assert.equal(claudeContextModel('sonnet[1m]', undefined, catalog), 'sonnet[1m]');
  assert.equal(claudeContextModel('native', 1000000, catalog), 'native');
  const env = { CLAUDE_CODE_DISABLE_1M_CONTEXT: 'global', PATH: '/bin' };
  assert.deepEqual(claudeContextEnv(env, 200000), { ...env, CLAUDE_CODE_DISABLE_1M_CONTEXT: '1' });
  assert.deepEqual(claudeContextEnv(env, 1000000), { PATH: '/bin' });
  assert.deepEqual(claudeContextEnv(env, undefined), env);
  assert.equal(env.CLAUDE_CODE_DISABLE_1M_CONTEXT, 'global');
});

function command(value: unknown): ClientCommand {
  return value as ClientCommand;
}

function mcpCatalog(events: ServerEvent[]): Record<string, unknown> | undefined {
  return events.find((event) => (event as { type: string }).type === 'mcp.catalog') as
    | Record<string, unknown>
    | undefined;
}

test('MCP catalog comes from Droid with effective scope, status, and tools', async () => {
  const h = createSessionManagerTestContext();
  const session = new FakeFactorySession('mcp-catalog', {}, h.calls);
  session.nextMcpServers = {
    servers: [
      {
        name: 'sentry',
        status: McpServerStatus.Connected,
        source: SettingsLevel.User,
        isManaged: false,
        serverType: McpServerType.Http,
        hasAuthTokens: true,
        toolCount: 2,
      },
    ],
    summary: { total: 1, connected: 1, connecting: 0, failed: 0, disabled: 0 },
  };
  session.nextMcpTools = {
    tools: [
      {
        serverName: 'sentry',
        name: 'search_issues',
        description: 'Search Sentry issues',
        isEnabled: true,
        isReadOnly: true,
      },
    ],
  };
  h.runtime.createQueue.push(session);

  try {
    await h.handle(command({ type: 'mcp.list', requestId: 'list-1', cwd: '/workspace/project' }));

    assert.equal(h.runtime.createCalls[0]?.cwd, '/workspace/project');
    assert.deepEqual(mcpCatalog(h.events), {
      type: 'mcp.catalog',
      requestId: 'list-1',
      cwd: '/workspace/project',
      servers: session.nextMcpServers.servers,
      tools: session.nextMcpTools.tools,
      summary: session.nextMcpServers.summary,
    });
    assert.equal(
      h.calls.some(
        (call) =>
          call.target === 'cleanup' &&
          call.method === 'session.close' &&
          call.args[0] === 'mcp-catalog',
      ),
      true,
    );
  } finally {
    await h.dispose();
  }
});

test('adding an MCP server uses Droid user configuration and returns a refreshed catalog', async () => {
  const h = createSessionManagerTestContext();
  const session = new FakeFactorySession('mcp-add', {}, h.calls);
  h.runtime.createQueue.push(session);

  try {
    await h.handle(
      command({
        type: 'mcp.add',
        requestId: 'add-1',
        cwd: '/workspace/project',
        server: {
          name: 'linear',
          serverType: 'http',
          url: 'https://mcp.linear.app/mcp',
          headers: { Authorization: 'Bearer secret' },
        },
      }),
    );

    assert.deepEqual(
      h.calls.find((call) => call.target === 'runtime' && call.method === 'mcp.addConfigured')
        ?.args,
      [
        {
          name: 'linear',
          serverType: 'http',
          url: 'https://mcp.linear.app/mcp',
          headers: { Authorization: 'Bearer secret' },
        },
        '/workspace/project',
      ],
    );
    assert.equal(mcpCatalog(h.events)?.requestId, 'add-1');
  } finally {
    await h.dispose();
  }
});

test('MCP catalog publishes tools after a connecting server settles', async () => {
  const calls: ConstructorParameters<typeof FakeFactorySession>[2] = [];
  const session = new FakeFactorySession('mcp-settle', {}, calls);
  session.nextMcpServers = {
    servers: [
      {
        name: 'local-tools',
        status: McpServerStatus.Connecting,
        source: SettingsLevel.User,
        isManaged: false,
        serverType: McpServerType.Stdio,
      },
    ],
    summary: { total: 1, connected: 0, connecting: 1, failed: 0, disabled: 0 },
  };
  const events: ServerEvent[] = [];
  const settings = new McpSettings(
    async () => session,
    () => [],
    { add: async () => undefined, remove: async () => undefined },
    (event) => events.push(event),
    async () => {
      session.nextMcpServers = {
        servers: [
          {
            name: 'local-tools',
            status: McpServerStatus.Connected,
            source: SettingsLevel.User,
            isManaged: false,
            serverType: McpServerType.Stdio,
            toolCount: 1,
          },
        ],
        summary: { total: 1, connected: 1, connecting: 0, failed: 0, disabled: 0 },
      };
      session.nextMcpTools = {
        tools: [
          {
            serverName: 'local-tools',
            name: 'echo',
            isEnabled: true,
          },
        ],
      };
    },
  );

  await settings.handle({ type: 'mcp.list', requestId: 'settle-1' });

  const catalogs = events.filter((event) => event.type === 'mcp.catalog');
  assert.equal(catalogs.length, 2);
  assert.equal(catalogs[0]?.summary.connecting, 1);
  assert.equal(catalogs[1]?.summary.connected, 1);
  assert.equal(catalogs[1]?.tools[0]?.name, 'echo');
});
