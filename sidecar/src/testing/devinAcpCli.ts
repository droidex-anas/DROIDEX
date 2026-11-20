export const devinAcpCli = String.raw`#!/usr/bin/env node
const { appendFileSync, existsSync, readFileSync, watch } = require('node:fs');
const { createInterface } = require('node:readline');
const { join } = require('node:path');
const root = __dirname;
if (process.argv[2] === '--version') { console.log('devin 3000.14.30821 (fake)'); process.exit(0); }
if (process.argv[2] === 'auth') {
  console.log(existsSync(join(root, 'signed-out')) ? 'Not logged in.' : 'Logged in.'); process.exit(0);
}
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
const result = (id, result) => send({ id, result });
let sessionId = 'devin-one';
const update = (update) => send({ method: 'session/update', params: { sessionId, update } });
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
      _meta: { 'cognition.ai/persistOnCreate': true },
      sessionCapabilities: { close: {}, delete: {}, ...(existsSync(join(root, 'native-fork')) ? { fork: {} } : {}) } } });
  } else if (method === 'session/fork') {
    sessionId = 'devin-native-copy';
    result(id, { sessionId });
  } else if (method === 'session/new' || method === 'session/load') {
    if (method === 'session/load') sessionId = params.sessionId;
    servers = params.mcpServers;
    update({ sessionUpdate: 'config_option_update', configOptions });
    if (method === 'session/load') {
      update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'REPLAY' } });
      if (existsSync(join(root, 'usage.json')))
        for (const event of JSON.parse(readFileSync(join(root, 'usage.json'), 'utf8'))) update(event);
      if (existsSync(join(root, 'replay-children'))) {
        childStarted('background'); childText('background', 'Replayed child answer');
        childStarted('finished'); childCompleted('finished');
        childStarted('untracked');
      }
    }
    result(id, { sessionId });
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
    if (text === 'usage') {
      for (const event of JSON.parse(readFileSync(join(root, 'usage.json'), 'utf8'))) update(event);
      result(id, { stopReason: 'end_turn' }); return;
    }
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
        childUpdate(agentId, { sessionUpdate: 'usage_update', used: 999, size: 1000,
          _meta: { 'cognition.ai/inputTokens': 900, 'cognition.ai/outputTokens': 99 } });
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
    if (text.startsWith('terminal-redirected-')) {
      const pidFile = join(root, 'redirected-pid');
      const ready = new Promise((resolve) => {
        const watcher = watch(root, () => {
          if (!existsSync(pidFile)) return;
          watcher.close(); resolve(Number(readFileSync(pidFile, 'utf8')));
        });
      });
      const script = 'const fs = require("fs"); const root = ' + JSON.stringify(root) + '; const watcher = fs.watch(root, () => { if (!fs.existsSync(root)) watcher.close(); }); fs.writeFileSync(' + JSON.stringify(pidFile + '.tmp') + ', String(process.pid)); fs.renameSync(' + JSON.stringify(pidFile + '.tmp') + ', ' + JSON.stringify(pidFile) + ');';
      const { terminalId } = await terminalCall('create', {
        command: JSON.stringify(process.execPath) + ' -e ' + JSON.stringify(script) + ' >/dev/null 2>&1 &',
      });
      await terminalCall('wait_for_exit', { terminalId });
      const pid = await ready;
      if (text === 'terminal-redirected-release') {
        await terminalCall('release', { terminalId });
        await terminalCall('release', { terminalId });
        result(id, { stopReason: 'end_turn' });
      } else {
        update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'REDIRECTED:' + pid } });
        if (text === 'terminal-redirected-interrupt') result(id, { stopReason: 'end_turn' });
        else pending = id;
      }
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
