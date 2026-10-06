import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { DroidStreamEvent } from '@factory/droid-sdk';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

import { SessionEventFlow } from '../SessionEventFlow.js';
import { parseFullSessionTranscript } from '../sessionTranscript.js';
import { readSessionSearchSlice } from '../sessionSearch.js';
import { transcriptToMarkdown } from '../sessionMarkdown.js';
import { normalizeStreamEvent, type NormalizedEvent } from '../normalize.js';
import type { SessionSummary, TranscriptEvent } from '../protocol.js';
import { ProviderTranscriptFile } from '../providers/ProviderTranscriptFile.js';
import { ClaudeEventMapper } from '../providers/claude/claudeEvents.js';
import { CodexEventMapper } from '../providers/codex/codexEvents.js';
import { runPrimaryTurn, type PrimaryTurnDependencies } from '../providers/primaryTurn.js';
import type { LiveSession } from '../SessionLifecycle.js';
import { CanvasToolPresentation, canvasToolProvenance } from './canvasToolPresentation.js';

const CANARY = 'CANVAS_INTERNAL_GUIDANCE_7E4B';
const TOOL = 'mcp__droidex-canvas__canvas_write';
const DROID_TOOL = 'droidex-canvas___canvas_write';
const USER_TEXT = 'Update the card design.';

function event(
  kind: 'tool_call' | 'tool_result',
  extra: Partial<TranscriptEvent>,
): TranscriptEvent {
  return {
    id: kind,
    appSessionId: 'app',
    sourceSessionId: 'app',
    role: 'primary',
    ts: 1,
    kind,
    toolUseId: 'call-1',
    ...extra,
  };
}

test('only the reserved server and correlated call are projected', () => {
  const projector = new CanvasToolPresentation();
  const unrelated = event('tool_call', { toolName: 'Bash', toolArgs: { text: CANARY } });
  assert.equal(projector.project(unrelated), unrelated);
  assert.equal(canvasToolProvenance('mcp__other__canvas_write', 'call-1'), undefined);
  const uncorrelated = projector.project(
    event('tool_call', { toolName: TOOL, toolUseId: undefined, toolArgs: { source: CANARY } }),
  );
  assert.equal(uncorrelated.kind, 'error');
  assert.ok(!JSON.stringify(uncorrelated).includes(CANARY));

  const call = projector.project(
    event('tool_call', {
      toolName: TOOL,
      toolArgs: { designId: 'design-1', files: { 'src/a.tsx': CANARY } },
    }),
    canvasToolProvenance(TOOL, 'call-1'),
  );
  const result = projector.project(
    event('tool_result', { text: `Tool failed: ${CANARY}`, isError: true }),
  );
  const stopped = projector.project(event('tool_result', { text: CANARY, interrupted: true }));
  assert.deepEqual(call.canvasActivity, {
    toolUseId: 'call-1',
    action: 'write',
    designIds: ['design-1'],
    state: 'running',
    message: 'Updating design',
  });
  assert.equal(call.toolArgs, undefined);
  assert.equal(result.canvasActivity?.state, 'failed');
  assert.equal(stopped.canvasActivity?.state, 'failed');
  assert.ok(!JSON.stringify([call, result, stopped]).includes(CANARY));
  const user = {
    ...event('tool_result', { text: CANARY }),
    kind: 'text' as const,
    author: 'user' as const,
  };
  assert.equal(projector.project(user).text, CANARY);
  const childResult = {
    ...event('tool_result', { text: CANARY }),
    sourceSessionId: 'child-1',
    role: 'worker' as const,
  };
  assert.equal(projector.project(childResult).text, CANARY);
  const reusedId = event('tool_call', { toolName: 'Bash', toolArgs: { command: CANARY } });
  assert.equal(projector.project(reusedId), reusedId);
  assert.equal(projector.project(event('tool_result', { text: CANARY })).text, CANARY);

  const readName = 'mcp__droidex-canvas__canvas_read';
  const read = projector.project(
    event('tool_call', { toolName: readName, toolUseId: 'read-1', toolArgs: { source: CANARY } }),
    canvasToolProvenance(readName, 'read-1'),
  );
  assert.equal(read.canvasActivity?.action, 'inspect');

  const createName = 'mcp__droidex-canvas__canvas_create';
  projector.project(
    event('tool_call', {
      toolName: createName,
      toolUseId: 'create-1',
      toolArgs: { source: CANARY },
    }),
    canvasToolProvenance(createName, 'create-1'),
  );
  const created = projector.project(
    event('tool_result', {
      toolUseId: 'create-1',
      text: JSON.stringify({ frames: [{ designId: 'design-2', name: 'Hey', source: CANARY }] }),
    }),
  );
  assert.deepEqual(created.canvasActivity?.designIds, ['design-2']);
  assert.equal(created.canvasActivity?.message, 'Created Hey');
  assert.ok(!JSON.stringify(created).includes(CANARY));
});

