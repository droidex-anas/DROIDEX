import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';
import type { ClientCommand, ServerEvent } from '@droidex/protocol';
import { sessionSummary } from '../../src/test/sessionSummary';

const now = Date.UTC(2026, 10, 23, 12);
const live = sessionSummary('live-review', {
  title: 'Review current changes',
  cwd: '/repo',
  updatedAt: now - 3_600_000,
});
const history = sessionSummary('history-release', {
  title: 'Historical release checklist',
  cwd: '/repo',
  updatedAt: now - 3_600_000,
});

async function openSidebar(page: Page, loseInitialResponse: boolean) {
  await page.clock.setFixedTime(now);
  await page.addInitScript(
    ({ live }) => {
      localStorage.setItem('droid-workspaces', JSON.stringify(['/repo', '/other']));
      localStorage.setItem(
        'droid-session-snapshot-v2',
        JSON.stringify({
          sessions: [live],
          listConfirmedSessionIds: [live.appSessionId],
        }),
      );
    },
    { live },
  );
  const lists: ClientCommand[] = [];
  let socket: WebSocketRoute;
  let connections = 0;
  let seq = 0;
  let generation = 'original';
  let replaceGeneration = false;
  const emit = (event: ServerEvent) => {
    seq++;
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
  await page.routeWebSocket(
    (url) => url.searchParams.has('bridgeProtocol'),
    (route) => {
      socket = route;
      connections++;
      if (replaceGeneration) {
        generation = 'replacement';
        seq = 0;
        socket.send(
          JSON.stringify({
            type: 'bridge.snapshot',
            generation,
            lastSeq: 0,
            reason: 'generation_changed',
            snapshot: {
              runtime: { mode: 'cli_auth', droidPath: '/fixture/droid', apiKeyConfigured: false },
              sessions: [live],
              children: [],
              processes: {},
              persistence: { durable: true, hadUnflushedWork: false },
              interrupted: [],
            },
          }),
        );
      }
      socket.onMessage((raw) => {
        const command = JSON.parse(String(raw)) as ClientCommand;
        if (command.type === 'connect' && connections === 1) {
          emit({ type: 'connection', status: 'connected' });
          emit({ type: 'session.updated', session: live });
        }
        if (command.type === 'projects.list') emit({ type: 'projects.snapshot', projects: [] });
        if (command.type !== 'sessions.list') return;
        lists.push(command);
        if (loseInitialResponse && lists.length === 1) {
          replaceGeneration = true;
          void socket.close({ code: 1011, reason: 'lost initial list response' });
        } else emit({ type: 'sessions.list', sessions: [live, history], earlierSessionsByCwd: {} });
      });
    },
  );
  await page.goto('/');
  const repo = page.getByRole('button', { name: 'repo', exact: true });
  await expect(repo).toBeVisible();
  if ((await repo.getAttribute('aria-expanded')) === 'false') await repo.click();
  return {
    lists,
    history: page.getByTestId('session-row').filter({ hasText: history.title }),
    connections: () => connections,
    reconnect: (replace: boolean) => {
      replaceGeneration = replace;
      void socket.close();
    },
  };
}

test('a lost initial list is restored after a live-only generation reset', async ({ page }) => {
  const sidebar = await openSidebar(page, true);
  await expect.poll(sidebar.connections).toBe(2);
  await expect(sidebar.history).toBeVisible();
  expect(sidebar.lists).toHaveLength(2);
  expect(sidebar.lists[1]).toEqual(sidebar.lists[0]);
});

test('unchanged scopes refresh on silent replay and live-only replacement, not first connect', async ({
  page,
}) => {
  const sidebar = await openSidebar(page, false);
  await expect(sidebar.history).toBeVisible();
  expect(sidebar.lists).toHaveLength(1);
  sidebar.reconnect(false);
  await expect.poll(() => sidebar.lists.length).toBe(2);
  await expect(sidebar.history).toBeVisible();
  sidebar.reconnect(true);
  await expect.poll(() => sidebar.lists.length).toBe(3);
  await expect(sidebar.history).toBeVisible();
  expect(sidebar.lists).toEqual([sidebar.lists[0], sidebar.lists[0], sidebar.lists[0]]);
});
