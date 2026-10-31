import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RequestPermissionRequestSchema,
  ToolConfirmationOutcome,
  ToolConfirmationType,
  type RequestPermissionRequestParams,
} from '@factory/droid-sdk';

import { normalizeDroidTransportMessage } from '../../DroidTransport.js';
import {
  approvalRequests,
  createInteractionsHarness,
  latestApprovalRequest,
  permissionInput,
} from '../../testing/sessionInteractionsSupport.js';
import { droidInteractionHandlers } from './droidInteractions.js';

test('Droid edits-only approves a pure edit batch and asks for commands or mixed batches', async () => {
  let asked = 0;
  const ref = { id: 'app-1', autonomy: 'low' as const };
  const { permissionHandler } = droidInteractionHandlers(ref, {
    requestApproval: async () => {
      asked += 1;
      return 'cancel';
    },
    requestQuestion: async () => ({ cancelled: true, answers: [] }),
    isActive: () => true,
    cancelPending: () => undefined,
  });
  const edit: RequestPermissionRequestParams = {
    toolUses: [
      {
        toolUse: {
          type: 'tool_use',
          id: 'edit-1',
          name: 'Edit',
          input: { file_path: '/workspace/a' },
        },
        confirmationType: ToolConfirmationType.Edit,
        details: { type: ToolConfirmationType.Edit, filePath: '/workspace/a', fileName: 'a' },
      },
    ],
    options: [],
  };
  assert.equal(await permissionHandler(edit), ToolConfirmationOutcome.ProceedOnce);
  assert.equal(asked, 0);
  assert.equal(await permissionHandler(permissionInput('exec-1')), ToolConfirmationOutcome.Cancel);
  assert.equal(
    await permissionHandler({
      ...edit,
      toolUses: [...edit.toolUses, ...permissionInput('exec-2').toolUses],
    }),
    ToolConfirmationOutcome.Cancel,
  );
  assert.equal(asked, 2);
});

function canvasWriteUse(toolUseId: string): RequestPermissionRequestParams['toolUses'][number] {
  return {
    toolUse: {
      type: 'tool_use',
      id: toolUseId,
      name: 'droidex-canvas___canvas_write',
      input: { mutationId: toolUseId },
    },
    confirmationType: ToolConfirmationType.McpTool,
    details: {
      type: ToolConfirmationType.McpTool,
      toolName: 'canvas_write',
      serverName: 'droidex-canvas',
      impactLevel: 'low',
    },
  };
}

test('a Droid bundle of only Canvas tools proceeds without a card at autonomy off', async () => {
  const harness = createInteractionsHarness();
  harness.addLiveSession('design').summary.autonomy = 'off';
  const bundle: RequestPermissionRequestParams = {
    toolUses: ['write-light', 'write-dark', 'write-hero', 'write-footer'].map(canvasWriteUse),
    options: [],
  };
  assert.equal(
    await harness.permissionHandler({ id: 'design' })(bundle),
    ToolConfirmationOutcome.ProceedOnce,
  );
  assert.equal(approvalRequests(harness.emitted).length, 0);
});

test('a Droid bundle led by a Canvas tool still asks for the whole request', async () => {
  const harness = createInteractionsHarness();
  harness.addLiveSession('design').summary.autonomy = 'off';
  const bundle: RequestPermissionRequestParams = {
    toolUses: [canvasWriteUse('write-light'), ...permissionInput('exec-1').toolUses],
    options: [],
  };
  const pending = Promise.resolve(harness.permissionHandler({ id: 'design' })(bundle));
  const request = latestApprovalRequest(harness.emitted);
  assert.equal(request.title, 'droidex-canvas · canvas_write, Run command');
  assert.equal(request.canAlwaysAllow, false);
  await harness.interactions.respondToApproval('design', request.requestId, 'refuse');
  assert.equal(await pending, ToolConfirmationOutcome.Cancel);
  assert.equal(approvalRequests(harness.emitted).length, 1);
});

function foreignMcpUse(toolUseId: string): RequestPermissionRequestParams['toolUses'][number] {
  return {
    toolUse: {
      type: 'tool_use',
      id: toolUseId,
      name: 'acme-fs___read_file',
      input: { path: '/tmp/notes' },
    },
    confirmationType: ToolConfirmationType.McpTool,
    details: {
      type: ToolConfirmationType.McpTool,
      toolName: 'acme-fs___read_file',
      impactLevel: 'low',
    },
  };
}

test('a Droid bundle of Canvas and a foreign MCP tool asks for the whole request', async () => {
  const harness = createInteractionsHarness();
  harness.addLiveSession('design').summary.autonomy = 'off';
  const bundle: RequestPermissionRequestParams = {
    toolUses: [canvasWriteUse('write-light'), foreignMcpUse('read-1')],
    options: [],
  };
  const pending = Promise.resolve(harness.permissionHandler({ id: 'design' })(bundle));
  const request = latestApprovalRequest(harness.emitted);
  assert.equal(request.title, 'droidex-canvas · canvas_write, acme-fs · read_file');
  assert.equal(request.canAlwaysAllow, false);
  await harness.interactions.respondToApproval('design', request.requestId, 'refuse');
  assert.equal(await pending, ToolConfirmationOutcome.Cancel);
  assert.equal(approvalRequests(harness.emitted).length, 1);
});

function droidScriptPermission(calls: unknown[]): RequestPermissionRequestParams {
  const message = normalizeDroidTransportMessage({
    jsonrpc: '2.0',
    factoryApiVersion: '1.0.0',
    type: 'request',
    id: 'permission-script',
    method: 'droid.request_permission',
    params: {
      toolUses: [
        {
          toolUse: { type: 'tool_use', id: 'script-1', name: 'Script', input: { script: '…' } },
          confirmationType: 'script',
          details: { type: 'script', impactLevel: 'high', calls },
        },
      ],
      options: [],
    },
  });
  return RequestPermissionRequestSchema.parse(message).params;
}

function scriptCall(toolName: string, confirmation: Record<string, unknown>) {
  return { toolName, toolInput: {}, confirmation };
}

const scriptCanvasWrite = scriptCall('droidex-canvas___canvas_write', {
  type: 'mcp_tool',
  toolName: 'droidex-canvas___canvas_write',
  serverName: 'droidex-canvas',
  impactLevel: 'high',
});

test('a Droid script of Canvas calls proceeds, and one with a command asks once', async () => {
  const harness = createInteractionsHarness();
  harness.addLiveSession('design').summary.autonomy = 'off';
  const ask = harness.permissionHandler({ id: 'design' });

  const canvasOnly = droidScriptPermission([scriptCanvasWrite, scriptCanvasWrite]);
  assert.equal(await ask(canvasOnly), ToolConfirmationOutcome.ProceedOnce);
  assert.equal(approvalRequests(harness.emitted).length, 0);

  const command = scriptCall('Execute', { type: 'exec', fullCommand: 'ls', command: 'ls' });
  for (const calls of [[scriptCanvasWrite, command], [command]]) {
    const pending = Promise.resolve(ask(droidScriptPermission(calls)));
    const request = latestApprovalRequest(harness.emitted);
    assert.equal(
      request.title,
      calls.length === 2 ? 'droidex-canvas · canvas_write, Run command' : 'Run command',
    );
    // "Always" on a script grants every command of its impact level.
    assert.equal(request.canAlwaysAllow, false);
    await harness.interactions.respondToApproval('design', request.requestId, 'refuse');
    assert.equal(await pending, ToolConfirmationOutcome.Cancel);
  }
  assert.equal(approvalRequests(harness.emitted).length, 2);
});
