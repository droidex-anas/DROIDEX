import { expect, test, type Page } from '@playwright/test';
import type { ClientCommand, McpServerInfo, ServerEvent } from '@droidex/protocol';

const sentry: McpServerInfo = {
  name: 'sentry',
  status: 'connected',
  source: 'user',
  isManaged: false,
  serverType: 'http',
  toolCount: 0,
  hasAuthTokens: true,
};

// A sidecar that dies without answering the first MCP command sent after
// `replaceOnNextMcpCommand()`; its replacement answers everything after that.
async function openMcpSettings(page: Page) {
  const mcpCommands: ClientCommand[] = [];
  let replaceOnNext = false;
  await page.routeWebSocket(
    (url) => url.searchParams.has('bridgeProtocol'),
    (socket) => {
      let seq = 0;
      let generation = 'mcp-settings-original';
      const emit = (event: ServerEvent) => {
        seq += 1;
        socket.send(
          JSON.stringify({
            type: 'events.batch',
            generation,
            firstSeq: seq,
            lastSeq: seq,
            events: [{ seq, event }],
          }),
        );
      };
      const replaceRuntime = () => {
        generation = 'mcp-settings-replacement';
        seq = 0;
        socket.send(
          JSON.stringify({
            type: 'bridge.snapshot',
            generation,
            lastSeq: 0,
            reason: 'generation_changed',
            snapshot: {
              runtime: { mode: 'cli_auth', droidPath: '/bin/droid', apiKeyConfigured: false },
              sessions: [],
              children: [],
              processes: {},
              persistence: { durable: true, hadUnflushedWork: false },
              interrupted: [],
            },
          }),
        );
      };
      socket.onMessage((message) => {
        if (typeof message !== 'string') return;
        const command = JSON.parse(message) as ClientCommand;
        if (command.type === 'connect') emit({ type: 'connection', status: 'connected' });
        if (command.type === 'projects.list') emit({ type: 'projects.snapshot', projects: [] });
        if (!command.type.startsWith('mcp.') || !('requestId' in command)) return;
        mcpCommands.push(command);
        if (replaceOnNext) {
          replaceOnNext = false;
          replaceRuntime();
          return;
        }
        emit({
          type: 'mcp.catalog',
          requestId: command.requestId,
          servers: [sentry],
          tools: [],
          summary: { total: 1, connected: 1, connecting: 0, failed: 0, disabled: 0 },
        });
      });
    },
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search settings' }).fill('MCP servers');
  const refresh = page.getByRole('button', { name: 'Refresh MCP servers', exact: true });
  await expect(refresh).toBeEnabled();
  return {
    refresh,
    mcpCommands,
    replaceOnNextMcpCommand: () => {
      replaceOnNext = true;
    },
  };
}

test('a refresh lost with a replaced sidecar is read again from the new one', async ({ page }) => {
  const { refresh, mcpCommands, replaceOnNextMcpCommand } = await openMcpSettings(page);
  const sentBefore = mcpCommands.length;

  replaceOnNextMcpCommand();
  await refresh.click();

  await expect(refresh).toBeEnabled();
  await expect(page.getByText('sentry', { exact: true })).toBeVisible();
  expect(mcpCommands.slice(sentBefore).map((command) => command.type)).toEqual([
    'mcp.list',
    'mcp.list',
  ]);
});

test('a change lost with a replaced sidecar is not replayed', async ({ page }) => {
  const { refresh, mcpCommands, replaceOnNextMcpCommand } = await openMcpSettings(page);
  const sentBefore = mcpCommands.length;

  replaceOnNextMcpCommand();
  await page.getByRole('switch', { name: 'Disable sentry' }).click();

  await expect(page.getByText(/restarted before confirming/)).toBeVisible();
  await expect(refresh).toBeEnabled();
  await expect(page.getByRole('switch', { name: 'Disable sentry' })).toBeEnabled();
  expect(mcpCommands.slice(sentBefore).map((command) => command.type)).toEqual([
    'mcp.toggle',
    'mcp.list',
  ]);
});
