import { expect, test, type Page } from '@playwright/test';
import type { ClientCommand, ServerEvent } from '@droidex/protocol';
import { sessionSummary } from '../../src/test/sessionSummary';

test.use({ video: 'on', viewport: { width: 1280, height: 800 } });

// Fifteen title matches, newest first, so the search caps them at twelve rows.
async function mockPlanSessions(page: Page, now: number) {
  const sessions = Array.from({ length: 15 }, (_, i) =>
    sessionSummary(`plan-${i + 1}`, {
      title: `Plan ${i + 1}`,
      cwd: '/repo',
      createdAt: now - (i + 1) * 60_000,
      updatedAt: now - (i + 1) * 60_000,
    }),
  );
  const opened: string[] = [];
  await page.addInitScript(() =>
    localStorage.setItem('droid-workspaces', JSON.stringify(['/repo'])),
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
            generation: 'search-scroll-test',
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
          emit({ type: 'sessions.list', sessions, earlierSessionsByCwd: {} });
        if (command.type === 'session.loadHistory') {
          opened.push(command.appSessionId);
          emit({
            type: 'session.history',
            appSessionId: command.appSessionId,
            progress: [],
            transcripts: [],
          });
        }
      });
    },
  );
  return opened;
}

test('arrow keys keep the selected result in view, and Enter opens it', async ({
  page,
}, testInfo) => {
  const now = Date.now();
  const opened = await mockPlanSessions(page, now);
  await page.goto(process.env.DROIDEX_TEST_URL || '/');
  await page.getByRole('button', { name: 'Search chats, messages, and PRs', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Search chats, messages, and PRs' });
  await input.fill('plan');
  const results = page.getByTestId('sidebar-search-result');
  await expect(results).toHaveCount(12);

  // A resting pointer must not take the selection back as rows scroll under it.
  await results.first().hover();
  await input.press('ArrowUp');
  await expect(results.last()).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: testInfo.outputPath('wrapped-up.png') });
  await expect(input).toBeFocused();

  await input.press('ArrowDown');
  await expect(results.first()).toBeInViewport({ ratio: 1 });

  await input.press('ArrowUp');
  await input.press('Enter');
  await expect.poll(() => opened).toContain('plan-12');
});
