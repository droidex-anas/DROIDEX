import assert from 'node:assert/strict';
import test from 'node:test';
import { RequestPermissionRequestSchema, type DroidClientTransport } from '@factory/droid-sdk';
import { normalizeDroidTransportMessage, wrapDroidTransport } from './DroidTransport.js';

test('normalizes current CLI permission options before SDK validation', () => {
  const message = {
    jsonrpc: '2.0',
    factoryApiVersion: '1.0.0',
    type: 'request',
    id: 'permission-1',
    method: 'droid.request_permission',
    params: {
      toolUses: [
        {
          toolUse: {
            type: 'tool_use',
            id: 'tool-1',
            input: {},
            name: 'droidmaxx-browser___browser_open',
          },
          confirmationType: 'mcp_tool',
          details: {
            type: 'mcp_tool',
            toolName: 'droidmaxx-browser___browser_open',
            impactLevel: 'low',
          },
        },
      ],
      options: [
        { label: 'Allow once', value: 'proceed_once' },
        { label: 'Allow tool', value: 'proceed_always_tools' },
        { label: 'Allow server', value: 'proceed_always_server' },
        { label: 'Allow file', value: 'proceed_always_file' },
      ],
    },
  };

  const normalized = normalizeDroidTransportMessage(message);

  assert.deepEqual(
    (normalized.params as { options: { value: string }[] }).options.map((option) => option.value),
    ['proceed_once', 'proceed_always', 'proceed_always', 'proceed_always'],
  );
  assert.doesNotThrow(() => RequestPermissionRequestSchema.parse(normalized));
});

function scriptPermissionMessage(calls: unknown[]) {
  return {
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
      options: [{ label: 'Yes, allow all', value: 'proceed_once' }],
    },
  };
}

const canvasReadCall = {
  toolName: 'droidex-canvas___canvas_read',
  toolInput: {},
  confirmation: {
    type: 'mcp_tool',
    toolName: 'droidex-canvas___canvas_read',
    serverName: 'droidex-canvas',
    impactLevel: 'high',
  },
};

const touchCall = {
  toolName: 'Execute',
  toolInput: { command: 'touch probe' },
  confirmation: {
    type: 'exec',
    fullCommand: 'touch probe',
    command: 'touch',
    impactLevel: 'medium',
  },
};

test('expands a Droid script permission into the confirmations of its calls', () => {
  const normalized = RequestPermissionRequestSchema.parse(
    normalizeDroidTransportMessage(scriptPermissionMessage([canvasReadCall, touchCall])),
  );

  assert.deepEqual(
    normalized.params.toolUses.map(({ toolUse, confirmationType, details }) => ({
      id: toolUse.id,
      name: toolUse.name,
      confirmationType,
      type: details.type,
      inScript: details.inScript,
    })),
    [
      {
        id: 'script-1:0',
        name: 'droidex-canvas___canvas_read',
        confirmationType: 'mcp_tool',
        type: 'mcp_tool',
        inScript: true,
      },
      { id: 'script-1:1', name: 'Execute', confirmationType: 'exec', type: 'exec', inScript: true },
    ],
  );
});

test('leaves an unreadable script for the SDK to refuse', () => {
  for (const calls of [
    [],
    [{ ...canvasReadCall, confirmation: undefined }],
    [{ ...canvasReadCall, confirmation: { toolName: 'canvas_read' } }],
    [canvasReadCall, { ...touchCall, toolInput: 'touch probe' }],
  ]) {
    const message = scriptPermissionMessage(calls);
    assert.equal(normalizeDroidTransportMessage(message), message);
    assert.throws(() => RequestPermissionRequestSchema.parse(message));
  }
});
test('leaves non-permission messages untouched', () => {
  const message = {
    jsonrpc: '2.0',
    method: 'droid.session_notification',
    params: { text: 'proceed_always_tools' },
  };

  assert.equal(normalizeDroidTransportMessage(message), message);
});

test('processId survives failed SDK cleanup but excludes an exited child', async () => {
  const childProcess: { pid: number; exitCode: number | null; signalCode: NodeJS.Signals | null } =
    {
      pid: 777,
      exitCode: null,
      signalCode: null,
    };
  const inner: DroidClientTransport & { childProcess: typeof childProcess | null } = {
    isConnected: true,
    childProcess,
    send() {},
    onMessage() {},
    onError() {},
    close: async () => {
      inner.childProcess = null;
      throw new Error('close failed');
    },
  };
  const transport = wrapDroidTransport(inner);
  assert.equal(transport.processId, 777);
  await assert.rejects(transport.close(), /close failed/);
  assert.equal(transport.processId, 777);
  childProcess.exitCode = 0;
  assert.equal(transport.processId, undefined);
  childProcess.exitCode = null;
  childProcess.signalCode = 'SIGTERM';
  assert.equal(transport.processId, undefined);
});
