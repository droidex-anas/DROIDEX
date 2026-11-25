import { expect, test, type Page } from '@playwright/test';
import type { ClientCommand, ServerEvent } from '@droidex/protocol';
import { sessionSummary } from '../../src/test/sessionSummary';

async function openArchivedChats(page: Page, count = 2) {
  let emitServerEvent: ((event: ServerEvent) => void) | undefined;
  const now = Date.UTC(2026, 5, 1, 12);
  await page.clock.install({ time: now });
  await page.addInitScript(
    ({ now }) => {
      localStorage.setItem(
        'droid-chat-metadata',
        JSON.stringify(
          Object.fromEntries(
            ['first', 'second', 'third', 'fourth'].map((id, index) => [
              id,
              { archivedAt: now - (index + 1) * 60_000 },
            ]),
          ),
        ),
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
      emitServerEvent = emit;
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
  return (event: ServerEvent) => {
    if (!emitServerEvent) throw new Error('Archive test bridge is not connected');
    emitServerEvent(event);
  };
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

for (const scenario of [
  { name: 'middle', count: 4, deleted: 'Release notes', neighbor: 'Parser cleanup' },
  { name: 'last', count: 3, deleted: 'Parser cleanup', neighbor: 'Release notes' },
  { name: 'only', count: 1, deleted: 'Saved research', neighbor: null },
]) {
  test(`deleting the ${scenario.name} archived row preserves keyboard focus`, async ({ page }) => {
    await openArchivedChats(page, scenario.count);
    await page
      .getByRole('button', { name: `Delete ${scenario.deleted} permanently`, exact: true })
      .focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('archived-chat-row')).toHaveCount(scenario.count - 1);
    const target = scenario.neighbor
      ? page.getByRole('button', {
          name: `Delete ${scenario.neighbor} permanently`,
          exact: true,
        })
      : page.getByText('No archived chats.', { exact: true }).locator('..');
    await expect(target).toBeFocused();
  });
}

for (const scenario of [
  { name: 'middle', count: 4, restored: 'Release notes', neighbor: 'Parser cleanup' },
  { name: 'last', count: 3, restored: 'Parser cleanup', neighbor: 'Release notes' },
  { name: 'only', count: 1, restored: 'Saved research', neighbor: null },
]) {
  test(`restoring the ${scenario.name} archived row preserves keyboard focus`, async ({ page }) => {
    await openArchivedChats(page, scenario.count);
    await page.getByRole('button', { name: `Restore ${scenario.restored}`, exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('archived-chat-row')).toHaveCount(scenario.count - 1);
    const target = scenario.neighbor
      ? page.getByRole('button', { name: `Restore ${scenario.neighbor}`, exact: true })
      : page.getByText('No archived chats.', { exact: true }).locator('..');
    await expect(target).toBeFocused();
  });
}

test('restoring two rows in turn toward the same neighbor keeps keyboard focus', async ({
  page,
}) => {
  await openArchivedChats(page, 4);
  await page.getByRole('button', { name: 'Restore Parser cleanup', exact: true }).focus();
  await page.keyboard.press('Enter');
  const neighbor = page.getByRole('button', { name: 'Restore Keyboard shortcuts', exact: true });
  await expect(neighbor).toBeFocused();
  await page.getByRole('button', { name: 'Restore Release notes', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('archived-chat-row')).toHaveCount(2);
  await expect(neighbor).toBeFocused();
});

test('restoring toward a row with an open delete confirmation keeps keyboard focus', async ({
  page,
}) => {
  await openArchivedChats(page, 3);
  await page
    .getByRole('button', { name: 'Delete Parser cleanup permanently', exact: true })
    .click();
  await page.getByRole('button', { name: 'Restore Release notes', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('button', { name: 'Restore Parser cleanup', exact: true }),
  ).toBeFocused();
});

test('an emptying delete does not pull focus from rows restored after new ones arrive', async ({
  page,
}) => {
  const emit = await openArchivedChats(page, 1);
  await page
    .getByRole('button', { name: 'Delete Saved research permanently', exact: true })
    .focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Enter');
  await expect(page.getByText('No archived chats.', { exact: true })).toBeVisible();
  emit({
    type: 'sessions.list',
    sessions: [
      sessionSummary('second', { title: 'Release notes', cwd: '' }),
      sessionSummary('third', { title: 'Parser cleanup', cwd: '' }),
    ],
    earlierSessionsByCwd: {},
  });
  await page.getByRole('button', { name: 'Restore Release notes', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('button', { name: 'Restore Parser cleanup', exact: true }),
  ).toBeFocused();
});
