import { expect, test, type Page } from '@playwright/test';
import type {
  ClientCommand,
  ServerEvent,
  SessionSummary,
  TranscriptEvent,
} from '@droidex/protocol';
import { CONVERSATION_LIST_PIN_THRESHOLD_PX } from '../../src/components/conversationListState';
import { sessionSummary } from '../../src/test/sessionSummary';

async function mockMissionBridge(page: Page, mission: SessionSummary, history: TranscriptEvent[]) {
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
            generation: 'mission-control-test',
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
        if (
          command.type === 'session.loadHistory' &&
          command.appSessionId === mission.appSessionId
        ) {
          emit({
            type: 'session.history',
            appSessionId: mission.appSessionId,
            progress: [],
            transcripts: history,
          });
        }
      });
    },
  );
  return (event: ServerEvent) => emit(event);
}

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
  const emit = await mockMissionBridge(
    page,
    mission,
    Array.from({ length: 20 }, (_, index) => {
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
  );
  await page.goto(process.env.DROIDEX_TEST_URL || '/');
  await page.getByTestId('session-row').filter({ hasText: mission.title }).click();
  await expect(page.getByRole('heading', { name: mission.title })).toBeVisible();

  const latestReply = page.getByRole('paragraph').filter({ hasText: /^Mission output 40$/ });
  await expect(latestReply).toBeInViewport();
  const scrollback = await latestReply.evaluateHandle((row) => {
    for (let parent = row.parentElement; parent; parent = parent.parentElement) {
      const { overflowY } = getComputedStyle(parent);
      if (overflowY === 'auto' || overflowY === 'scroll') return parent;
    }
    throw new Error('Could not find the transcript scroller');
  });
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

  await expect.poll(remaining).toBeLessThan(CONVERSATION_LIST_PIN_THRESHOLD_PX);

  await scrollTo('top');
  await expect(page.getByText('Mission request 1', { exact: true })).toBeInViewport();
  emit({ type: 'session.updated', session: { ...mission, streaming: true } });
  await expect(page.getByText('Orchestrator working', { exact: true })).toBeVisible();
  await expect.poll(position).toBe(0);

  const previousHeight = await scrollback.evaluate((el) => el.scrollHeight);
  emit({ type: 'event.appended', event: { ...output(41), kind: 'status' } });
  await expect
    .poll(() => scrollback.evaluate((el) => el.scrollHeight))
    .toBeGreaterThan(previousHeight);
  await expect.poll(position).toBe(0);

  await scrollTo('bottom');
  emit({ type: 'event.appended', event: { ...output(42), kind: 'status' } });
  await expect(page.getByText('Mission output 42', { exact: true })).toBeInViewport();
  await expect.poll(remaining).toBeLessThan(2);
});

test('Features and Context rows are reachable without extra scroll stops', async ({ page }) => {
  const mission = sessionSummary('mission-row-keyboard', {
    cwd: '/repo',
    title: 'Keyboard row navigation',
    sessionPurpose: 'mission-control',
    interactionMode: 'agi',
    features: Array.from({ length: 2 }, (_, index) => ({
      id: `feature-${String(index)}`,
      description: `Keyboard feature ${String(index)}`,
      skillName: `Keyboard feature ${String(index)}`,
      status: 'pending',
      preconditions: [],
      expectedBehavior: [],
      verificationSteps: [],
    })),
  });
  await mockMissionBridge(page, mission, []);
  await page.goto(process.env.DROIDEX_TEST_URL || '/');
  await page.getByTestId('session-row').filter({ hasText: mission.title }).click();
  const cases = [
    {
      title: 'Features',
      controlBefore: 'Collapse',
      rows: [{ name: /Keyboard feature 0/ }, { name: /Keyboard feature 1/ }],
    },
    {
      title: 'Context',
      controlBefore: 'Expand',
      rows: [
        { name: 'VS Code', exact: true },
        { name: 'No repo', exact: true },
      ],
    },
  ];
  for (const { title, controlBefore, rows } of cases) {
    const sidebar = page.locator('aside').filter({ hasText: title });
    const expand = sidebar.getByRole('button', { name: 'Expand', exact: true });
    await sidebar.getByRole('button', { name: controlBefore, exact: true }).focus();
    for (const row of rows) {
      await page.keyboard.press('Tab');
      await expect(sidebar.getByRole('button', row)).toBeFocused();
    }
    await expand.click();
    const dialog = page.getByRole('dialog', { name: title, exact: true });
    const close = dialog.getByRole('button', { name: `Close ${title}`, exact: true });
    await expect(close).toBeFocused();
    for (const row of rows) {
      await page.keyboard.press('Tab');
      await expect(dialog.getByRole('button', row)).toBeFocused();
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(expand).toBeFocused();
  }
});

test('expanded file diffs can be scrolled from the keyboard and return focus on Escape', async ({
  page,
}) => {
  const appSessionId = 'mission-diff-keyboard';
  const mission = sessionSummary(appSessionId, {
    cwd: '/repo',
    title: 'Keyboard diff review',
    sessionPurpose: 'mission-control',
    interactionMode: 'agi',
  });
  const edit: TranscriptEvent = {
    id: 'edit',
    appSessionId,
    sourceSessionId: appSessionId,
    role: 'primary',
    kind: 'tool_call',
    toolName: 'Edit',
    toolUseId: 'edit',
    ts: 1,
    toolArgs: {
      file_path: '/repo/src/recovery.ts',
      old_string: 'const enabled = false;',
      new_string: Array.from(
        { length: 150 },
        (_, index) => `const scenario${String(index)} = true;`,
      ).join('\n'),
    },
  };
  await mockMissionBridge(page, mission, [edit]);
  await page.goto(process.env.DROIDEX_TEST_URL || '/');
  await page.getByTestId('session-row').filter({ hasText: mission.title }).click();
  await page.getByRole('button', { name: /^Worked/ }).click();
  const trigger = page.getByRole('button', { name: 'Edit src/recovery.ts', exact: true });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'src/recovery.ts', exact: true });
  const close = dialog.getByRole('button', { name: 'Close src/recovery.ts', exact: true });
  const scroller = dialog.getByRole('region', { name: 'Diff for src/recovery.ts' });
  await expect(close).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(scroller).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  const position = await scroller.evaluate((el) => el.scrollTop);
  await page.keyboard.press('PageDown');
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(position);
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
