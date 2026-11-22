import { expect, test, type Page } from '@playwright/test';
import type { ClientCommand, ServerEvent } from '@droidex/protocol';
import { sessionSummary } from '../../src/test/sessionSummary';

async function openArchivedChats(page: Page, count = 2) {
  const now = Date.UTC(2026, 5, 1, 12);
  await page.clock.install({ time: now });
  await page.addInitScript(
    ({ now, count }) => {
      localStorage.setItem('droid-theme', JSON.stringify({ mode: 'system', presetId: 'droid' }));
      localStorage.setItem(
        'droid-chat-metadata',
        JSON.stringify(
          Object.fromEntries(
            ['first', 'second', 'third', 'fourth']
              .slice(0, count)
              .map((id, index) => [id, { archivedAt: now - (index + 1) * 60_000 }]),
          ),
        ),
      );
    },
    { now, count },
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
            sessions: ['first', 'second', 'third', 'fourth'].slice(0, count).map((id) =>
              sessionSummary(id, {
                title: {
                  first: 'Saved research',
                  second: 'Release notes',
                  third: 'Parser cleanup',
                  fourth: 'Keyboard shortcuts',
                }[id],
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
  await expect(page.getByTestId('archived-chat-row')).toHaveCount(count);
}

test("keyboard Cancel restores the same archived row's delete focus", async ({ page }) => {
  await openArchivedChats(page);
  const row = page.getByTestId('archived-chat-row').filter({ hasText: 'Saved research' });
  const trigger = row.getByRole('button', { name: 'Delete Saved research permanently' });
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(row.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(trigger).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('button', { name: 'Restore Release notes', exact: true }),
  ).toBeFocused();
});

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(colorScheme, () => {
    test.use({ colorScheme });
    for (const scenario of [
      { name: 'middle', count: 4, deleted: 'Release notes', neighbor: 'Parser cleanup' },
      { name: 'last', count: 3, deleted: 'Parser cleanup', neighbor: 'Release notes' },
      { name: 'only', count: 1, deleted: 'Saved research', neighbor: null },
    ]) {
      test(`deleting the ${scenario.name} archived row preserves keyboard focus`, async ({
        page,
      }, testInfo) => {
        await openArchivedChats(page, scenario.count);
        await page
          .getByRole('button', { name: `Delete ${scenario.deleted} permanently`, exact: true })
          .focus();
        await page.keyboard.press('Enter');
        await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Enter');
        await expect(page.getByTestId('archived-chat-row')).toHaveCount(scenario.count - 1);
        await page
          .getByText('Archived chats', { exact: true })
          .last()
          .locator('..')
          .locator('..')
          .screenshot({ path: testInfo.outputPath('after-delete.png') });
        const target = scenario.neighbor
          ? page.getByRole('button', {
              name: `Delete ${scenario.neighbor} permanently`,
              exact: true,
            })
          : page.getByText('No archived chats.', { exact: true });
        await expect(target).toBeFocused();
        if (scenario.name === 'middle') {
          await page.keyboard.press('Tab');
          await expect(
            page.getByRole('button', { name: 'Restore Keyboard shortcuts', exact: true }),
          ).toBeFocused();
        } else if (scenario.name === 'last') {
          await page.keyboard.press('Tab');
          await page.keyboard.press('Shift+Tab');
          await expect(target).toBeFocused();
        }
      });
    }
  });
}
