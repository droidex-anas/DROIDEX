import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { TranscriptEvent } from '../protocol.js';
import { SessionEventFlow } from '../SessionEventFlow.js';
import { SessionTimeline } from '../SessionTimeline.js';
import { ProviderTranscriptFile } from '../providers/ProviderTranscriptFile.js';
import { ClaudeEventMapper } from '../providers/claude/claudeEvents.js';
import { parseFullSessionTranscript } from '../sessionTranscript.js';
import { sessionSummary } from '../testing/sessionSummaryFixture.js';
import { appendCanvasToolBinding, readCanvasToolBindings } from './canvasToolBindings.js';
import { CanvasToolPresentation, canvasToolProvenance } from './canvasToolPresentation.js';

const CANARY = 'CANVAS_INTERNAL_GUIDANCE_7E4B';
const TOOL = 'mcp__droidex-canvas__canvas_write';

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

  const annotateName = 'mcp__droidex-canvas__canvas_annotate';
  const annotate = projector.project(
    event('tool_call', {
      toolName: annotateName,
      toolUseId: 'annotate-1',
      toolArgs: { source: CANARY },
    }),
    canvasToolProvenance(annotateName, 'annotate-1'),
  );
  assert.equal(annotate.canvasActivity?.action, 'annotate');
  assert.equal(annotate.canvasActivity?.message, 'Annotating canvas');
  assert.ok(!JSON.stringify(annotate).includes(CANARY));

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
      text: JSON.stringify({
        ok: true,
        chatAttached: true,
        created: {
          canvasId: 'canvas-1',
          frames: [{ designId: 'design-2', name: 'Hey', source: CANARY }],
        },
      }),
    }),
  );
  assert.deepEqual(created.canvasActivity?.designIds, ['design-2']);
  assert.equal(created.canvasActivity?.message, 'Created Hey');
  assert.equal(created.canvasActivity?.canvasId, 'canvas-1');
  assert.equal(created.canvasActivity?.title, 'Hey');
  assert.equal(created.canvasActivity?.firstArtifact, true);
  assert.ok(!JSON.stringify(created).includes(CANARY));
});

test('a theme save, proposal or apply keeps only its kit reference, live and on replay', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'canvas-theme-bindings-'));
  const previous = process.env.DROIDEX_USER_DATA_DIR;
  process.env.DROIDEX_USER_DATA_DIR = directory;
  t.after(() => {
    if (previous === undefined) delete process.env.DROIDEX_USER_DATA_DIR;
    else process.env.DROIDEX_USER_DATA_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  });
  const projector = new CanvasToolPresentation([], (binding) => {
    appendCanvasToolBinding('app', binding);
  });
  const name = 'mcp__droidex-canvas__canvas_theme';
  const changes = [
    { set: 'note', label: 'voice.md', body: CANARY },
    { set: 'token', name: '--ds-accent', value: CANARY, section: 'colors', group: 'Brand' },
  ];
  const results: TranscriptEvent[] = [];
  const theme = (toolUseId: string, toolArgs: Record<string, unknown>, answer: unknown) => {
    const call = projector.project(
      event('tool_call', { toolName: name, toolUseId, toolArgs }),
      canvasToolProvenance(name, toolUseId),
    );
    const text = JSON.stringify(answer);
    const result = event('tool_result', { toolUseId, text, isError: text.includes('"ok":false') });
    results.push(result);
    return [call, projector.project(result)];
  };
  const saved = theme(
    'save-1',
    { operation: 'save', kit: { id: 'acme', from: 'blank' }, name: CANARY, changes },
    { ok: true, status: 'saved', ref: { id: 'acme', version: 1 }, diagnostics: [] },
  );
  const proposed = theme(
    'save-2',
    { operation: 'save', kit: { id: 'acme', baseVersion: 1 }, changes },
    { ok: true, status: 'proposed', id: 'acme', baseVersion: 1, message: CANARY },
  );
  const applied = theme(
    'apply-1',
    { operation: 'apply', designId: 'design-1', ref: { id: 'acme', version: 2, mode: 'dark' } },
    { ok: true, status: 'applied', ref: { id: 'acme', version: 2 }, receipt: { revisionId: 'r1' } },
  );
  const refused = theme(
    'save-3',
    { operation: 'save', kit: { id: 'acme', baseVersion: 1 }, changes },
    { ok: false, error: { code: 'revision_conflict', message: CANARY } },
  );
  assert.deepEqual(
    [saved, proposed, applied, refused].map(([call, result]) => [
      call.canvasActivity?.message,
      result.canvasActivity?.message,
      result.canvasActivity?.designSystem,
    ]),
    [
      [
        'Saving design system',
        'Created design system acme · v1',
        { id: 'acme', version: 1, status: 'saved' },
      ],
      [
        'Saving design system',
        'Proposed changes to design system acme',
        { id: 'acme', version: 1, status: 'proposed' },
      ],
      [
        'Applying design system',
        'Applied design system acme · v2',
        { id: 'acme', version: 2, status: 'applied' },
      ],
      ['Saving design system', 'Could not save design system', undefined],
    ],
  );
  const persisted = readFileSync(join(directory, 'canvas-tool-bindings', 'app.jsonl'), 'utf8');
  const replayed = new CanvasToolPresentation(readCanvasToolBindings('app'));
  const replay = results.map((result) => replayed.project(result));
  assert.deepEqual(
    replay.map((result) => result.canvasActivity?.message),
    [saved, proposed, applied, refused].map(([, result]) => result.canvasActivity?.message),
  );
  assert.ok(!JSON.stringify([saved, proposed, applied, refused, replay]).includes(CANARY));
  assert.ok(!persisted.includes(CANARY));
});