function summary(appSessionId: string, provider: SessionSummary['provider']): SessionSummary {
  return {
    appSessionId,
    providerSessionId: appSessionId,
    provider,
    sessionPurpose: 'chat',
    interactionMode: 'auto',
    role: 'primary',
    title: 'Canvas canary',
    goal: '',
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
}

function droidEvents(appSessionId: string): NormalizedEvent[] {
  const raw: DroidStreamEvent[] = [
    {
      type: 'tool_call_delta',
      toolUse: {
        type: 'tool_use',
        id: 'call-1',
        input: { designId: 'design-1', files: { 'src/a.tsx': CANARY } },
      },
    },
    {
      type: 'tool_call_delta',
      toolUse: {
        type: 'tool_use',
        id: 'call-1',
        name: DROID_TOOL,
        input: { designId: 'design-1', files: { 'src/a.tsx': CANARY } },
      },
    },
    {
      type: 'tool_call',
      toolUse: {
        type: 'tool_use',
        id: 'call-1',
        name: DROID_TOOL,
        input: { designId: 'design-1', files: { 'src/a.tsx': CANARY } },
      },
    },
    {
      type: 'tool_result',
      toolName: DROID_TOOL,
      toolUseId: 'call-1',
      content: JSON.stringify({ designId: 'design-1', revisionId: 'rev-1', source: CANARY }),
      isError: false,
    },
    {
      type: 'tool_call',
      toolUse: {
        type: 'tool_use',
        id: 'call-2',
        name: DROID_TOOL,
        input: { designId: 'design-1', files: { 'src/a.tsx': CANARY } },
      },
    },
    {
      type: 'tool_result',
      toolName: DROID_TOOL,
      toolUseId: 'call-2',
      content: `Tool error: ${CANARY}`,
      isError: true,
    },
    { type: 'error', toolUseId: 'call-2', message: `Tool error: ${CANARY}` },
    {
      type: 'tool_call_delta',
      toolUse: { type: 'tool_use', id: 'bash-1', input: { command: 'ls' } },
    },
    {
      type: 'tool_call',
      toolUse: { type: 'tool_use', id: 'bash-1', name: 'Bash', input: { command: 'ls' } },
    },
  ] as DroidStreamEvent[];
  return raw.flatMap((item) => {
    const mapped = normalizeStreamEvent(appSessionId, appSessionId, 'primary', item);
    return mapped ? [mapped] : [];
  });
}

function claudeEvents(appSessionId: string): NormalizedEvent[] {
  const mapper = new ClaudeEventMapper(appSessionId);
  const message = (value: unknown) => value as SDKMessage;
  const stream = (event: unknown) =>
    message({ type: 'stream_event', event, parent_tool_use_id: null });
  const messages = [
    stream({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'call-1', name: TOOL },
    }),
    stream({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '{"designId":"design-1","files":{' },
    }),
    stream({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: `"src/a.tsx":"${CANARY}"}}` },
    }),
    stream({ type: 'content_block_stop', index: 0 }),
    message({
      type: 'user',
      parent_tool_use_id: null,
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'call-1',
            content: JSON.stringify({ designId: 'design-1', source: CANARY }),
            is_error: false,
          },
        ],
      },
    }),
    message({
      type: 'assistant',
      parent_tool_use_id: null,
      error: `Tool error: ${CANARY}`,
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'call-2',
            name: TOOL,
            input: { designId: 'design-1', files: { 'src/a.tsx': CANARY } },
          },
        ],
      },
    }),
    message({
      type: 'user',
      parent_tool_use_id: null,
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'call-2',
            content: `Tool error: ${CANARY}`,
            is_error: true,
          },
        ],
      },
    }),
  ];
  return messages.flatMap((entry) => mapper.map(entry));
}

