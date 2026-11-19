import { expect, test, type Locator, type Page } from '@playwright/test';
import type {
  ChildSessionSummary,
  ClientCommand,
  ServerEvent,
  TranscriptEvent,
} from '@droidex/protocol';
import { sessionSummary } from '../../src/test/sessionSummary';

test.use({
  launchOptions: {
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  },
});

async function mockBridge(
  page: Page,
  onCommand: (command: ClientCommand, emit: (event: ServerEvent) => void) => void | Promise<void>,
) {
  let emit: (event: ServerEvent) => void = () => {
    throw new Error('Scroll test bridge is not connected');
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
            generation: 'follow-latest-test',
            firstSeq: seq,
            lastSeq: seq,
            events: [{ seq, event }],
          }),
        );
      };
      socket.onMessage(async (message) => {
        if (typeof message !== 'string') return;
        const command = JSON.parse(message) as ClientCommand;
        if (command.type === 'connect') emit({ type: 'connection', status: 'connected' });
        if (command.type === 'projects.list') emit({ type: 'projects.snapshot', projects: [] });
        await onCommand(command, emit);
      });
    },
  );
  return (event: ServerEvent) => emit(event);
}

async function checkFollowing(line: (index: number) => Locator, append: (index: number) => void) {
  await expect(line(40)).toBeInViewport();
  const scroll = await line(40).evaluateHandle((row) => {
    for (let parent = row.parentElement; parent; parent = parent.parentElement) {
      if (['auto', 'scroll'].includes(getComputedStyle(parent).overflowY)) return parent;
    }
    throw new Error('Could not find the transcript scroller');
  });
  const remaining = () => scroll.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop);
  const scrollTo = (edge: 'top' | 'bottom') =>
    scroll.evaluate(
      (el, edge) =>
        new Promise<void>((resolve) => {
          el.addEventListener('scroll', () => resolve(), { once: true });
          el.scrollTop = edge === 'top' ? 0 : el.scrollHeight;
        }),
      edge,
    );

  await expect.poll(remaining).toBeLessThan(2);
  await scrollTo('top');
  await expect(line(1)).toBeInViewport();
  const height = await scroll.evaluate((el) => el.scrollHeight);
  append(41);
  await expect.poll(() => scroll.evaluate((el) => el.scrollHeight)).toBeGreaterThan(height);
  await expect.poll(() => scroll.evaluate((el) => el.scrollTop)).toBe(0);
  await expect(line(1)).toBeInViewport();

  await scrollTo('bottom');
  append(42);
  await expect(line(42)).toBeInViewport();
  await expect.poll(remaining).toBeLessThan(2);
}

test('the voice surface follows output only while the reader is at the bottom', async ({
  page,
}) => {
  const appSessionId = 'voice-scroll';
  const session = sessionSummary(appSessionId, { provider: 'codex', cwd: '/repo' });
  const output = (index: number): ServerEvent => ({
    type: 'voice.transcript',
    appSessionId,
    role: index % 2 ? 'user' : 'assistant',
    text: `Output ${String(index)}`,
    final: true,
  });
  const emit = await mockBridge(page, async (command, send) => {
    if (command.type === 'sessions.list') {
      send({ type: 'sessions.list', sessions: [session], earlierSessionsByCwd: {} });
    }
    if (command.type === 'session.loadHistory') {
      send({ type: 'session.history', appSessionId, progress: [], transcripts: [] });
    }
    if (command.type === 'voice.start') {
      // Negotiate locally with a real peer; no microphone or provider service is used.
      const sdp = await page.evaluate(async (offer) => {
        const peer = new RTCPeerConnection();
        try {
          await peer.setRemoteDescription({ type: 'offer', sdp: offer });
          const answer = await peer.createAnswer();
          if (!answer.sdp) throw new Error('The local voice peer produced no answer');
          return answer.sdp;
        } finally {
          peer.close();
        }
      }, command.sdp);
      send({ type: 'voice.answer', appSessionId, attempt: command.attempt, sdp });
      send({ type: 'voice.state', appSessionId, status: 'live' });
      for (let index = 1; index <= 40; index += 1) send(output(index));
    }
  });
  await page.goto(process.env.DROIDEX_TEST_URL || '/');
  await page.getByTestId('session-row').filter({ hasText: session.title }).click();
  await page.getByRole('button', { name: 'Start voice mode', exact: true }).click();
  await page.getByRole('button', { name: 'Open the voice surface', exact: true }).click();
  const surface = page.getByRole('dialog', { name: 'Voice mode', exact: true });
  await checkFollowing(
    (index) => surface.getByText(`Output ${String(index)}`, { exact: true }),
    (index) => emit(output(index)),
  );
  await surface.getByRole('button', { name: 'End voice mode', exact: true }).click();
});

test('the agent pane preserves scrollback and follows output when pinned', async ({ page }) => {
  const appSessionId = 'agent-scroll';
  const session = sessionSummary(appSessionId, { cwd: '/repo', streaming: true });
  const child: ChildSessionSummary = {
    parentAppSessionId: appSessionId,
    childSessionId: 'worker',
    role: 'worker',
    status: 'running',
    label: 'Scroll worker',
    modelId: 'droid-core',
    spawnLink: { kind: 'tool-use', id: 'spawn' },
    transcriptAvailable: true,
    startedAt: 1_000,
    streamFidelity: 'token',
  };
  const output = (index: number): TranscriptEvent => ({
    id: `output-${String(index)}`,
    appSessionId,
    sourceSessionId: child.childSessionId,
    role: 'worker',
    kind: 'text',
    ...(index % 2 ? { author: 'user' as const } : {}),
    text: `Output ${String(index)}`,
    ts: 1_000 + index,
  });
  const emit = await mockBridge(page, (command, send) => {
    if (command.type === 'sessions.list') {
      send({ type: 'sessions.list', sessions: [session], earlierSessionsByCwd: {} });
    }
    if (command.type === 'session.loadHistory') {
      send({
        type: 'session.history',
        appSessionId,
        progress: [],
        childSessions: [child],
        transcripts: [
          {
            id: 'spawn',
            appSessionId,
            sourceSessionId: appSessionId,
            role: 'primary',
            kind: 'tool_call',
            toolName: 'Task',
            toolUseId: 'spawn',
            toolArgs: { subagent_type: 'Scroll worker', description: 'Scroll work' },
            ts: 1_000,
          },
        ],
      });
    }
    if (command.type === 'child.loadHistory') {
      send({
        type: 'session.history',
        appSessionId,
        childSessionId: child.childSessionId,
        progress: [],
        transcripts: Array.from({ length: 40 }, (_, index) => output(index + 1)),
      });
    }
  });
  await page.goto(process.env.DROIDEX_TEST_URL || '/');
  await page.getByTestId('session-row').filter({ hasText: session.title }).click();
  await page
    .getByTestId('agent-dock-line')
    .getByRole('button', { name: /^Agents/ })
    .click();
  await page
    .getByTestId('agent-row')
    .getByTitle('Open Scroll worker\nChild ID: worker', { exact: true })
    .click();
  const surface = page.getByTestId('agent-pane-detail');
  await checkFollowing(
    (index) => surface.getByText(`Output ${String(index)}`, { exact: true }),
    (index) => emit({ type: 'event.appended', event: output(index) }),
  );
});
