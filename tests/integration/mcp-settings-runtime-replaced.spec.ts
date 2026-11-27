import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';
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

// A fake sidecar that can be restarted: the old socket closes and the bridge's
// reconnect reaches a new runtime generation, announced by a snapshot.
async function openMcpSettings(page: Page) {
  const mcpCommands: ClientCommand[] = [];
  let socket: WebSocketRoute | undefined;
  let generation = 'mcp-settings-original';
  let seq = 0;
  let isRestarting = false;
  let loseNextMcpCommand = false;
  let announceAfter: ClientCommand['type'] | undefined;
  let onReconnect: (() => void) | undefined;

  const emit = (event: ServerEvent) => {
    seq += 1;
    socket?.send(
      JSON.stringify({
        type: 'events.batch',
        generation,
        firstSeq: seq,
        lastSeq: seq,
        events: [{ seq, event }],
      }),
    );
  };
  const announceReplacement = () => {
    isRestarting = false;
    generation = 'mcp-settings-replacement';
    seq = 0;
    socket?.send(
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
  const restart = () => {
    isRestarting = true;
    void socket?.close();
  };

  await page.routeWebSocket(
    (url) => url.searchParams.has('bridgeProtocol'),
    (route) => {
      socket = route;
      if (isRestarting) onReconnect?.();
      if (isRestarting && !announceAfter) announceReplacement();
      route.onMessage((message) => {
        if (typeof message !== 'string') return;
        const command = JSON.parse(message) as ClientCommand;
        if (command.type === 'connect' && !(isRestarting && announceAfter)) {
          emit({ type: 'connection', status: 'connected' });
        }
        if (command.type === 'projects.list') emit({ type: 'projects.snapshot', projects: [] });
        if (!command.type.startsWith('mcp.') || !('requestId' in command)) return;
        mcpCommands.push(command);
        if (loseNextMcpCommand) {
          loseNextMcpCommand = false;
          restart();
          return;
        }
        if (isRestarting && command.type === announceAfter) {
          announceAfter = undefined;
          announceReplacement();
          emit({ type: 'connection', status: 'connected' });
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
  const sentBefore = mcpCommands.length;
  return {
    refresh,
    toggle: page.getByRole('switch', { name: 'Disable sentry' }),
    notice: page.getByText(/restarted before confirming/),
    mcpCommandsSince: () => mcpCommands.slice(sentBefore).map((command) => command.type),
    restartOnNextMcpCommand: () => {
      loseNextMcpCommand = true;
    },
    restartAnnouncingAfter: async (type: ClientCommand['type']) => {
      announceAfter = type;
      const reconnected = new Promise<void>((resolve) => {
        onReconnect = resolve;
      });
      restart();
      await reconnected;
    },
  };
}

test('a refresh lost with a replaced sidecar is read again from the new one', async ({ page }) => {
  const mcp = await openMcpSettings(page);

  mcp.restartOnNextMcpCommand();
  await mcp.refresh.click();

  await expect(mcp.refresh).toBeEnabled();
  await expect(page.getByText('sentry', { exact: true })).toBeVisible();
  expect(mcp.mcpCommandsSince()).toEqual(['mcp.list', 'mcp.list']);
});

test('a change lost with a replaced sidecar is not replayed', async ({ page }) => {
  const mcp = await openMcpSettings(page);

  mcp.restartOnNextMcpCommand();
  await mcp.toggle.click();

  await expect(mcp.notice).toBeVisible();
  await expect(mcp.refresh).toBeEnabled();
  await expect(mcp.toggle).toBeEnabled();
  expect(mcp.mcpCommandsSince()).toEqual(['mcp.toggle', 'mcp.list']);
});

test('a change resent to the replaced sidecar is trusted', async ({ page }) => {
  const mcp = await openMcpSettings(page);

  await mcp.restartAnnouncingAfter('mcp.toggle');
  await mcp.toggle.click();

  await expect(mcp.refresh).toBeEnabled();
  await expect(mcp.toggle).toBeEnabled();
  await expect(mcp.notice).toHaveCount(0);
  expect(mcp.mcpCommandsSince()).toEqual(['mcp.toggle']);
});
