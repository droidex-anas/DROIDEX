import assert from 'node:assert/strict';
import test from 'node:test';

import type { TranscriptEvent } from '../protocol.js';
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
