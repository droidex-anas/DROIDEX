import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { createSdkMcpServer } from '@factory/droid-sdk';
import type { NormalizedEvent } from '../../normalize.js';
import type { PermissionOutcome, ServerEvent } from '../../protocol.js';
import { SessionInteractions, type InteractionLiveSession } from '../../SessionInteractions.js';
import type { ProviderApprovalRequest, ProviderInteractions } from '../interactions.js';
import { deferred } from '../../testing/projectServiceHarness.js';
import { sessionSummary } from '../../testing/sessionSummaryFixture.js';
import { DevinProvider } from './DevinProvider.js';
import type { DevinSession } from './devinSession.js';

const CLI = String.raw`#!/usr/bin/env node
const { appendFileSync, existsSync } = require('node:fs');
const { createInterface } = require('node:readline');
const { join } = require('node:path');
const root = __dirname;
if (process.argv[2] === '--version') { console.log('devin 3000.14.30821 (fake)'); process.exit(0); }
if (process.argv[2] === 'auth') {
  console.log(existsSync(join(root, 'signed-out')) ? 'Not logged in.' : 'Logged in.'); process.exit(0);
}
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
const result = (id, result) => send({ id, result });
const update = (update) => send({ method: 'session/update', params: { sessionId: 'devin-one', update } });
const childUpdate = (id, event) => update({ ...event, _meta: { ...event._meta,
  'cognition.ai/subagent_context': { parentAgentId: id } } });
const childStarted = (agentId) => update({ sessionUpdate: 'tool_call', toolCallId: 'spawn-' + agentId,
  title: 'Task', _meta: { 'cognition.ai/subagent_started': {
    agentId, title: 'Review ' + agentId, task: 'Inspect ' + agentId, model: 'swe-child' } } });
const childCompleted = (agentId, success = true) => update({ sessionUpdate: 'tool_call_update',
  toolCallId: 'spawn-' + agentId, _meta: { 'cognition.ai/subagent_completed': {
    agentId, success, summary: 'Summary ' + agentId } } });
const childText = (agentId, text) => childUpdate(agentId, { sessionUpdate: 'agent_message_chunk',
  content: { type: 'text', text }, _meta: { 'cognition.ai/streamingMessageId': 'answer' } });
const configOptions = [{ id: 'model', name: 'Model', type: 'select', currentValue: 'swe-fast',
  options: [{ value: 'swe-fast', name: 'SWE Fast' }, { value: 'swe', name: 'SWE' }] }];
if (existsSync(join(root, 'empty-models'))) configOptions[0].options = [];
let pending, pendingConfig, permission, pendingClose, permissionEndsTurn = true, servers = [];
let terminalSequence = 0, terminalDone = Promise.resolve(), terminalFinished;
const terminalRequests = new Map();
const terminalCall = (method, params) => new Promise((resolve, reject) => {
  const id = 'terminal-' + ++terminalSequence;
  terminalRequests.set(id, { resolve, reject });
  send({ id, method: 'terminal/' + method, params: { sessionId: 'devin-one', ...params } });
});
createInterface({ input: process.stdin }).on('line', async (line) => {
  const message = JSON.parse(line);
  appendFileSync(join(root, 'requests.jsonl'), JSON.stringify(message) + '\n');
  if (terminalRequests.has(message.id)) {
    const { resolve, reject } = terminalRequests.get(message.id);
    terminalRequests.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
    return;
  }
  if (message.id === 'permission') {
    appendFileSync(join(root, 'permission.json'), JSON.stringify(message.result) + '\n');
    if (permissionEndsTurn) result(permission, { stopReason: 'end_turn' });
    else childCompleted('approval-child');
    permission = undefined;
    if (pendingClose !== undefined) { result(pendingClose, {}); pendingClose = undefined; }
    return;
  }
  const { id, method, params } = message;
  if (method === 'session/set_config_option' && params.value === 'terminal-sync') await terminalDone;
  if (method === 'initialize') {
    if (existsSync(join(root, 'hang'))) return;
    result(id, { protocolVersion: 1, agentCapabilities: { loadSession: true,
      sessionCapabilities: { close: {}, delete: {} } } });
  } else if (method === 'session/new' || method === 'session/load') {
    servers = params.mcpServers;
    update({ sessionUpdate: 'config_option_update', configOptions });
    if (method === 'session/load') {
      update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'REPLAY' } });
      if (existsSync(join(root, 'replay-children'))) {
        childStarted('background'); childText('background', 'Replayed child answer');
        childStarted('finished'); childCompleted('finished');
        childStarted('untracked');
      }
    }
    result(id, { sessionId: 'devin-one' });
  } else if (method === 'session/set_config_option') {
    if (params.value === 'finish-background') {
      childText('background', 'Background answer');
      childCompleted('background');
    }
    if (params.value === 'blocked') pendingConfig = id;
    else result(id, { configOptions });
  }
  else if (method === 'session/close') {
    childStarted('late'); childText('background', 'Late output'); childCompleted('approval-child');
    if (permission !== undefined) pendingClose = id;
    else result(id, {});
  }
  else if (method === 'session/delete') result(id, {});
  else if (method === 'session/cancel') {
    if (pendingConfig !== undefined) { result(pendingConfig, { configOptions }); pendingConfig = undefined; }
    if (pending !== undefined) { result(pending, { stopReason: 'cancelled' }); pending = undefined; }
  }
  else if (method === 'session/prompt') {
    const text = params.prompt[0].text;
    if (text === 'exit') { process.stderr.write('backend failed\n'); process.exit(7); }
    if (text === 'refuse') { result(id, { stopReason: 'refusal' }); return; }
    if (text === 'empty') { result(id, { stopReason: 'end_turn' }); return; }
    if (text === 'wait') { pending = id; update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'waiting' } }); return; }
    if (text === 'background') { childStarted('background'); result(id, { stopReason: 'end_turn' }); return; }
    if (text === 'children') {
      childStarted('child-a'); childStarted('child-b');
      update({ sessionUpdate: 'tool_call', toolCallId: 'shared', title: 'Parent tool', status: 'in_progress' });
      for (const agentId of ['child-a', 'child-b']) {
        childText(agentId, 'Answer ' + agentId);
        childUpdate(agentId, { sessionUpdate: 'usage_update', used: 999, size: 1000 });
        childUpdate(agentId, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Think ' + agentId } });
        childUpdate(agentId, { sessionUpdate: 'tool_call', toolCallId: 'shared', title: 'Tool', kind: 'execute',
          status: 'in_progress', rawInput: { command: agentId }, _meta: { 'cognition.ai/inferenceToolName': 'shell' } });
      }
      for (const agentId of ['child-b', 'child-a']) {
        childUpdate(agentId, { sessionUpdate: 'tool_call_update', toolCallId: 'shared',
          status: agentId === 'child-b' ? 'failed' : 'completed', rawOutput: 'Result ' + agentId });
        childCompleted(agentId, agentId !== 'child-b');
      }
      childCompleted('child-a'); childText('child-a', 'Late child output');
      childText('unknown', 'Unknown child output');
      update({ sessionUpdate: 'tool_call', toolCallId: 'invalid', title: 'Task',
        _meta: { 'cognition.ai/subagent_started': { agentId: 123 } } });
      update({ sessionUpdate: 'tool_call_update', toolCallId: 'shared', status: 'completed', rawOutput: 'Parent result' });
      childText('root', 'Parent answer');
      result(id, { stopReason: 'end_turn' }); return;
    }
    if (['approve', 'approve-child', 'approve-background', 'approve-completed', 'approve-orphan'].includes(text)) {
      const childId = text === 'approve-orphan' ? 'unknown' : 'approval-child';
      if (text === 'approve-child' || text === 'approve-background') childStarted(childId);
      if (text === 'approve-completed') childCompleted(childId);
      permission = id;
      permissionEndsTurn = text !== 'approve-background';
      send({ id: 'permission', method: 'session/request_permission', params: {
        sessionId: 'devin-one', toolCall: { toolCallId: 'edit', title: 'Edit file', kind: 'edit', rawInput: { path: '/file' },
          ...(text !== 'approve' ? { _meta: { 'cognition.ai/subagent_context': { parentAgentId: childId } } } : {}) },
        options: [ { optionId: 'plan_bypass', name: 'Bypass', kind: 'allow_once' },
          { optionId: 'once', name: 'Once', kind: 'allow_once' },
          { optionId: 'always', name: 'Always', kind: 'allow_always' },
          { optionId: 'no', name: 'No', kind: 'reject_once' } ] } });
      if (!permissionEndsTurn) result(id, { stopReason: 'end_turn' });
      return;
    }
    if (text.startsWith('terminal-')) {
      terminalDone = new Promise((resolve) => { terminalFinished = resolve; });
      const script = text === 'terminal-live'
        ? 'const fs = require("fs"); const watch = fs.watch(' + JSON.stringify(root) + ', () => { if (fs.existsSync(' + JSON.stringify(join(root, 'terminal-go')) + ')) { watch.close(); process.stdout.write("|DONE"); } }); process.stdout.write("READY|" + process.env.ACP_TEST + "|" + process.cwd());'
        : 'process.stdout.write("READY:" + process.pid); setInterval(() => {}, 1000);';
      const command = text === 'terminal-args' ? process.execPath
        : text === 'terminal-truncate' ? "printf '123ééZ'"
        : text === 'terminal-empty' ? 'true'
        : JSON.stringify(process.execPath) + ' -e ' + JSON.stringify(script) + (text.startsWith('terminal-background') ? ' &' : '');
      try {
        const { terminalId } = await terminalCall('create', { command,
          ...(text === 'terminal-args' ? { args: ['-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', 'space value', 'paren(value);$(literal)'] } : {}),
          cwd: text === 'terminal-error' ? join(root, 'missing') : root,
          env: [{ name: 'ACP_TEST', value: 'terminal-env' }],
          ...(text === 'terminal-truncate' ? { outputByteLimit: 4 } : {}) });
        const terminal = { terminalId };
        const initial = await terminalCall('output', terminal);
        update({ sessionUpdate: 'tool_call', toolCallId: 'terminal-tool', title: 'shell',
          kind: 'execute', status: 'in_progress', rawInput: { command },
          content: [{ type: 'terminal', terminalId }] });
        if (text === 'terminal-wait' || text === 'terminal-background') pending = id;
        if (text === 'terminal-release') await terminalCall('release', terminal);
        if (text === 'terminal-kill') await terminalCall('kill', terminal);
        const exit = await terminalCall('wait_for_exit', terminal).catch((error) => ({ error: error.message }));
        const output = await terminalCall('output', terminal).catch((error) => ({ error: error.message }));
        await terminalCall('release', terminal);
        await terminalCall('release', terminal);
        const released = await terminalCall('output', terminal).catch((error) => ({ error: error.message }));
        appendFileSync(join(root, 'terminal-result'), JSON.stringify({ initial, exit, output, released }));
        update({ sessionUpdate: 'tool_call_update', toolCallId: 'terminal-tool', status: 'completed',
          content: [{ type: 'terminal', terminalId }] });
      } catch (error) {
        appendFileSync(join(root, 'terminal-result'), JSON.stringify({ error: error.message }));
      } finally { terminalFinished(); }
      if (text !== 'terminal-wait' && text !== 'terminal-background') result(id, { stopReason: 'end_turn' });
      return;
    }
    if (text === 'mcp') {
      const server = servers.find((server) => server.name === 'app');
      const response = await fetch(server.url, { method: 'POST', headers: {
        'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
      }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'echo', arguments: {} } }) });
      appendFileSync(join(root, 'mcp-result'), await response.text());
    }
    update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'child' },
      _meta: { 'cognition.ai/subagent_context': { parentAgentId: 'child-one' } } });
    for (const text of ['Hello ', 'world']) update({ sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text }, _meta: { 'cognition.ai/streamingMessageId': 'answer' } });
    update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Think' },
      _meta: { 'cognition.ai/streamingMessageId': 'thought' } });
    update({ sessionUpdate: 'tool_call', toolCallId: 'tool', title: 'Tool', kind: 'execute',
      status: 'in_progress', rawInput: { command: 'pwd' }, _meta: { 'cognition.ai/inferenceToolName': 'shell' } });
    update({ sessionUpdate: 'tool_call_update', toolCallId: 'tool', status: 'completed', rawOutput: '/workspace' });
    update({ sessionUpdate: 'tool_call', toolCallId: 'failed', title: 'Fail', status: 'failed', rawOutput: 'broken' });
    update({ sessionUpdate: 'usage_update', used: 20, size: 100 });
    result(id, { stopReason: 'end_turn' });
  }
});
`;

