import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { ClientCommand, ServerEvent, SessionSummary, TranscriptEvent } from '../protocol.js';
import { RemoteHost } from './host.js';
import { RemoteSessionIndex } from './sessionIndex.js';
import { remoteModels } from './sessionProjection.js';
import type { RemoteRuntime } from './types.js';

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const summary = (title: string, updatedAt: number, cwd = '/project'): SessionSummary => ({
  appSessionId: randomUUID(), providerSessionId: randomUUID(), title, cwd, updatedAt, createdAt: updatedAt,
  modelId: 'model', reasoningEffort: 'high', interactionMode: 'auto', autonomy: 'off',
  sessionPurpose: 'chat', role: 'user', goal: title, phase: 'completed', streaming: false,
  features: [], tokensIn: 0, tokensOut: 0, contextTokens: 0,
});
const transcript = (row: SessionSummary, text: string, author?: 'user'): TranscriptEvent => ({
  id: randomUUID(), appSessionId: row.appSessionId, sourceSessionId: row.appSessionId,
  role: 'primary', kind: 'text', text, author, ts: row.updatedAt + 1,
});

function setup(rows: SessionSummary[]) {
  const index = new RemoteSessionIndex();
  index.observe({ type: 'sessions.list', sessions: rows, earlierSessionsByCwd: {} });
  const commands: ClientCommand[] = [];
  const announced: { id: string; requestId: string; prompt: string }[] = [];
  let callback: (command: ClientCommand) => Promise<void> = async () => {};
  const runtime: RemoteRuntime = {
    async handle(command) { commands.push(command); await callback(command); },
    announcePrompt(id, requestId, prompt) { announced.push({ id, requestId, prompt }); },
  };
  let diffReads = 0;
  const host = new RemoteHost('/project', runtime, () => {}, async () => {
    diffReads += 1;
    return { changes: [], note: 'Working tree' };
  }, index);
  host.observe({ type: 'catalog.updated', catalog: 'models', items: [{ id: 'model', displayName: 'Installed', supportedReasoningEfforts: ['high'] }] });
  return { host, index, commands, announced, setHandler(value: typeof callback) { callback = value; }, diffReads: () => diffReads };
}

test('imports only the newest five scoped sessions; existing runtimes survive revocation', async () => {
  const rows = Array.from({ length: 8 }, (_, i) => summary(`Session ${i}`, i));
  const state = setup([...rows, summary('Private other project', 999, '/other')]);
  assert.deepEqual(state.host.snapshot().map((row) => row.title), ['Session 7', 'Session 6', 'Session 5', 'Session 4', 'Session 3']);
  assert.equal(state.commands.length, 0);
  assert.ok(state.host.snapshot().every((row) => row.historyState === 'unloaded' && row.phase === 'completed'));
  await state.host.close();
  assert.equal(state.commands.filter((command) => command.type === 'session.close').length, 0);
});

test('an existing-session follow-up announces once before sending to the original desktop identity', async () => {
  let row = summary('Existing', 1);
  const state = setup([row]);
  state.host.observe({ type: 'session.created', clientRef: 'desktop', session: row });
  state.setHandler(async (command) => {
    if (command.type === 'session.updateSettings') {
      row = { ...row, modelId: command.modelId || undefined, reasoningEffort: command.reasoningEffort };
      state.host.observe({ type: 'session.updated', session: row });
    }
    if (command.type === 'session.send') {
      assert.equal(state.announced.length, 1);
      state.host.observe({ type: 'session.updated', session: { ...row, phase: 'running', streaming: true } });
      state.host.observe({ type: 'event.appended', event: transcript(row, command.text, 'user') });
      state.host.observe({ type: 'event.appended', event: transcript(row, 'Real output') });
      state.host.observe({ type: 'session.updated', session: { ...row, streaming: false } });
    }
  });
  const id = state.host.snapshot()[0]!.id;
  const request = { id, requestId: randomUUID(), prompt: 'Continue', modelId: 'model', effort: 'high', mode: 'auto' };
  state.host.turn(request); state.host.turn(request); await tick();
  assert.equal(state.commands.filter((command) => command.type === 'session.create').length, 0);
  assert.deepEqual(state.announced, [{ id: row.appSessionId, requestId: request.requestId, prompt: 'Continue' }]);
  assert.equal(state.commands.find((command) => command.type === 'session.send')?.appSessionId, row.appSessionId);
  assert.deepEqual(state.host.snapshot()[0]!.messages.map((message) => message.text), ['Continue', 'Real output']);
  assert.equal(state.host.snapshot()[0]?.lastRequestId, request.requestId);
  assert.equal(state.diffReads(), 1);
  await state.host.close();
});

