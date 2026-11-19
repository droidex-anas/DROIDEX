import assert from 'node:assert/strict';
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
import { tolerantCommandRunner } from '../../processes/processTree.js';
import { DevinProvider } from './DevinProvider.js';
import type { DevinSession } from './devinSession.js';
import { devinAcpCli } from '../../testing/devinAcpCli.js';

async function fixture(t: TestContext) {
  const cwd = await mkdtemp(join(tmpdir(), 'devin-provider-'));
  const executable = join(cwd, 'devin.cjs');
  await writeFile(executable, devinAcpCli, { mode: 0o755 });
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
      const status = await tolerantCommandRunner('ps', ['-o', 'stat=', '-p', String(pid)]);
      assert.match(status.trim(), /^(?:Z.*)?$/);
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

test('Devin cleans redirected background jobs after their shell and output pipes close', async (t) => {
  for (const action of ['release', 'interrupt', 'close'] as const) {
    await t.test(action, async (t) => {
      const h = await fixture(t);
      const session = await h.create();
      const stream = session.stream('terminal-redirected-' + action)[Symbol.asyncIterator]();
      if (action !== 'release') {
        const next = await stream.next();
        assert.match(next.value?.transcript?.text ?? '', /^REDIRECTED:\d+$/);
        if (action === 'interrupt') await collect({ [Symbol.asyncIterator]: () => stream });
        const roots: number[][] = [];
        const unsubscribe = session.onProcessRootsChanged((live) => {
          roots.push(live.map((root) => root.pid));
        });
        assert.equal(roots[0]?.length, 1);
        assert.notEqual(roots[0]?.[0], session.process?.pid);
        await session[action]();
        assert.deepEqual(roots.at(-1), []);
        unsubscribe();
      }
      await collect({ [Symbol.asyncIterator]: () => stream });
      const pid = Number(await readFile(join(h.cwd, 'redirected-pid'), 'utf8'));
      const status = await tolerantCommandRunner('ps', ['-o', 'stat=', '-p', String(pid)]);
      assert.match(status.trim(), /^(?:Z.*)?$/);
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
