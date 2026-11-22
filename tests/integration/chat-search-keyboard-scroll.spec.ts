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
  const searches: Extract<ClientCommand, { type: 'sessions.search' }>[] = [];
  let emit: (event: ServerEvent) => void = () => {};
  await page.addInitScript(() =>
    localStorage.setItem('droid-workspaces', JSON.stringify(['/repo'])),
  );
  await page.routeWebSocket(
    (url) => url.searchParams.has('bridgeProtocol'),
    (socket) => {
      let seq = 0;
      emit = (event) => {
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
        if (command.type === 'sessions.search') searches.push(command);
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
  return {
    opened,
    // Two message snippets per row, so every row grows after it first renders.
    replyWithSnippets() {
      emit({
        type: 'sessions.searchResults',
        requestId: searches[0].requestId,
        indexingIncomplete: false,
        results: sessions.map((session) => ({
          appSessionId: session.appSessionId,
          matches: [
            { author: 'user', snippet: 'plan the release', ts: now },
            { author: 'assistant', snippet: 'plan drafted', ts: now },
          ],
        })),
      });
    },
    shrinkTo(count: number) {
      emit({ type: 'sessions.list', sessions: sessions.slice(0, count), earlierSessionsByCwd: {} });
    },
    async searchSent() {
      await expect.poll(() => searches.length).toBe(1);
    },
  };
}

async function searchPlans(page: Page) {
  await page.goto(process.env.DROIDEX_TEST_URL || '/');
  await page.getByRole('button', { name: 'Search chats, messages, and PRs', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Search chats, messages, and PRs' });
  await input.fill('plan');
  const results = page.getByTestId('sidebar-search-result');
  await expect(results).toHaveCount(12);
  return { input, results };
}

test('arrow keys keep the selected result in view, and Enter opens it', async ({
  page,
}, testInfo) => {
  const bridge = await mockPlanSessions(page, Date.now());
  const { input, results } = await searchPlans(page);
  await expect(results.last()).not.toBeInViewport();

  // A resting pointer must not take the selection back as rows scroll under it.
  await results.first().hover();
  await input.press('ArrowUp');
  await expect(results.last()).toBeInViewport({ ratio: 1 });
  await expect(input).toBeFocused();

  // Late message snippets grow the rows above; the selected row stays in view.
  await bridge.searchSent();
  bridge.replyWithSnippets();
  await expect(results.first().getByText('plan drafted')).toBeVisible();
  await expect(results.last()).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: testInfo.outputPath('wrapped-up.png') });

  await input.press('ArrowDown');
  await expect(results.first()).toBeInViewport({ ratio: 1 });

  await input.press('ArrowUp');
  await input.press('Enter');
  await expect.poll(() => bridge.opened).toContain('plan-12');
});

test('a shrinking result list keeps its last row selected', async ({ page }) => {
  const bridge = await mockPlanSessions(page, Date.now());
  const { input, results } = await searchPlans(page);

  await input.press('ArrowUp');
  bridge.shrinkTo(3);
  await expect(results).toHaveCount(3);
  await input.press('Enter');
  await expect.poll(() => bridge.opened).toContain('plan-3');
});
