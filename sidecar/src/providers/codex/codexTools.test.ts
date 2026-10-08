import assert from 'node:assert/strict';
import test from 'node:test';
import { createSdkMcpServer, tool } from '@factory/droid-sdk';
import { z } from 'zod';
import type { PermissionOutcome, ServerEvent } from '../../protocol.js';
import { SessionInteractions } from '../../SessionInteractions.js';
import { sessionSummary } from '../../testing/sessionSummaryFixture.js';
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

type BridgeInteractions = ConstructorParameters<typeof CodexToolBridge>[1]['interactions'];

/** A bridge over one counting thread_spawn tool, with the given interactions. */
function spawnBridge(
  interactions: BridgeInteractions,
  options: { turnId?: () => string; isLive?: () => boolean; prompts?: OpenPrompts } = {},
) {
  let calls = 0;
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
      interactions,
      threadId: () => 'thread-one',
      turnId: options.turnId ?? (() => 'turn-one'),
      isLive: options.isLive ?? (() => true),
      prompts: options.prompts ?? new OpenPrompts('chat-one', interactions),
    },
  );
  return { bridge, calls: () => calls };
}

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
      if (method === 'config/read')
        return { config: { developer_instructions: 'Workspace guidance.' } };
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
  // The folder's own developer instructions stay, ahead of the note naming the tools.
  const instructions = (start?.params as { developerInstructions: string }).developerInstructions;
  assert.ok(instructions.startsWith('Workspace guidance.\n\n'));
  assert.match(instructions, /droidex_sessions/);
  const resumed = new CodexSession(input);
  await resumed.open('thread-one');
  const resume = sent.find((entry) => entry.method === 'thread/resume');
  assert.equal('dynamicTools' in (resume?.params as object), false);
  assert.equal(
    (resume?.params as { developerInstructions: string }).developerInstructions,
    instructions,
  );
  await fresh.close();
  await resumed.close();
});

test('a known tool runs through approval; unknown tools, other threads, and denials never reach the handler', async () => {
  const state = harness();
  assert.equal((await state.bridge.call({ ...spawn, namespace: 'other' })).success, false);
  assert.equal((await state.bridge.call({ ...spawn, tool: 'other' })).success, false);
  assert.equal((await state.bridge.call({ ...spawn, threadId: 'other' })).success, false);
  assert.equal(state.approvals.length, 0);

  assert.deepEqual(await state.bridge.call(spawn), {
    contentItems: [{ type: 'inputText', text: '{"reportBack":true}' }],
    success: true,
  });
  assert.equal(state.calls(), 1);
  assert.equal(state.approvals[0].signature, 'mcp::droidex-sessions::thread_spawn::thread');
  assert.deepEqual(state.approvals[0].mcpTool, {
    serverName: 'droidex-sessions',
    toolName: 'thread_spawn',
  });

  state.deny();
  assert.deepEqual(await state.bridge.call(spawn), {
    contentItems: [{ type: 'inputText', text: 'The user declined this tool.' }],
    success: false,
  });
  assert.equal(state.calls(), 1);
  state.switchThread();
  assert.equal((await state.bridge.call(spawn)).success, false);
  state.close();
});

test('turn settlement cancels a dynamic-tool approval and refuses a late allow', async () => {
  let resolveApproval: ((outcome: PermissionOutcome) => void) | undefined;
  let activeTurn = 'turn-one';
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
  const { bridge, calls } = spawnBridge(interactions, { turnId: () => activeTurn, prompts });

  const pending = bridge.call(spawn);
  assert.ok(resolveApproval);
  activeTurn = 'turn-two';
  prompts.cancel();
  resolveApproval('proceed_once');
  assert.equal((await pending).success, false);
  assert.equal(cancellations, 1);
  assert.equal(calls(), 0);
  assert.equal((await bridge.call(spawn)).success, false);
});