test('live transcript arriving during a history read cannot be replaced by the old page', async () => {
  const row = summary('Existing', 1);
  const state = setup([row]);
  state.setHandler(async (command) => {
    if (command.type !== 'session.loadHistory') return;
    state.host.observe({ type: 'session.updated', session: { ...row, phase: 'running', streaming: true } });
    state.host.observe({ type: 'event.appended', event: transcript(row, 'New live result') });
    state.host.observe({ type: 'session.history', appSessionId: row.appSessionId, progress: [], transcripts: [transcript(row, 'Old page')], mode: 'replace' });
  });
  await state.host.loadHistory(state.host.snapshot()[0]!.id);
  assert.equal(state.host.snapshot()[0]!.messages.at(-1)?.text, 'New live result');
  assert.equal(state.host.snapshot()[0]!.historyState, 'live');
  assert.equal(state.host.snapshot()[0]!.phase, 'running');
  await state.host.close();
});

test('pending desktop permissions are restored and a stale completion cannot clear a newer request', async () => {
  const row = { ...summary('Existing', 1), streaming: true, phase: 'running' as const };
  const state = setup([row]);
  const permission = (requestId: string): ServerEvent => ({ type: 'approval.requested', request: {
    appSessionId: row.appSessionId, requestId, kind: 'exec', title: 'Run?', detail: requestId, raw: {},
  } });
  state.host.observe(permission('first'));
  const id = state.host.snapshot()[0]!.id;
  const approval = state.host.snapshot()[0]!.approval!;
  let release!: () => void;
  state.setHandler(async (command) => { if (command.type === 'approval.respond') await new Promise<void>((resolve) => { release = resolve; }); });
  const pending = state.host.approve(id, { id: approval.id, allow: true });
  await assert.rejects(state.host.approve(id, { id: approval.id, allow: true }), /no longer pending|already/);
  state.host.observe(permission('second'));
  release(); await pending;
  assert.equal(state.host.snapshot()[0]!.approval?.detail, 'second');
  assert.equal(state.host.snapshot()[0]!.phase, 'approval');
  state.host.commandCompleted({ type: 'approval.respond', appSessionId: row.appSessionId, requestId: 'second', outcome: 'cancel' });
  assert.equal(state.host.snapshot()[0]!.approval, undefined);
  assert.equal(state.host.snapshot()[0]!.phase, 'running');
  await state.host.close();
});

test('moving a session outside the shared project revokes phone operations without closing it', async () => {
  const row = summary('Existing', 1);
  const state = setup([row]);
  const id = state.host.snapshot()[0]!.id;
  state.host.observe({ type: 'session.updated', session: { ...row, cwd: '/private' } });
  assert.deepEqual(state.host.snapshot(), []);
  await assert.rejects(state.host.loadHistory(id), /not found/);
  assert.throws(() => state.host.turn({ id, requestId: randomUUID(), prompt: 'Read', modelId: 'model', effort: 'high', mode: 'auto' }), /outside/);
  await state.host.close();
  assert.deepEqual(state.commands, []);
});