async function fixture(t: TestContext) {
  const cwd = await mkdtemp(join(tmpdir(), 'devin-provider-'));
  const executable = join(cwd, 'devin.cjs');
  await writeFile(executable, CLI, { mode: 0o755 });
  const previous = process.env.DEVIN_PATH;
  const sessions: DevinSession[] = [];
  process.env.DEVIN_PATH = executable;
  t.after(async () => {
    await Promise.all(sessions.map((session) => session.close()));
    if (previous === undefined) delete process.env.DEVIN_PATH;
    else process.env.DEVIN_PATH = previous;
    await rm(cwd, { recursive: true, force: true });
  });
  const approvals: ProviderApprovalRequest[] = [];
  let outcome: PermissionOutcome = 'proceed_once';
  const interactions: ProviderInteractions = {
    requestApproval: async (request) => {
      approvals.push(request);
      return outcome;
    },
    requestQuestion: async () => ({ cancelled: true, answers: [] }),
    isActive: () => true,
    cancelPending: () => undefined,
  };
  const input = {
    cwd,
    appSessionId: 'app-one',
    autonomy: 'low' as const,
    interactionMode: 'auto' as const,
    mcpServers: [],
    interactions,
  };
  const provider = new DevinProvider();
  const create = async () => {
    const session = await provider.create(input);
    sessions.push(session);
    return session;
  };
  const requests = async (): Promise<{ method?: string; params?: Record<string, unknown> }[]> =>
    (await readFile(join(cwd, 'requests.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
  return {
    cwd,
    input,
    provider,
    create,
    requests,
    approvals,
    sessions,
    answer: (value: PermissionOutcome) => {
      outcome = value;
    },
  };
}

async function collect(stream: AsyncIterable<NormalizedEvent>): Promise<NormalizedEvent[]> {
  const events: NormalizedEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

test('Devin client terminals stream shell output with cwd and env, then retain the result after release', async (t) => {
  const h = await fixture(t);
  const session = await h.create();
  const events: NormalizedEvent[] = [];
  let continued = false;
  for await (const event of session.stream('terminal-live')) {
    events.push(event);
    if (
      !continued &&
      event.transcript?.kind === 'tool_call' &&
      event.transcript.text?.includes('READY')
    ) {
      continued = true;
      assert.equal(event.transcript.text, `READY|terminal-env|${h.cwd}`);
      await writeFile(join(h.cwd, 'terminal-go'), 'go');
    }
  }
  assert.equal(continued, true);
  const response = JSON.parse(await readFile(join(h.cwd, 'terminal-result'), 'utf8'));
  assert.equal(response.initial.exitStatus, undefined);
  assert.equal(response.exit.exitCode, 0);
  assert.equal(response.output.truncated, false);
  assert.equal(response.output.output, `READY|terminal-env|${h.cwd}|DONE`);
  assert.match(response.released.error, /Unknown Devin terminal/);
  assert.equal(
    events.find((event) => event.transcript?.kind === 'tool_result')?.transcript?.text,
    response.output.output,
  );
});

test('Devin terminals handle UTF-8 truncation, empty output, errors, explicit kill and idempotent release', async (t) => {
  for (const mode of ['args', 'truncate', 'empty', 'error', 'kill', 'release', 'background-exit']) {
    await t.test(mode, async (t) => {
      const h = await fixture(t);
      const session = await h.create();
      await collect(session.stream('terminal-' + mode));
      const response = JSON.parse(await readFile(join(h.cwd, 'terminal-result'), 'utf8'));
      if (mode === 'error') {
        assert.match(response.error, /ENOENT/);
        return;
      }
      assert.match(response.released.error, /Unknown Devin terminal/);
      if (mode === 'args') {
        assert.equal(response.exit.exitCode, 0);
        assert.deepEqual(JSON.parse(response.output.output), [
          'space value',
          'paren(value);$(literal)',
        ]);
      } else if (mode === 'truncate') {
        assert.equal(response.output.output, 'éZ');
        assert.equal(response.output.truncated, true);
      } else if (mode === 'empty') {
        assert.equal(response.output.output, '');
        assert.equal(response.output.truncated, false);
      } else if (mode === 'kill') {
        assert.equal(response.exit.signal, 'SIGTERM');
        assert.deepEqual(response.output.exitStatus, response.exit);
      } else if (mode === 'background-exit') {
        assert.equal(response.exit.exitCode, 0);
        assert.match(response.output.output, /READY:/);
      } else {
        assert.match(response.exit.error, /Unknown Devin terminal/);
        assert.match(response.output.error, /Unknown Devin terminal/);
      }
    });
  }
});

test('Devin interrupt and close kill running terminal descendants', async (t) => {
  for (const action of ['interrupt', 'close', 'background'] as const) {
    await t.test(action, async (t) => {
      const h = await fixture(t);
      const session = await h.create();
      const stream = session
        .stream(action === 'background' ? 'terminal-background' : 'terminal-wait')
        [Symbol.asyncIterator]();
      let pid: number | undefined;
      while (pid === undefined) {
        const next = await stream.next();
        assert.equal(next.done, false);
        const text = next.value?.transcript?.text;
        if (text?.startsWith('READY:')) pid = Number(text.slice(6));
      }
      process.kill(pid, 0);
      await session[action === 'background' ? 'interrupt' : action]();
      const status = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' });
      assert.equal(status.error, undefined);
      assert.ok(status.status === 0 || status.status === 1);
      assert.match(status.stdout.trim(), /^(?:Z.*)?$/);
      await collect({ [Symbol.asyncIterator]: () => stream });
      if (action !== 'close') {
        await session.setModel({ modelId: 'terminal-sync' });
        const response = JSON.parse(await readFile(join(h.cwd, 'terminal-result'), 'utf8'));
        if (action === 'background') assert.equal(response.exit.exitCode, 0);
        else assert.equal(response.exit.signal, 'SIGTERM');
      }
    });
  }
});

test('Devin maps streamed text, reasoning, tools and context without leaking child updates', async (t) => {
  const h = await fixture(t);
  const session = await h.create();
  assert.equal(session.providerSessionId, 'devin-one');
  const events = await collect(
    session.stream('hello', [{ kind: 'skill', name: 'guide', path: '/guide.md' }]),
  );
  const rows = events.flatMap((event) => (event.transcript ? [event.transcript] : []));
  assert.deepEqual(
    rows.filter((row) => row.kind === 'text').map((row) => row.text),
    ['Hello ', 'world'],
  );
  assert.equal(rows[0]?.textUpdate?.messageId, 'answer');
  assert.ok(
    rows.every((row) => row.appSessionId === 'app-one' && row.sourceSessionId === 'devin-one'),
  );
  assert.equal(rows.find((row) => row.kind === 'thinking')?.text, 'Think');
  assert.equal(rows.find((row) => row.toolUseId === 'tool')?.toolName, 'shell');
  assert.equal(
    rows.find((row) => row.kind === 'tool_result' && row.toolUseId === 'tool')?.text,
    '/workspace',
  );
  assert.equal(
    rows.find((row) => row.kind === 'tool_result' && row.toolUseId === 'failed')?.isError,
    true,
  );
  assert.equal(events.find((event) => event.tokens)?.tokens?.contextTokens, 20);
  assert.deepEqual(events.at(-1), { done: true });
  const sent = await h.requests();
  assert.deepEqual(
    sent.find((request) => request.method === 'initialize')?.params?.clientCapabilities,
    {
      terminal: true,
      _meta: { 'cognition.ai/messageGrouping': true, 'cognition.ai/subagentSupport': true },
    },
  );
  assert.deepEqual(sent.find((request) => request.method === 'session/prompt')?.params?.prompt, [
    { type: 'text', text: 'hello' },
    { type: 'resource_link', name: 'guide', uri: 'file:///guide.md' },
  ]);
});

test('Devin resumes without replaying load history and applies live mode and model selections', async (t) => {
  const h = await fixture(t);
  const session = await h.provider.resume('devin-one', { ...h.input, modelId: 'swe' });
  h.sessions.push(session);
  await session.setAutonomy('high');
  await session.setInteractionMode('spec');
  await session.setAutonomy('medium');
  await session.setInteractionMode('auto');
  await session.setModel({ modelId: null });
  assert.equal(session.autonomy, 'medium');
  assert.deepEqual(await collect(session.stream('empty')), [{ done: true }]);
  assert.equal(await session.steer(), false);
  const settings = (await h.requests()).filter(
    (request) => request.method === 'session/set_config_option',
  );
  assert.deepEqual(
    settings.map((request) => request.params?.value),
    ['accept-edits', 'swe', 'bypass', 'plan', 'plan', 'smart'],
  );
});

test('Devin approval choices honor user outcomes and never select plan_bypass', async (t) => {
  const h = await fixture(t);
  const session = await h.create();
  for (const [answer, expected] of [
    ['proceed_once', 'once'],
    ['proceed_always', 'always'],
    ['cancel', undefined],
    ['refuse', 'no'],
  ] as const) {
    h.answer(answer);
    await collect(session.stream('approve'));
    const responses = await readFile(join(h.cwd, 'permission.json'), 'utf8');
    const last = responses.trim().split('\n').at(-1) ?? '';
    if (expected) assert.match(last, new RegExp(`"optionId":"${expected}"`));
    else assert.match(last, /"outcome":"cancelled"/);
  }
  assert.equal(h.approvals[0]?.request.kind, 'edit');
  assert.equal(h.approvals[0]?.request.canAlwaysAllow, true);
});

test('Devin native children keep sibling and parent transcripts isolated through success and failure', async (t) => {
  const h = await fixture(t);
  const session = await h.create();
  const background: NormalizedEvent[] = [];
  session.onBackgroundEvent((event) => {
    background.push(event);
  });
  const primary = await collect(session.stream('children'));
  assert.deepEqual(
    primary.flatMap((event) => event.transcript?.text ?? []),
    ['Parent result', 'Parent answer'],
  );
  assert.equal(
    primary.find((event) => event.transcript?.toolUseId === 'shared')?.transcript?.toolName,
    'Parent tool',
  );
  assert.deepEqual(
    background.flatMap((event) =>
      event.childSession ? [[event.childSession.providerSessionId, event.childSession.status]] : [],
    ),
    [
      ['child-a', 'running'],
      ['child-b', 'running'],
      ['child-b', 'failed'],
      ['child-a', 'completed'],
    ],
  );
  for (const id of ['child-a', 'child-b']) {
    const started = background.find(
      (event) => event.childSession?.providerSessionId === id,
    )?.childSession;
    assert.equal(started?.label, `Review ${id}`);
    assert.equal(started?.prompt, `Inspect ${id}`);
    assert.equal(started?.modelId, 'swe-child');
    assert.equal(started?.transcriptAvailable, true);
    const rows = background
      .filter((event) => event.childOwner?.id === id)
      .map((event) => event.transcript);
    assert.ok(
      rows.every(
        (row) =>
          row?.appSessionId === 'app-one' && row.sourceSessionId === id && row.role === 'worker',
      ),
    );
    assert.deepEqual(
      rows.filter((row) => row?.kind === 'text').map((row) => row?.text),
      [`Answer ${id}`, `Summary ${id}`],
    );
    assert.equal(rows.find((row) => row?.kind === 'thinking')?.text, `Think ${id}`);
    assert.equal(rows.find((row) => row?.kind === 'tool_call')?.toolName, 'shell');
    assert.deepEqual(rows.find((row) => row?.kind === 'tool_call')?.toolArgs, { command: id });
    const result = rows.find((row) => row?.kind === 'tool_result');
    assert.equal(result?.text, `Result ${id}`);
    assert.equal(result?.isError, id === 'child-b');
    const completed = background.find(
      (event) => event.childSession?.providerSessionId === id && event.childSession.done,
    )?.childSession;
    assert.equal(completed?.activity?.preview, `Summary ${id}`);
  }
  assert.ok(
    background
      .filter((event) => event.transcript)
      .every((event) => event.childOwner?.kind === 'provider-session'),
  );
  assert.ok(background.every((event) => !event.tokens));
});

test('Devin observes fresh and restored children between turns and rejects child output after close', async (t) => {
  const h = await fixture(t);
  for (const resume of [false, true]) {
    if (resume) await writeFile(join(h.cwd, 'replay-children'), '');
    const session = resume ? await h.provider.resume('devin-one', h.input) : await h.create();
    if (resume) {
      h.sessions.push(session);
      session.restoreChildren([
        {
          providerSessionId: 'background',
          role: 'worker',
          status: 'paused',
          modelId: 'old-model',
          transcriptAvailable: true,
        },
      ]);
    }
    const background: NormalizedEvent[] = [];
    session.onBackgroundEvent((event) => {
      background.push(event);
    });
    if (!resume) assert.deepEqual(await collect(session.stream('background')), [{ done: true }]);
    assert.deepEqual(
      background.flatMap((event) =>
        event.childSession
          ? [
              [
                event.childSession.providerSessionId,
                event.childSession.status,
                event.childSession.modelId,
              ],
            ]
          : [],
      ),
      [
        ['background', 'running', 'swe-child'],
        ...(resume ? [['untracked', 'running', 'swe-child']] : []),
      ],
    );
    await session.setModel({ modelId: 'finish-background' });
    assert.deepEqual(
      background.flatMap((event) => event.transcript?.text ?? []),
      ['Background answer', 'Summary background'],
    );
    assert.equal(background.at(-2)?.childSession?.status, 'completed');
    const count = background.length;
    await session.close();
    assert.equal(background.length, count);
    assert.equal(session.isClosed, true);
  }
});

test('Devin child approvals retain native context on the parent and reject unknown child permissions', async (t) => {
  const h = await fixture(t);
  const session = await h.create();
  await collect(session.stream('approve-child'));
  assert.equal(h.approvals[0]?.request.appSessionId, 'app-one');
  assert.equal(h.approvals[0]?.request.kind, 'edit');
  assert.deepEqual(h.approvals[0]?.request.raw, {
    toolCallId: 'edit',
    title: 'Edit file',
    kind: 'edit',
    rawInput: { path: '/file' },
    _meta: { 'cognition.ai/subagent_context': { parentAgentId: 'approval-child' } },
  });
  await collect(session.stream('approve-orphan'));
  await collect(session.stream('approve-completed'));
  assert.equal(h.approvals.length, 1);
  const responses = (await readFile(join(h.cwd, 'permission.json'), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.deepEqual(responses, [
    { outcome: { outcome: 'selected', optionId: 'once' } },
    { outcome: { outcome: 'cancelled' } },
    { outcome: { outcome: 'cancelled' } },
  ]);
});

test('closing Devin cancels a pending child approval before a late allow answer can reach the agent', async (t) => {
  const h = await fixture(t);
  const requested = deferred<ProviderApprovalRequest>();
  const answer = deferred<PermissionOutcome>();
  h.input.interactions.requestApproval = (request) => {
    requested.resolve(request);
    return answer.promise;
  };
  const session = await h.create();
  const background: NormalizedEvent[] = [];
  session.onBackgroundEvent((event) => {
    background.push(event);
  });
  const turn = collect(session.stream('approve-child'));
  const request = await requested.promise;
  assert.equal(request.signal?.aborted, false);
  const count = background.length;
  const closing = session.close();
  assert.equal(request.signal?.aborted, true);
  answer.resolve('proceed_once');
  await closing;
  await turn;
  assert.equal(background.length, count);
  assert.deepEqual(JSON.parse((await readFile(join(h.cwd, 'permission.json'), 'utf8')).trim()), {
    outcome: { outcome: 'cancelled' },
  });
});

test('a native child approval stays answerable after the Devin parent turn settles', async (t) => {
  const h = await fixture(t);
  const events: ServerEvent[] = [];
  const session = await h.create();
  const live: InteractionLiveSession = {
    summary: sessionSummary({ appSessionId: 'app-one', provider: 'devin' }),
    session,
  };
  const interactions = new SessionInteractions({
    getLiveSession: () => live,
    updateSummary: () => undefined,
    setProviderSpecMode: async () => undefined,
    emit: (event) => {
      events.push(event);
    },
    emitError: (error) => assert.fail(error.message),
  });
  h.input.interactions = interactions.interactionsFor({ id: 'app-one' });
  const finished = deferred();
  session.onBackgroundEvent((event) => {
    if (event.childSession?.done) finished.resolve();
  });
  await collect(session.stream('approve-background'));
  const requested = events.find((event) => event.type === 'approval.requested');
  assert.ok(requested?.type === 'approval.requested');
  assert.equal(
    events.some((event) => event.type === 'interaction.cancelled'),
    false,
  );
  await interactions.respondToApproval('app-one', requested.request.requestId, 'proceed_once');
  await finished.promise;
  assert.deepEqual(JSON.parse((await readFile(join(h.cwd, 'permission.json'), 'utf8')).trim()), {
    outcome: { outcome: 'selected', optionId: 'once' },
  });
});

test('Devin cancellation settles a turn and the session remains usable', async (t) => {
  const h = await fixture(t);
  const session = await h.create();
  const stream = session.stream('wait');
  assert.equal((await stream.next()).value?.transcript?.text, 'waiting');
  await session.interrupt();
  const cancelled = await collect(stream);
  assert.equal(cancelled[0]?.transcript?.kind, 'status');
  assert.match(cancelled[0]?.transcript?.text ?? '', /interrupted/i);
  assert.deepEqual(cancelled.at(-1), { done: true });
  assert.deepEqual(await collect(session.stream('empty')), [{ done: true }]);
  await Promise.all([session.close(), session.close()]);
  assert.equal(session.isClosed, true);
  assert.equal(session.process?.isAlive(), false);
  assert.equal(await session.closed, undefined);
});

test('Devin Stop during a pending config change does not send the queued prompt', async (t) => {
  const h = await fixture(t);
  const session = await h.create();
  const change = session.setModel({ modelId: 'blocked' });
  const result = collect(session.stream('must not run'));
  await Promise.resolve();
  await session.interrupt();
  await change;
  assert.deepEqual((await result).at(-1), { done: true });
  assert.equal(
    (await h.requests()).some((request) => request.method === 'session/prompt'),
    false,
  );
  assert.deepEqual(await collect(session.stream('empty')), [{ done: true }]);
});

test('Devin refuses a turn explicitly and surfaces stderr on process exit', async (t) => {
  const h = await fixture(t);
  const session = await h.create();
  await assert.rejects(collect(session.stream('refuse')), /Devin refused/);
  await assert.rejects(collect(session.stream('exit')), /backend failed/);
  assert.ok(await session.closed);
  await assert.rejects(collect(session.stream('empty')), /closed/);
});

test('Devin probe reports auth, models and defaults and deletes its provisional session', async (t) => {
  const h = await fixture(t);
  await writeFile(join(h.cwd, 'signed-out'), '');
  const signedOut = await h.provider.probe(new AbortController().signal);
  assert.equal(signedOut.readiness, 'unauthenticated');
  assert.match(signedOut.message ?? '', /devin auth login/);
  await rm(join(h.cwd, 'signed-out'));
  const ready = await h.provider.probe(new AbortController().signal);
  assert.equal(ready.readiness, 'ready');
  assert.equal(ready.version, '3000.14.30821');
  assert.equal(ready.defaultModelId, 'swe-fast');
  assert.ok(ready.models.every((model) => model.supportsFastMode === false));
  assert.deepEqual(
    ready.models.map((model) => [model.id, model.isDefault]),
    [
      ['swe-fast', true],
      ['swe', false],
    ],
  );
  assert.ok((await h.requests()).some((request) => request.method === 'session/delete'));
  await writeFile(join(h.cwd, 'empty-models'), '');
  const empty = await h.provider.probe(new AbortController().signal);
  assert.equal(empty.readiness, 'ready');
  assert.deepEqual(empty.models, []);
  assert.equal(empty.defaultModelId, 'swe-fast');
  const aborted = AbortSignal.abort();
  assert.equal((await h.provider.probe(aborted)).readiness, 'error');
  assert.equal((await h.provider.readUsage()).unavailable, 'no_plan_limits');
  await assert.rejects(h.provider.fork(), /cannot be copied/);
});

test('Devin forwards configured MCP transports and serves in-app tools for its lifetime', async (t) => {
  const h = await fixture(t);
  const app = createSdkMcpServer({
    name: 'app',
    tools: [{ name: 'echo', handler: () => 'APP_TOOL_RESULT' }],
  });
  const session = await h.provider.create({
    ...h.input,
    inAppMcpServers: [app],
    mcpServers: [
      {
        name: 'stdio',
        command: 'example',
        args: ['serve'],
        env: { EXAMPLE: 'yes' },
      },
    ],
  });
  h.sessions.push(session);
  await collect(session.stream('mcp'));
  assert.match(await readFile(join(h.cwd, 'mcp-result'), 'utf8'), /APP_TOOL_RESULT/);
  const configured = (await h.requests()).find((request) => request.method === 'session/new')
    ?.params?.mcpServers;
  assert.ok(Array.isArray(configured));
  assert.deepEqual(configured[0], {
    name: 'stdio',
    command: 'example',
    args: ['serve'],
    env: [{ name: 'EXAMPLE', value: 'yes' }],
  });
  const url = app.config && 'url' in app.config ? app.config.url : undefined;
  assert.ok(url);
  await session.close();
  await assert.rejects(fetch(url), /fetch failed/);
});
