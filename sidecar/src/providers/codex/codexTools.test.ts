import assert from 'node:assert/strict';
import test from 'node:test';
import { createSdkMcpServer, tool } from '@factory/droid-sdk';
import { z } from 'zod';
import type { PermissionOutcome, ServerEvent, SessionSummary } from '../../protocol.js';
import { mcpGrantSignature } from '../../mcpGrant.js';
import { SessionInteractions } from '../../SessionInteractions.js';
import type { ProviderApprovalRequest } from '../interactions.js';
import type { AppServerClient } from './appServer.js';
import { OpenPrompts } from './codexApprovals.js';
import { CodexEventMapper } from './codexEvents.js';
import { CodexSession } from './codexSession.js';
import { CodexToolBridge } from './codexTools.js';

function harness() {
  let calls = 0;
  let outcome: PermissionOutcome = 'proceed_once';
  let threadId = 'thread-one';
  let turnId = 'turn-one';
  let live = true;
  const approvals: ProviderApprovalRequest[] = [];
  const server = createSdkMcpServer({
    name: 'droidex-sessions',
    tools: [
      tool('thread_spawn', 'Start a thread.', { reportBack: z.boolean() }, (input) => {
        calls += 1;
        return { content: [{ type: 'text', text: JSON.stringify(input) }] };
      }),
    ],
  });
  const automations = createSdkMcpServer({
    name: 'droidex-automations',
    tools: [tool('automation_list', 'List automations.', {}, () => 'No automations.')],
  });
  const interactions = {
    requestApproval: async (approval: ProviderApprovalRequest) => {
      approvals.push(approval);
      return outcome;
    },
    requestQuestion: async () => ({ cancelled: true, answers: [] }),
    isActive: () => live,
    cancelPending: () => {},
  };
  const bridge = new CodexToolBridge([server, automations], {
    appSessionId: 'chat-one',
    interactions: interactions,
    threadId: () => threadId,
    turnId: () => turnId,
    isLive: () => live,
    prompts: new OpenPrompts('chat-one', interactions),
  });
  return {
    bridge,
    approvals,
    calls: () => calls,
    deny: () => {
      outcome = 'cancel';
    },
    close: () => {
      live = false;
    },
    switchThread: () => {
      threadId = 'thread-two';
    },
    endTurn: () => {
      turnId = 'turn-two';
    },
  };
}

const spawn = {
  threadId: 'thread-one',
  turnId: 'turn-one',
  namespace: 'droidex_sessions',
  tool: 'thread_spawn',
  arguments: { reportBack: true },
};

test('declares valid deferred namespaces and JSON Schemas once per bridge', () => {
  const { bridge } = harness();
  assert.deepEqual(
    bridge.declarations.map((entry) => entry.name),
    ['droidex_sessions', 'droidex_automations'],
  );
  for (const namespace of bridge.declarations) {
    assert.match(namespace.name, /^[a-zA-Z0-9_-]+$/);
    for (const declared of namespace.tools) {
      assert.match(declared.name, /^[a-zA-Z0-9_-]+$/);
      assert.equal(declared.deferLoading, true);
      assert.match(JSON.stringify(declared.inputSchema), /"type":"object"/);
    }
  }
  assert.match(
    JSON.stringify(bridge.declarations[0].tools[0].inputSchema),
    /"required":\["reportBack"\]/,
  );
});

test('a new Codex thread declares its tools and a resumed thread keeps its stored catalog', async () => {
  const sent: { method: string; params: unknown }[] = [];
  const client = {
    onNotification: () => {},
    onRequest: () => {},
    onClose: () => {},
    onUnsupportedRequest: () => {},
    request: async (method: string, params: unknown) => {
      sent.push({ method, params });
      if (method === 'thread/start' || method === 'thread/resume')
        return { thread: { id: 'thread-one' }, model: 'codex-model' };
      if (method === 'skills/list') return { data: [] };
      if (method === 'plugin/installed') return { marketplaces: [] };
      if (method === 'app/list') return { data: [], nextCursor: null };
      return {};
    },
    close: async () => {},
  } as unknown as AppServerClient;
  const interactions = {
    requestApproval: async () => 'cancel' as const,
    requestQuestion: async () => ({ cancelled: true, answers: [] }),
    isActive: () => true,
    cancelPending: () => {},
  };
  const input = {
    appSessionId: 'chat-one',
    client,
    cwd: '/workspace',
    autonomy: 'low' as const,
    model: {},
    interactions,
    inAppMcpServers: [
      createSdkMcpServer({
        name: 'droidex-sessions',
        tools: [tool('session_list', 'List chats.', {}, () => '[]')],
      }),
    ],
  };
  const fresh = new CodexSession(input);
  await fresh.open();
  const start = sent.find((entry) => entry.method === 'thread/start');
  assert.deepEqual(
    (
      start?.params as { dynamicTools: { name: string; tools: { deferLoading: boolean }[] }[] }
    ).dynamicTools.map((namespace) => ({
      name: namespace.name,
      deferred: namespace.tools.every((tool) => tool.deferLoading),
    })),
    [{ name: 'droidex_sessions', deferred: true }],
  );
  const resumed = new CodexSession(input);
  await resumed.open('thread-one');
  const resume = sent.find((entry) => entry.method === 'thread/resume');
  assert.equal('dynamicTools' in (resume?.params as object), false);
  await fresh.close();
  await resumed.close();
});

