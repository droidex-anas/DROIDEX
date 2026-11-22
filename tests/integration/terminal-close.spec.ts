import { expect, test } from '@playwright/test';
import type { ClientCommand, ServerEvent } from '@droidex/protocol';
import { sessionSummary } from '../../src/test/sessionSummary';

test('an idle close reply preserves another terminal tab’s busy confirmation', async ({ page }) => {
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
    const checks = new Map<string, (busy: boolean) => void>();
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
        new Promise<boolean>((resolve) => {
          checks.set(id, resolve);
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
  await page.getByRole('button', { name: 'Close shell-1', exact: true }).click();
  await page.getByRole('button', { name: 'Close shell-2', exact: true }).click();
  const pendingChecks = () =>
    page.evaluate(() => {
      const state = Reflect.get(window, 'terminalCloseTest') as {
        checks: Map<string, (busy: boolean) => void>;
      };
      return [...state.checks.keys()];
    });
  await expect.poll(pendingChecks).toEqual(['terminal-1', 'terminal-2']);
  const reply = async (id: string, busy: boolean) => {
    await page.evaluate(
      ({ id, busy }) => {
        const state = Reflect.get(window, 'terminalCloseTest') as {
          checks: Map<string, (busy: boolean) => void>;
        };
        state.checks.get(id)?.(busy);
      },
      { id, busy },
    );
  };
  await reply('terminal-2', true);
  const stopAndClose = page.getByRole('button', { name: 'Stop and close', exact: true });
  await expect(stopAndClose).toBeVisible();
  await reply('terminal-1', false);
  await expect(page.getByRole('tab', { name: 'shell-1', exact: true })).toHaveCount(0);
  await expect(tabB).toHaveAttribute('aria-selected', 'true');
  await expect
    .poll(() =>
      page.evaluate(() => {
        return (Reflect.get(window, 'terminalCloseTest') as { killed: string[] }).killed;
      }),
    )
    .toEqual(['terminal-1']);
  await expect(stopAndClose).toBeVisible();
});
