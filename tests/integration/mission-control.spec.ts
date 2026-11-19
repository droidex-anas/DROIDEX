import { expect, test } from '@playwright/test';
import { sessionSummary } from '../../src/test/sessionSummary';
import type { ClientCommand, ServerEvent, TranscriptEvent } from '../../src/types/bridge';

test('Mission Control follows new output only while the reader is at the bottom', async ({
  page,
}) => {
  const appSessionId = 'mission-scroll';
  const startedAt = Date.now();
  const mission = sessionSummary(appSessionId, {
    cwd: '/repo',
    title: 'Mission scrollback',
    sessionPurpose: 'mission-control',
    interactionMode: 'agi',
    phase: 'planning',
    streaming: false,
    createdAt: startedAt,
    updatedAt: startedAt,
  });
  const output = (index: number): TranscriptEvent => ({
    id: `output-${index}`,
    appSessionId,
    sourceSessionId: appSessionId,
    role: 'primary',
    kind: 'text',
    text: `Mission output ${String(index)}`,
    ts: startedAt + index,
  });

  let emit: (event: ServerEvent) => void = () => {
    throw new Error('Mission bridge is not connected');
  };
  await page.addInitScript(() => {
    window.localStorage.setItem('droid-workspaces', JSON.stringify(['/repo']));
  });
  await page.routeWebSocket(
    (url) => url.searchParams.has('bridgeProtocol'),
    (socket) => {
      let seq = 0;
      emit = (event) => {
        seq += 1;
        socket.send(
          JSON.stringify({
            type: 'events.batch',
            generation: 'mission-scroll-test',
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
          emit({ type: 'sessions.list', sessions: [mission], earlierSessionsByCwd: {} });
        }
        if (command.type === 'projects.list') emit({ type: 'projects.snapshot', projects: [] });
        if (command.type === 'session.loadHistory' && command.appSessionId === appSessionId) {
          emit({
            type: 'session.history',
            appSessionId,
            progress: [],
            transcripts: Array.from({ length: 20 }, (_, index) => {
              const replyIndex = (index + 1) * 2;
              return [
                {
                  ...output(replyIndex - 1),
                  author: 'user' as const,
                  text: `Mission request ${String(index + 1)}`,
                },
                output(replyIndex),
              ];
            }).flat(),
          });
        }
      });
    },
  );
  await page.goto(process.env.DROIDEX_TEST_URL || '/');
  await page.getByTestId('session-row').filter({ hasText: mission.title }).click();
  await expect(page.getByRole('heading', { name: mission.title })).toBeVisible();

  const scrollback = page
    .getByRole('heading', { name: mission.title })
    .locator('../..')
    .locator('div.overflow-y-auto');
  const position = () => scrollback.evaluate((el) => el.scrollTop);
  const remaining = () =>
    scrollback.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop);
  const scrollTo = (edge: 'top' | 'bottom') =>
    scrollback.evaluate(
      (el, edge) =>
        new Promise<void>((resolve) => {
          el.addEventListener('scroll', () => resolve(), { once: true });
          el.scrollTop = edge === 'top' ? 0 : el.scrollHeight;
        }),
      edge,
    );

  await expect(page.getByText('Mission output 40', { exact: true })).toBeInViewport();
  await expect.poll(remaining).toBeLessThan(80);

  await scrollTo('top');
  await expect(page.getByText('Mission request 1', { exact: true })).toBeInViewport();
  emit({ type: 'session.updated', session: { ...mission, streaming: true } });
  await expect(page.getByText('Orchestrator working', { exact: true })).toBeVisible();
  await expect.soft.poll(position).toBe(0);

  if ((await position()) !== 0) await scrollTo('top');
  const previousHeight = await scrollback.evaluate((el) => el.scrollHeight);
  emit({ type: 'event.appended', event: { ...output(41), kind: 'status' } });
  await expect
    .poll(() => scrollback.evaluate((el) => el.scrollHeight))
    .toBeGreaterThan(previousHeight);
  await expect.soft.poll(position).toBe(0);

  if ((await remaining()) >= 2) await scrollTo('bottom');
  emit({ type: 'event.appended', event: { ...output(42), kind: 'status' } });
  await expect(page.getByText('Mission output 42', { exact: true })).toBeInViewport();
  await expect.poll(remaining).toBeLessThan(2);
});