const message = (value: unknown): SDKMessage => value as SDKMessage;

const streamEvent = (event: unknown, parent: string | null = null): SDKMessage =>
  message({ type: 'stream_event', event, parent_tool_use_id: parent });

const messageStart = (id: string, parent: string | null = null): SDKMessage =>
  streamEvent(
    {
      type: 'message_start',
      message: { id, model: 'claude-haiku-4-5', usage: { input_tokens: 0, output_tokens: 0 } },
    },
    parent,
  );

test('a Canvas assistant error body is a correlated tool result, not assistant prose', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'claude-canvas-error-'));
  const previous = process.env.DROIDEX_USER_DATA_DIR;
  process.env.DROIDEX_USER_DATA_DIR = directory;
  t.after(() => {
    if (previous === undefined) delete process.env.DROIDEX_USER_DATA_DIR;
    else process.env.DROIDEX_USER_DATA_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  });
  const canary = 'CANVAS_INTERNAL_GUIDANCE_7E4B';
  const summary = sessionSummary({ appSessionId: 'app-1', provider: 'claude' });
  const file = new ProviderTranscriptFile(summary.appSessionId, () => summary);
  const recorded: TranscriptEvent[] = [];
  const emitted: TranscriptEvent[] = [];
  const timeline = new SessionTimeline({
    registry: { resolveSummary: () => summary, getLive: () => true },
    history: {
      recordEvent: (event) => {
        recorded.push(event);
      },
    },
    getChildSessions: () => [],
    emit: (event) => {
      if (event.type === 'event.appended') emitted.push(event.event);
    },
    emitError: (error) => {
      throw new Error(error.message);
    },
    streamingCoalesceMs: 1000,
  });
  timeline.useTranscript(summary.appSessionId, file);
  const flow = new SessionEventFlow({
    appendTranscript: (event) => timeline.appendStreaming(event),
    flushTranscript: (app, source) => timeline.flushStreamingFor(app, source),
    applySideEffects: () => undefined,
    resolveChildScope: () => ({ childSessionId: 'child-1', role: 'worker' }),
    recordUsage: () => undefined,
  });
  await timeline.announcePrompt('app-1', `Please show ${canary}`);
  const mapper = new ClaudeEventMapper('app-1');
  for (const event of mapper.map(messageStart('ordinary-reply')))
    flow.apply('app-1', 'app-1', 'primary', event);
  for (const text of ['Ordinary ', 'reply.']) {
    for (const event of mapper.map(
      streamEvent({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text },
      }),
    ))
      flow.apply('app-1', 'app-1', 'primary', event);
  }
  assert.equal(recorded.length, 0, 'the real timeline coalescer buffers assistant deltas');
  const events = mapper.map(
    message({
      type: 'assistant',
      parent_tool_use_id: 'spawn-1',
      error: 'unknown',
      message: {
        id: 'canvas-error',
        content: [
          { type: 'text', text: 'Tool failed: CANVAS_INTERNAL_GUIDANCE_7E4B' },
          {
            type: 'tool_use',
            id: 'canvas-error',
            name: 'mcp__droidex-canvas__canvas_write',
            input: { designId: 'design-1' },
          },
        ],
      },
    }),
  );
  for (const event of events) flow.apply('app-1', 'app-1', 'primary', event);
  const streamedCall = {
    type: 'tool_use',
    id: 'canvas-streamed-error',
    name: 'mcp__droidex-canvas__canvas_write',
    input: { designId: 'design-2' },
  };
  for (const entry of [
    messageStart('canvas-streamed-error', 'spawn-1'),
    streamEvent({ type: 'content_block_start', index: 0, content_block: streamedCall }, 'spawn-1'),
    streamEvent(
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"designId":"design-2"}' },
      },
      'spawn-1',
    ),
    message({
      type: 'assistant',
      parent_tool_use_id: 'spawn-1',
      error: 'unknown',
      message: {
        id: 'canvas-streamed-error',
        content: [streamedCall, { type: 'text', text: `Tool failed: ${canary}` }],
      },
    }),
    streamEvent({ type: 'content_block_stop', index: 0 }, 'spawn-1'),
  ]) {
    for (const event of mapper.map(entry)) flow.apply('app-1', 'app-1', 'primary', event);
  }
  await timeline.settleStreaming('app-1', 'app-1');
  const childPath = join(directory, 'provider-sessions', 'child-1.jsonl');
  const replay = parseFullSessionTranscript('app-1', 'child-1', childPath, 'worker');
  for (const rows of [recorded, emitted.filter((row) => row.author !== 'user'), replay]) {
    assert.ok(!JSON.stringify(rows).includes(canary));
    const result = rows.find((row) => row.kind === 'tool_result');
    assert.equal(result?.canvasActivity?.state, 'failed');
    assert.deepEqual(result?.canvasActivity?.designIds, ['design-1']);
    assert.equal(result?.sourceSessionId, 'child-1');
    assert.deepEqual(
      rows.filter((row) => row.kind === 'tool_result').map((row) => row.canvasActivity?.state),
      ['failed', 'failed'],
    );
    assert.equal(rows.filter((row) => row.kind === 'tool_call').length, 2);
    const streamedResult = rows.find(
      (row) => row.toolUseId === streamedCall.id && row.kind === 'tool_result',
    );
    assert.deepEqual(streamedResult?.canvasActivity?.designIds, ['design-2']);
    assert.equal(streamedResult?.sourceSessionId, 'child-1');
  }
  assert.ok(!readFileSync(childPath, 'utf8').includes(canary));
  assert.equal(recorded.find((row) => row.kind === 'text')?.text, 'Ordinary reply.');
  assert.equal(emitted.find((row) => row.author === 'user')?.text, `Please show ${canary}`);
  assert.equal((await file.read()).split(canary).length - 1, 1);
  assert.deepEqual(
    events.map(({ transcript, childOwner }) => [
      transcript?.kind,
      transcript?.toolUseId,
      childOwner?.id,
    ]),
    [
      ['tool_call', 'canvas-error', 'spawn-1'],
      ['tool_result', 'canvas-error', 'spawn-1'],
    ],
  );
  assert.equal(events[1].transcript?.isError, true);
  assert.equal(events[1].transcript?.text, 'Tool failed: CANVAS_INTERNAL_GUIDANCE_7E4B');
});