test('shared MCP grant keys retain Droid and Claude scopes', () => {
  assert.equal(
    mcpGrantSignature('', 'droidex_sessions___thread_spawn', { reportBack: true }),
    'mcp::::droidex_sessions___thread_spawn::thread',
  );
  assert.equal(
    mcpGrantSignature('droidex-sessions', 'session_stop', { sessionId: 'chat-two' }),
    'mcp::droidex-sessions::session_stop::chat-two',
  );
  assert.equal(mcpGrantSignature('droidex-sessions', 'thread_spawn', {}), '');
});

test('Droid combined automation mutations keep argument-scoped grants', () => {
  const first = mcpGrantSignature('', 'droidex_automations___automation_update', {
    automationId: 'one',
    prompt: 'first',
  });
  const second = mcpGrantSignature('', 'droidex_automations___automation_update', {
    automationId: 'one',
    prompt: 'second',
  });
  assert.match(first, /^mcp::::droidex_automations___automation_update::[a-f0-9]{32}$/);
  assert.notEqual(first, second);
});

test('executes a known tool through approval and returns Codex content items', async () => {
  const { bridge, approvals, calls } = harness();
  assert.deepEqual(await bridge.call(spawn), {
    contentItems: [{ type: 'inputText', text: '{"reportBack":true}' }],
    success: true,
  });
  assert.equal(calls(), 1);
  assert.equal(approvals[0].signature, 'mcp::droidex-sessions::thread_spawn::thread');
  assert.deepEqual(approvals[0].mcpTool, {
    serverName: 'droidex-sessions',
    toolName: 'thread_spawn',
  });
});

test('rejects unknown tools, other threads, and denied requests before the handler', async () => {
  const state = harness();
  assert.equal((await state.bridge.call({ ...spawn, namespace: 'other' })).success, false);
  assert.equal((await state.bridge.call({ ...spawn, tool: 'other' })).success, false);
  assert.equal((await state.bridge.call({ ...spawn, threadId: 'other' })).success, false);
  assert.equal(state.approvals.length, 0);
  state.deny();
  assert.deepEqual(await state.bridge.call(spawn), {
    contentItems: [{ type: 'inputText', text: 'The user declined this tool.' }],
    success: false,
  });
  assert.equal(state.calls(), 0);
  state.switchThread();
  assert.equal((await state.bridge.call(spawn)).success, false);
  state.close();
});

test('a chat closed while approval is pending never runs the tool', async () => {
  let decide: ((outcome: PermissionOutcome) => void) | undefined;
  let calls = 0;
  let live = true;
  const interactions = {
    requestApproval: () =>
      new Promise<PermissionOutcome>((resolve) => {
        decide = resolve;
      }),
    requestQuestion: async () => ({ cancelled: true, answers: [] }),
    isActive: () => live,
    cancelPending: () => {},
  };
  const bridge = new CodexToolBridge(
    [
      createSdkMcpServer({
        name: 'droidex-sessions',
        tools: [
          tool('thread_spawn', 'Start a thread.', { reportBack: z.boolean() }, () => {
            calls += 1;
            return 'started';
          }),
        ],
      }),
    ],
    {
      appSessionId: 'chat-one',
      interactions: interactions,
      threadId: () => 'thread-one',
      turnId: () => 'turn-one',
      isLive: () => live,
      prompts: new OpenPrompts('chat-one', interactions),
    },
  );
  const pending = bridge.call(spawn);
  live = false;
  assert.ok(decide);
  decide('proceed_once');
  assert.equal((await pending).success, false);
  assert.equal(calls, 0);
});

test('turn settlement cancels a dynamic-tool approval and refuses a late allow', async () => {
  let resolveApproval: ((outcome: PermissionOutcome) => void) | undefined;
  let activeTurn = 'turn-one';
  let calls = 0;
  let cancellations = 0;
  const interactions = {
    requestApproval: () =>
      new Promise<PermissionOutcome>((resolve) => {
        resolveApproval = resolve;
      }),
    requestQuestion: async () => ({ cancelled: true, answers: [] }),
    isActive: () => true,
    cancelPending: () => {
      cancellations += 1;
      resolveApproval?.('cancel');
    },
  };
  const prompts = new OpenPrompts('chat-one', interactions);
  const bridge = new CodexToolBridge(
    [
      createSdkMcpServer({
        name: 'droidex-sessions',
        tools: [
          tool('thread_spawn', 'Start a thread.', { reportBack: z.boolean() }, () => {
            calls += 1;
            return 'started';
          }),
        ],
      }),
    ],
    {
      appSessionId: 'chat-one',
      interactions: interactions,
      threadId: () => 'thread-one',
      turnId: () => activeTurn,
      isLive: () => true,
      prompts: prompts,
    },
  );

  const pending = bridge.call(spawn);
  assert.ok(resolveApproval);
  activeTurn = 'turn-two';
  prompts.cancel();
  resolveApproval('proceed_once');
  assert.equal((await pending).success, false);
  assert.equal(cancellations, 1);
  assert.equal(calls, 0);
  assert.equal((await bridge.call(spawn)).success, false);
});

