import { expect, test, type Page } from '@playwright/test';
import type { ClientCommand, ServerEvent } from '@droidex/protocol';
import { sessionSummary } from '../../src/test/sessionSummary';

async function openArchivedChats(page: Page) {
  const now = Date.UTC(2026, 5, 1, 12);
  await page.clock.install({ time: now });
  await page.addInitScript(
    ({ now }) => {
      localStorage.setItem(
        'droid-chat-metadata',
        JSON.stringify({
          first: { archivedAt: now - 60_000 },
          second: { archivedAt: now - 120_000 },
        }),
      );
    },
    { now },
  );
  await page.routeWebSocket(
    (url) => url.searchParams.has('bridgeProtocol'),
    (socket) => {
      let seq = 0;
      const emit = (event: ServerEvent) => {
        seq++;
        socket.send(
          JSON.stringify({
            type: 'events.batch',
            generation: 'archive-test',
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
        if (command.type === 'projects.list') emit({ type: 'projects.snapshot', projects: [] });
        if (command.type === 'sessions.list')
          emit({
            type: 'sessions.list',
            sessions: ['first', 'second'].map((id) =>
              sessionSummary(id, {
                title: id === 'first' ? 'Saved research' : 'Release notes',
                cwd: '',
                createdAt: now - 300_000,
                updatedAt: now - 180_000,
              }),
            ),
            earlierSessionsByCwd: {},
          });
      });
    },
  );
  await page.goto(process.env.DROIDEX_TEST_URL || '/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Archived chats', exact: true }).click();
  await expect(page.getByTestId('archived-chat-row')).toHaveCount(2);
}

test("keyboard Cancel restores the same archived row's delete focus", async ({ page }) => {
  await openArchivedChats(page);
  const row = page.getByTestId('archived-chat-row').filter({ hasText: 'Saved research' });
  const trigger = row.getByRole('button', { name: 'Delete Saved research permanently' });
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(row.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(trigger).toBeVisible();
  await expect(trigger).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('button', { name: 'Restore Release notes', exact: true }),
  ).toBeFocused();
});
