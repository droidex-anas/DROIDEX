import { expect, test, type Page } from '@playwright/test';
import type { ClientCommand, ServerEvent } from '@droidex/protocol';
import { sessionSummary } from '../../src/test/sessionSummary';

async function openTerminals(page: Page, activeTab: 'A' | 'B' = 'B') {
  await page.routeWebSocket(
    (url) => url.searchParams.has('bridgeProtocol'),
    (socket) => {
      let seq = 0;
      const emit = (event: ServerEvent) => {
        seq += 1;
        socket.send(
          JSON.stringify({
            type: 'events.batch',
            generation: 'terminal-close-test',
            firstSeq: seq,
            lastSeq: seq,
            events: [{ seq, event }],
          }),
        );
      };
      socket.onMessage((message) => {
        if (typeof message !== 'string') return;
        const command = JSON.parse(message) as ClientCommand;
        if (command.type === 'connect') emit({ type: 'connection', status: 'connected' });
        if (command.type === 'sessions.list') {
          emit({ type: 'sessions.list', sessions: [], earlierSessionsByCwd: {} });
        }
        if (command.type === 'projects.list') emit({ type: 'projects.snapshot', projects: [] });
        if (command.type === 'session.create') {
          emit({
            type: 'session.created',
            clientRef: command.clientRef,
            session: sessionSummary('terminal-chat', { goal: command.goal }),
          });
        }
      });
    },
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const composer = page.getByRole('textbox', { name: 'Prompt' });
  await composer.fill('Check terminals');
  await composer.press('Enter');
  await page.evaluate(() => {
    let created = 0;
    const checks = new Map<string, { resolve: (busy: boolean) => void; reject: () => void }>();
    const killed: string[] = [];
    Reflect.set(window, 'terminalCloseTest', { checks, killed });
    const calls = {
      listEditors: async () => [],
      editorIcon: async () => null,
      gitWorktrees: async () => [],
      repoStatus: async () => null,
      nativeBrowserSetShortcuts: async () => {},
      terminalCreate: async (options: object) => {
        created += 1;
        return { ...options, id: `terminal-${created}`, shell: `/bin/shell-${created}` };
      },
      terminalResize: async () => {},
      terminalKill: async (id: string) => {
        killed.push(id);
      },
      terminalHasChildren: (id: string) =>
        new Promise<boolean>((resolve, reject) => {
          checks.set(id, { resolve, reject: () => reject(new Error('Child check failed')) });
        }),
      terminalSubscribe: () => ({ postInput: () => {}, onEvent: () => () => {}, close: () => {} }),
      terminalUnsubscribe: async () => {},
    };
    Reflect.set(
      window,
      'droidex',
      new Proxy(calls, {
        get: (target, name: string) =>
          name.startsWith('on') ? () => () => undefined : target[name as keyof typeof target],
      }),
    );
  });
  await page.getByRole('button', { name: 'Toggle utility pane', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Terminal', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'shell-1', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open another tool', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Terminal/ }).click();
  const tabB = page.getByRole('tab', { name: 'shell-2', exact: true });
  await expect(tabB).toBeVisible();
  if (activeTab === 'A') await page.getByRole('tab', { name: 'shell-1', exact: true }).click();
  const pendingChecks = () =>
    page.evaluate(() => {
      const state = Reflect.get(window, 'terminalCloseTest') as {
        checks: Map<string, { resolve: (busy: boolean) => void; reject: () => void }>;
      };
      return [...state.checks.keys()];
    });
  const closeTab = async (tab: '1' | '2') => {
    await page.getByRole('button', { name: `Close shell-${tab}`, exact: true }).click();
    await expect.poll(pendingChecks).toContain(`terminal-${tab}`);
  };
  const reply = async (id: string, result: boolean | 'failed') => {
    await page.evaluate(
      async ({ id, result }) => {
        const state = Reflect.get(window, 'terminalCloseTest') as {
          checks: Map<string, { resolve: (busy: boolean) => void; reject: () => void }>;
        };
        const check = state.checks.get(id);
        if (!check) throw new Error(`No pending check for ${id}`);
        if (result === 'failed') check.reject();
        else check.resolve(result);
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      },
      { id, result },
    );
  };
  const stopAndClose = page.getByRole('button', { name: 'Stop and close', exact: true });
  const killed = () =>
    page.evaluate(() => {
      return (Reflect.get(window, 'terminalCloseTest') as { killed: string[] }).killed;
    });
  return { tabB, reply, stopAndClose, killed, closeTab };
}

async function openTerminalsWithPendingCloses(page: Page, activeTab: 'A' | 'B' = 'B') {
  const terminals = await openTerminals(page, activeTab);
  await terminals.closeTab('1');
  await terminals.closeTab('2');
  return terminals;
}

test('an idle close reply preserves another terminal tab’s busy confirmation', async ({ page }) => {
  const { tabB, reply, stopAndClose, killed } = await openTerminalsWithPendingCloses(page);
  await reply('terminal-2', true);
  await expect(stopAndClose).toBeVisible();
  await reply('terminal-1', false);
  await expect(page.getByRole('tab', { name: 'shell-1', exact: true })).toHaveCount(0);
  await expect(tabB).toHaveAttribute('aria-selected', 'true');
  await expect.poll(killed).toEqual(['terminal-1']);
  await expect(stopAndClose).toBeVisible();
});

for (const result of [true, 'failed'] as const) {
  test(`a superseded ${result === true ? 'busy' : 'failed'} check cannot replace the latest close confirmation`, async ({
    page,
  }) => {
    const { tabB, reply, stopAndClose, killed } = await openTerminalsWithPendingCloses(
      page,
      result === 'failed' ? 'A' : 'B',
    );
    const tabA = page.getByRole('tab', { name: 'shell-1', exact: true });
    await reply('terminal-2', true);
    await expect(stopAndClose).toBeVisible();
    await reply('terminal-1', result);
    await expect(tabB).toHaveAttribute('aria-selected', 'true');
    await expect(tabA).toBeVisible();
    await expect(stopAndClose).toBeVisible();
    await stopAndClose.click();
    await expect(tabB).toHaveCount(0);
    await expect(tabA).toHaveAttribute('aria-selected', 'true');
    await expect.poll(killed).toEqual(['terminal-2']);
    await expect(stopAndClose).toHaveCount(0);
  });
}

test('an older busy check still asks after a newer idle close', async ({ page }) => {
  const { tabB, reply, stopAndClose, killed } = await openTerminalsWithPendingCloses(page);
  const tabA = page.getByRole('tab', { name: 'shell-1', exact: true });
  await reply('terminal-2', false);
  await expect(tabB).toHaveCount(0);
  await expect.poll(killed).toEqual(['terminal-2']);
  await reply('terminal-1', true);
  await expect(tabA).toHaveAttribute('aria-selected', 'true');
  await expect(stopAndClose).toBeVisible();
  await stopAndClose.click();
  await expect(tabA).toHaveCount(0);
  await expect.poll(killed).toEqual(['terminal-2', 'terminal-1']);
});

test('a later close replaces an armed prompt', async ({ page }) => {
  const { tabB, reply, stopAndClose, killed, closeTab } = await openTerminals(page);
  const tabA = page.getByRole('tab', { name: 'shell-1', exact: true });
  await closeTab('1');
  await reply('terminal-1', true);
  await expect(stopAndClose).toBeVisible();
  await expect(tabA).toHaveAttribute('aria-selected', 'true');
  await closeTab('2');
  await reply('terminal-2', true);
  await expect(tabB).toHaveAttribute('aria-selected', 'true');
  await expect(stopAndClose).toBeVisible();
  await stopAndClose.click();
  await expect(tabB).toHaveCount(0);
  await expect(tabA).toHaveAttribute('aria-selected', 'true');
  await expect.poll(killed).toEqual(['terminal-2']);
  await expect(stopAndClose).toHaveCount(0);
});