function codexEvents(appSessionId: string): NormalizedEvent[] {
  const mapper = new CodexEventMapper(appSessionId);
  const item = (id: string, status: string, content: string) => ({
    type: 'dynamicToolCall',
    id,
    namespace: 'droidex_canvas',
    tool: 'canvas_write',
    status,
    arguments: { designId: 'design-1', files: { 'src/a.tsx': CANARY } },
    contentItems: [{ type: 'inputText', text: content }],
    success: status === 'completed',
  });
  return [
    ...mapper.map('item/started', { item: item('call-1', 'inProgress', '') }),
    ...mapper.map('item/completed', {
      item: item('call-1', 'completed', JSON.stringify({ designId: 'design-1', source: CANARY })),
    }),
    ...mapper.map('item/started', { item: item('call-2', 'inProgress', '') }),
    ...mapper.map('item/completed', { item: item('call-2', 'failed', `Tool error: ${CANARY}`) }),
    ...mapper.map('item/started', { item: item('call-3', 'inProgress', '') }),
    ...mapper.map('item/completed', { item: item('call-3', 'interrupted', CANARY) }),
  ];
}

function nativeDroidFile(path: string): void {
  const line = (id: string, role: string, content: unknown[]) =>
    JSON.stringify({
      type: 'message',
      id,
      timestamp: new Date(1_000).toISOString(),
      message: { role, content },
    });
  writeFileSync(
    path,
    [
      line('prompt', 'user', [{ type: 'text', text: USER_TEXT }]),
      line('call', 'assistant', [
        {
          type: 'tool_use',
          id: 'call-1',
          name: DROID_TOOL,
          input: { designId: 'design-1', files: { 'src/a.tsx': CANARY } },
        },
      ]),
      line('result', 'user', [
        {
          type: 'tool_result',
          tool_use_id: 'call-1',
          content: JSON.stringify({ designId: 'design-1', source: CANARY }),
        },
      ]),
      line('failure', 'assistant', [
        {
          type: 'tool_use',
          id: 'call-2',
          name: DROID_TOOL,
          input: { designId: 'design-1', files: { 'src/a.tsx': CANARY } },
        },
      ]),
      line('error', 'user', [
        {
          type: 'tool_result',
          tool_use_id: 'call-2',
          content: `Tool error: ${CANARY}`,
          is_error: true,
        },
      ]),
    ].join('\n') + '\n',
  );
}