test('desktop-origin turns remain live after a stopped turn and refresh diffs on each completion', async () => {
  const row = summary('Existing', 1);
  const state = setup([row]);
  const id = state.host.snapshot()[0]!.id;
  await state.host.interrupt(id);
  state.host.observe({ type: 'session.updated', session: { ...row, phase: 'running', streaming: true } });
  state.host.observe({ type: 'event.appended', event: transcript(row, 'Desktop resumed') });
  state.host.observe({ type: 'session.updated', session: row });
  await tick();
  const firstRun = state.host.snapshot()[0]!.runId;
  assert.equal(state.host.snapshot()[0]!.messages.at(-1)?.text, 'Desktop resumed');
  assert.equal(state.diffReads(), 1);
  state.host.observe({ type: 'session.updated', session: { ...row, phase: 'running', streaming: true } });
  state.host.observe({ type: 'session.updated', session: row }); await tick();
  assert.notEqual(state.host.snapshot()[0]!.runId, firstRun);
  assert.equal(state.diffReads(), 2);
  await state.host.close();
});

test('model capabilities are exact; absent, invalid or duplicate effort levels are not manufactured', () => {
  assert.deepEqual(remoteModels([
    { id: 'a', displayName: 'A', supportedReasoningEfforts: ['low', 'xhigh', 'xhigh', 'ultra'], defaultReasoningEffort: 'ultra' },
    { id: 'b', displayName: 'B', isDefault: true },
  ]), [{ id: 'a', name: 'A', efforts: ['low', 'xhigh'] }, { id: 'b', name: 'B', efforts: [], isDefault: true }]);
});


test('desktop sends are mirrored on the phone without feeding a second command back to the runtime', async () => {
  const row = summary('Existing', 1);
  const state = setup([row]);
  state.host.commandReceived({ type: 'session.send', appSessionId: row.appSessionId, text: 'From the computer' });
  state.host.observe({ type: 'event.appended', event: transcript(row, 'Assistant response') });
  assert.deepEqual(state.host.snapshot()[0]!.messages.map((message) => [message.role, message.text]), [
    ['user', 'From the computer'], ['assistant', 'Assistant response'],
  ]);
  assert.deepEqual(state.commands, []);
  assert.deepEqual(state.announced, []);
  await state.host.close();
});


test('a filtered desktop list does not revoke an existing shared session', async () => {
  const row = summary('Shared conversation', 1);
  const state = setup([row]);
  const id = state.host.snapshot()[0]!.id;
  state.host.observe({ type: 'sessions.list', sessions: [summary('Other project', 2, '/other')], earlierSessionsByCwd: {} });
  assert.equal(state.index.summary(row.appSessionId)?.title, row.title);
  assert.doesNotThrow(() => state.host.turn({ id, requestId: randomUUID(), prompt: 'Continue', modelId: 'model', effort: 'high', mode: 'auto' }));
  await tick();
  assert.ok(state.commands.some((command) => command.type === 'session.resume' && command.appSessionId === row.appSessionId));
  await state.host.close();
});


test('spec approvals retain the real plan kind and body, then reflect desktop mode transition', async () => {
  const row = { ...summary('Plan', 1), interactionMode: 'spec' as const, streaming: true, phase: 'running' as const };
  const state = setup([row]);
  state.host.observe({ type: 'approval.requested', request: { appSessionId: row.appSessionId, requestId: 'plan-1', kind: 'spec',
    title: 'Implement this plan?', detail: 'Plan summary', plan: '# Plan\n- Change one file', raw: {} } });
  const current = state.host.snapshot()[0]!;
  assert.equal(current.approval?.kind, 'spec');
  assert.equal(current.approval?.detail, '# Plan\n- Change one file');
  state.setHandler(async (command) => {
    if (command.type === 'approval.respond') {
      assert.equal(command.outcome, 'proceed_once');
      state.host.observe({ type: 'session.updated', session: { ...row, interactionMode: 'auto' } });
    }
  });
  await state.host.approve(current.id, { id: current.approval!.id, allow: true });
  assert.equal(state.host.snapshot()[0]?.mode, 'auto');
  assert.equal(state.host.snapshot()[0]?.phase, 'running');
  await state.host.close();
});
