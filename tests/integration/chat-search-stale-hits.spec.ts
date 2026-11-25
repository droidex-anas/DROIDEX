import { expect, test, type Page } from '@playwright/test';
import type { ClientCommand, ServerEvent } from '@droidex/protocol';
import { sessionSummary } from '../../src/test/sessionSummary';

test.use({ video: 'on' });

async function mockSearchBridge(page: Page, now: number) {
  const sessions = [
    sessionSummary('build', {
      title: 'Build log',
      cwd: '/repo',
      createdAt: now - 4 * 60_000,
      updatedAt: now - 4 * 60_000,
    }),
    sessionSummary('title', {
      title: 'Bravo plan',
      cwd: '/repo',
      createdAt: now - 2 * 60 * 60_000,
      updatedAt: now - 2 * 60 * 60_000,
    }),
  ];
  const searches: Extract<ClientCommand, { type: 'sessions.search' }>[] = [];
  const opened: string[] = [];
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
            generation: 'search-test',
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
    searches,
    opened,
    reply() {
      emit({
        type: 'sessions.searchResults',
        requestId: searches[0].requestId,
        indexingIncomplete: false,
        results: [
          { appSessionId: 'build', matches: [{ author: 'user', snippet: 'alpha only', ts: now }] },
        ],
      });
    },
  };
}

test('query changes discard content hits immediately without blocking title matches', async ({
  page,
}, testInfo) => {
  const now = Date.now();
  const { searches, opened, reply } = await mockSearchBridge(page, now);
  await page.clock.install({ time: now });
  await page.clock.pauseAt(now + 60_000);
  await page.goto(process.env.DROIDEX_TEST_URL || '/');
  await page.getByRole('button', { name: 'Search chats, messages, and PRs', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Search chats, messages, and PRs' });
  await input.fill('alpha');
  await page.clock.runFor(250);
  await expect.poll(() => searches.length).toBe(1);
  reply();
  await expect(page.getByText('You: alpha only', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('alpha.png') });
  await input.fill('bravo');
  await page.screenshot({ path: testInfo.outputPath('bravo.png') });
  await expect.soft(page.getByText('You: alpha only', { exact: true })).toHaveCount(0);
  await expect(
    page.getByTestId('sidebar-search-result').filter({ hasText: 'Bravo plan' }),
  ).toBeVisible();
  await input.press('Enter');
  await expect.poll(() => opened.length).toBeGreaterThan(0);
  expect.soft(opened).not.toContain('build');
  expect.soft(opened).toContain('title');
  expect(searches).toHaveLength(1);
});