test('Droid, Claude and Codex keep Canvas tool traffic out of live, replay, search and export', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'canvas-projection-'));
  const previous = process.env.DROIDEX_USER_DATA_DIR;
  process.env.DROIDEX_USER_DATA_DIR = directory;
  t.after(() => {
    if (previous === undefined) delete process.env.DROIDEX_USER_DATA_DIR;
    else process.env.DROIDEX_USER_DATA_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  });

  for (const provider of ['droid', 'claude', 'codex'] as const) {
    const appSessionId = `canvas-${provider}`;
    const file =
      provider === 'droid'
        ? undefined
        : new ProviderTranscriptFile(appSessionId, () => summary(appSessionId, provider));
    const live: TranscriptEvent[] = [];
    const flow = new SessionEventFlow({
      appendTranscript: (entry) => {
        live.push(entry);
        file?.append(entry);
      },
      flushTranscript: () => undefined,
      applySideEffects: () => undefined,
      resolveChildScope: () => undefined,
      recordUsage: () => undefined,
    });
    const normalized =
      provider === 'droid'
        ? droidEvents(appSessionId)
        : provider === 'claude'
          ? claudeEvents(appSessionId)
          : codexEvents(appSessionId);
    const modelToolResult =
      normalized.find((entry) => entry.transcript?.kind === 'tool_result')?.transcript?.text ?? '';
    assert.ok(modelToolResult.includes(CANARY));
    const providerPrompts: string[] = [];
    const liveSession = {
      summary: summary(appSessionId, provider),
      session: {
        stream: async function* (prompt: string) {
          providerPrompts.push(prompt);
          for (const entry of normalized) yield entry;
        },
      },
    } as unknown as LiveSession;
    const dependencies: PrimaryTurnDependencies = {
      eventFlow: flow,
      context: {
        beginTurn: () => undefined,
        startPolling: () => undefined,
        stopPolling: () => undefined,
        refresh: () => Promise.resolve(),
      },
      timeline: {
        recordPrompt: () => file?.appendPrompt(USER_TEXT),
        announcePrompt: () => file?.appendPrompt(USER_TEXT),
        settleStreaming: () => file?.flush() ?? Promise.resolve(),
        appendStatus: () => undefined,
        appendError: () => undefined,
      },
      contextTarget: () => undefined,
      isCurrent: () => true,
      applyDesignToolPolicy: () => Promise.resolve(true),
      updateSummary: () => undefined,
      emitError: () => undefined,
    };
    await runPrimaryTurn(dependencies, liveSession, { prompt: USER_TEXT });
    assert.deepEqual(providerPrompts, [USER_TEXT]);
    assert.ok(!JSON.stringify(live).includes(CANARY), `${provider} live transcript leaked`);
    assert.ok(live.some((entry) => entry.canvasActivity?.state === 'failed'));
    if (provider === 'droid')
      assert.ok(
        live.some(
          (entry) => entry.toolName === 'Bash' && JSON.stringify(entry.toolArgs).includes('ls'),
        ),
      );
    if (provider === 'codex')
      assert.ok(
        live.some((entry) => entry.interrupted && entry.canvasActivity?.state === 'failed'),
      );

    const path = file?.path ?? join(directory, `${appSessionId}.jsonl`);
    if (!file) nativeDroidFile(path);
    const replayed = parseFullSessionTranscript(appSessionId, appSessionId, path, 'primary');
    assert.ok(!JSON.stringify(replayed).includes(CANARY), `${provider} replay leaked`);
    assert.ok(replayed.some((entry) => entry.canvasActivity?.action === 'write'));
    if (provider === 'droid')
      assert.ok(replayed.some((entry) => entry.canvasActivity?.message.includes('rev-1')));
    if (provider === 'codex')
      assert.ok(
        replayed.some((entry) => entry.interrupted && entry.canvasActivity?.state === 'failed'),
      );
    const searchable = await readSessionSearchSlice(
      { appSessionId, providerSessionId: appSessionId, path, sizeBytes: statSync(path).size },
      0,
    );
    assert.ok(!JSON.stringify(searchable.records).includes(CANARY), `${provider} search leaked`);
    const exported = transcriptToMarkdown(replayed, {
      title: 'Canvas canary',
      providerSessionId: appSessionId,
    });
    assert.ok(!exported.includes(CANARY), `${provider} export leaked`);
    assert.ok(exported.includes('Canvas'));
  }

  const userPath = join(directory, 'user-authored.jsonl');
  writeFileSync(
    userPath,
    JSON.stringify({
      type: 'message',
      id: 'user',
      timestamp: new Date(1_000).toISOString(),
      message: { role: 'user', content: [{ type: 'text', text: `Please show ${CANARY}` }] },
    }) + '\n',
  );
  const authored = parseFullSessionTranscript(
    'user-authored',
    'user-authored',
    userPath,
    'primary',
  );
  assert.ok(authored[0]?.text?.includes(CANARY));
  const userSearch = await readSessionSearchSlice(
    {
      appSessionId: 'user-authored',
      providerSessionId: 'user-authored',
      path: userPath,
      sizeBytes: statSync(userPath).size,
    },
    0,
  );
  assert.ok(userSearch.records[0]?.text.includes(CANARY));
  assert.ok(
    transcriptToMarkdown(authored, {
      title: 'User text',
      providerSessionId: 'user-authored',
    }).includes(CANARY),
  );
});