test('a tool is refused after a pending approval when the chat closes, and before approval after', async () => {
  let active = true;
  let resolveApproval: ((outcome: PermissionOutcome) => void) | undefined;
  let approvals = 0;
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
  const { bridge, calls } = spawnBridge(interactions, { isLive: () => active });
  const pending = bridge.call(spawn);
  assert.ok(resolveApproval);
  active = false;
  resolveApproval('proceed_once');
  assert.equal((await pending).success, false);
  assert.equal((await bridge.call(spawn)).success, false);
  assert.equal(approvals, 1);
  assert.equal(calls(), 0);
});

test('below High, DROIDEX asks before a spawn and a denial never runs it', async () => {
  const events: ServerEvent[] = [];
  const liveSession = {
    summary: sessionSummary({ appSessionId: 'chat-one', provider: 'codex' }),
    session: {
      get autonomy() {
        return liveSession.summary.autonomy;
      },
    },
  };
  const interactions = new SessionInteractions({
    getLiveSession: () => liveSession,
    updateSummary: () => {},
    setProviderSpecMode: async () => {},
    emit: (event) => {
      events.push(event);
    },
    emitError: () => {},
  });
  const { bridge, calls } = spawnBridge(interactions.interactionsFor({ id: 'chat-one' }));
  const pending = bridge.call(spawn);
  const request = events.find((event) => event.type === 'approval.requested');
  assert.equal(request?.type, 'approval.requested');
  if (request?.type !== 'approval.requested') return;
  assert.equal(request.request.kind, 'mcp');
  await interactions.respondToApproval('chat-one', request.request.requestId, 'cancel');
  assert.equal((await pending).success, false);
  assert.equal(calls(), 0);
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

test('a Stop sent before the turn has an id still refuses that turn its tools', async () => {
  const requestHandlers = new Map<string, (params: unknown) => unknown>();
  let releaseTurn: (value: unknown) => void = () => {};
  const sent: string[] = [];
  const client = {
    onNotification: () => {},
    onRequest: (method: string, handler: (params: unknown) => unknown) => {
      requestHandlers.set(method, handler);
    },
    onClose: () => {},
    onUnsupportedRequest: () => {},
    request: async (method: string) => {
      sent.push(method);
      if (method === 'thread/start') return { thread: { id: 'thread-one' }, model: 'codex-model' };
      if (method === 'config/read') return { config: {} };
      if (method === 'turn/start') return await new Promise((resolve) => (releaseTurn = resolve));
      if (method === 'skills/list') return { data: [] };
      if (method === 'plugin/installed') return { marketplaces: [] };
      if (method === 'app/list') return { data: [], nextCursor: null };
      return {};
    },
    close: async () => {},
  } as unknown as AppServerClient;
  let ran = 0;
  const session = new CodexSession({
    appSessionId: 'chat-one',
    client,
    cwd: '/workspace',
    autonomy: 'high',
    model: {},
    interactions: {
      requestApproval: async () => 'proceed_once',
      requestQuestion: async () => ({ cancelled: true, answers: [] }),
      isActive: () => true,
      cancelPending: () => {},
    },
    inAppMcpServers: [
      createSdkMcpServer({
        name: 'droidex-sessions',
        tools: [
          tool('session_list', 'List chats.', {}, () => {
            ran += 1;
            return '[]';
          }),
        ],
      }),
    ],
  });
  await session.open();
  const turn = session.stream('List my chats.');
  const first = turn.next();
  await new Promise((resolve) => setImmediate(resolve));
  await session.interrupt();
  releaseTurn({ turn: { id: 'turn-one' } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(sent.includes('turn/interrupt'));

  const reply = (await requestHandlers.get('item/tool/call')?.({
    threadId: 'thread-one',
    turnId: 'turn-one',
    callId: 'call-one',
    namespace: 'droidex_sessions',
    tool: 'session_list',
    arguments: {},
  })) as { success: boolean };
  assert.equal(reply.success, false);
  assert.equal(ran, 0);
  void first;
  await session.close();
});