test('a tool is refused before approval and after approval when teardown begins', async () => {
  let active = true;
  let resolveApproval: ((outcome: PermissionOutcome) => void) | undefined;
  let approvals = 0;
  let calls = 0;
  const interactions = {
    requestApproval: () => {
      approvals += 1;
      return new Promise<PermissionOutcome>((resolve) => {
        resolveApproval = resolve;
      });
    },
    requestQuestion: async () => ({ cancelled: true, answers: [] }),
    isActive: () => active,
    cancelPending: () => {},
  };
  const bridge = new CodexToolBridge(
    [
      createSdkMcpServer({
        name: 'droidex-sessions',
        tools: [
          tool('thread_spawn', 'Start a thread.', { reportBack: z.boolean() }, () => {
            calls += 1;
            return 'started';
          }),
        ],
      }),
    ],
    {
      appSessionId: 'chat-one',
      interactions: interactions,
      threadId: () => 'thread-one',
      turnId: () => 'turn-one',
      isLive: () => interactions.isActive(),
      prompts: new OpenPrompts('chat-one', interactions),
    },
  );
  const pending = bridge.call(spawn);
  assert.ok(resolveApproval);
  active = false;
  resolveApproval('proceed_once');
  assert.equal((await pending).success, false);
  assert.equal((await bridge.call(spawn)).success, false);
  assert.equal(approvals, 1);
  assert.equal(calls, 0);
});

test('below High, DROIDEX asks before a spawn and a denial never runs it', async () => {
  let calls = 0;
  const events: ServerEvent[] = [];
  const summary: SessionSummary = {
    appSessionId: 'chat-one',
    providerSessionId: 'chat-one',
    provider: 'codex',
    sessionPurpose: 'chat',
    interactionMode: 'auto',
    role: 'primary',
    title: 'Chat',
    goal: 'Chat',
    cwd: '/workspace',
    workspaceKind: 'folder',
    autonomy: 'low',
    phase: 'paused',
    features: [],
    tokensIn: 0,
    tokensOut: 0,
    contextTokens: 0,
    createdAt: 1,
    updatedAt: 1,
  };
  const liveSession = { summary };
  const interactions = new SessionInteractions({
    getLiveSession: () => liveSession,
    updateSummary: () => {},
    setProviderSpecMode: async () => {},
    emit: (event) => {
      events.push(event);
    },
    emitError: () => {},
  });
  const bridge = new CodexToolBridge(
    [
      createSdkMcpServer({
        name: 'droidex-sessions',
        tools: [
          tool('thread_spawn', 'Start a thread.', { reportBack: z.boolean() }, () => {
            calls += 1;
            return 'started';
          }),
        ],
      }),
    ],
    {
      appSessionId: 'chat-one',
      interactions: interactions.interactionsFor({ id: 'chat-one' }),
      threadId: () => 'thread-one',
      turnId: () => 'turn-one',
      isLive: () => true,
      prompts: new OpenPrompts('chat-one', interactions.interactionsFor({ id: 'chat-one' })),
    },
  );
  const pending = bridge.call(spawn);
  const request = events.find((event) => event.type === 'approval.requested');
  assert.equal(request?.type, 'approval.requested');
  if (request?.type !== 'approval.requested') return;
  assert.equal(request.request.kind, 'mcp');
  await interactions.respondToApproval('chat-one', request.request.requestId, 'cancel');
  assert.equal((await pending).success, false);
  assert.equal(calls, 0);
});

test('maps dynamic tool items to the existing DROIDEX MCP transcript rows', () => {
  const mapper = new CodexEventMapper('chat-one');
  const item = {
    type: 'dynamicToolCall',
    id: 'call-one',
    namespace: 'droidex_sessions',
    tool: 'thread_spawn',
    arguments: { reportBack: true },
    status: 'inProgress',
    contentItems: null,
    success: null,
  };
  const started = mapper.map('item/started', { item });
  assert.equal(started[0].transcript?.toolName, 'mcp__droidex-sessions__thread_spawn');
  assert.deepEqual(started[0].transcript?.toolArgs, { reportBack: true });
  const completed = mapper.map('item/completed', {
    item: {
      ...item,
      status: 'completed',
      success: true,
      contentItems: [{ type: 'inputText', text: 'Thread started.' }],
    },
  });
  assert.equal(completed[0].transcript?.text, 'Thread started.');
  assert.equal(completed[0].transcript?.isError, false);
});
