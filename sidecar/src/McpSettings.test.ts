import assert from 'node:assert/strict';
import test from 'node:test';

import { McpServerStatus, McpServerType, SettingsLevel } from '@factory/droid-sdk';

import { McpSettings } from './McpSettings.js';
import type { ServerEvent } from './protocol.js';
import { FakeFactorySession } from './testing/fakeFactoryRuntime.js';

test('MCP catalog publishes tools after a connecting server settles', async () => {
  const session = new FakeFactorySession('mcp-settle', {}, []);
  const server = (status: McpServerStatus) => ({
    name: 'local-tools',
    status,
    source: SettingsLevel.User,
    isManaged: false,
    serverType: McpServerType.Stdio,
  });
  session.nextMcpServers = {
    servers: [server(McpServerStatus.Connecting)],
    summary: { total: 1, connected: 0, connecting: 1, failed: 0, disabled: 0 },
  };
  const events: ServerEvent[] = [];
  const settings = new McpSettings(
    async () => session,
    () => [],
    { add: async () => undefined, remove: async () => undefined },
    (event) => events.push(event),
    async () => {
      session.nextMcpServers = {
        servers: [{ ...server(McpServerStatus.Connected), toolCount: 1 }],
        summary: { total: 1, connected: 1, connecting: 0, failed: 0, disabled: 0 },
      };
      session.nextMcpTools = {
        tools: [{ serverName: 'local-tools', name: 'echo', isEnabled: true }],
      };
    },
  );

  await settings.handle({ type: 'mcp.list', requestId: 'settle-1' });

  const catalogs = events.filter((event) => event.type === 'mcp.catalog');
  assert.equal(catalogs.length, 2);
  assert.equal(catalogs[0]?.summary.connecting, 1);
  assert.equal(catalogs[1]?.summary.connected, 1);
  assert.equal(catalogs[1]?.tools[0]?.name, 'echo');
});
