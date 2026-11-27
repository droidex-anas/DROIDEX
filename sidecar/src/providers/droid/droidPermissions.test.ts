import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyPermission, confirmationType, permissionSignature } from './droidPermissions.js';

test('classifyPermission reads the SDK toolUses shape for MCP tools and exec', () => {
  const mcp = {
    options: [{ value: 'proceed_once', label: 'Allow once' }],
    toolUses: [
      {
        confirmationType: 'mcp_tool',
        details: {
          type: 'mcp_tool',
          toolName: 'droidex-browser___design_reference',
          impactLevel: 'low',
        },
        toolUse: {
          type: 'tool_use',
          id: 't1',
          name: 'droidex-browser___design_reference',
          input: { url: 'https://skeina.app' },
        },
      },
    ],
  } as never;
  assert.equal(confirmationType(mcp), 'mcp_tool');
  const tool = classifyPermission('m1', 'r1', mcp);
  assert.equal(tool.kind, 'mcp');
  assert.equal(tool.title, 'droidex-browser · design_reference');
  assert.match(tool.detail, /url: https:\/\/skeina\.app/);
  assert.match(tool.detail, /Impact: low/);
  assert.equal(permissionSignature(mcp), 'mcp::::droidex-browser___design_reference');

  const exec = {
    options: [],
    toolUses: [
      {
        confirmationType: 'exec',
        details: { type: 'exec', command: 'rtk', fullCommand: 'rtk rm -rf build' },
        toolUse: {
          type: 'tool_use',
          id: 't2',
          name: 'Execute',
          input: { command: 'rtk rm -rf build' },
        },
      },
    ],
  } as never;
  const command = classifyPermission('m1', 'r2', exec);
  assert.equal(command.kind, 'exec');
  assert.equal(command.title, 'Run command');
  assert.equal(command.detail, 'rtk rm -rf build');
  assert.equal(permissionSignature(exec), 'exec::rtk rm -rf build');
});

test('permission grant keys hash automation payloads and name the kind of chat a spawn starts', () => {
  const params = (details: Record<string, unknown>, input: Record<string, unknown>) =>
    ({ toolUses: [{ details: { type: 'mcp_tool', ...details }, toolUse: { input } }] }) as never;
  const prefix = 'x'.repeat(9_000);
  for (const automation of [
    { serverName: 'droidex-automations', toolName: 'automation_update' },
    // Droid names the server inside the tool.
    { toolName: 'droidex_automations___automation_update' },
  ]) {
    // A grant for one automation payload must not cover a different one.
    assert.notEqual(
      permissionSignature(params(automation, { automationId: 'one', prompt: `${prefix}a` })),
      permissionSignature(params(automation, { automationId: 'one', prompt: `${prefix}b` })),
    );
    // The same payload earns the same grant whatever order its keys arrive in.
    assert.equal(
      permissionSignature(params(automation, { automationId: 'one', prompt: 'p' })),
      permissionSignature(params(automation, { prompt: 'p', automationId: 'one' })),
    );
  }

  const spawn = (input: Record<string, unknown>) =>
    permissionSignature(params({ toolName: 'droidex_sessions___thread_spawn' }, input));
  assert.equal(spawn({ reportBack: true }), 'mcp::::droidex_sessions___thread_spawn::thread');
  assert.equal(spawn({ reportBack: false }), 'mcp::::droidex_sessions___thread_spawn::chat');
  assert.equal(spawn({}), '');
});
