import { expect, test, type Page } from '@playwright/test';
import type { ServerEvent, SessionSummary } from '@droidex/protocol';
import { sessionSummary } from '../../src/test/sessionSummary';

const appUrl = process.env.DROIDEX_TEST_URL || '/';
const now = Date.now();
const sessions: SessionSummary[] = [
  sessionSummary('alpha', {
    title: 'Alpha session',
    cwd: '/repo',
    workspaceKind: 'folder',
    provider: 'claude',
    modelId: 'claude-opus-4-5',
    reasoningEffort: 'high',
    fastMode: true,
    phase: 'failed',
    updatedAt: now - 60_000,
  }),
  sessionSummary('beta', {
    title: 'Beta session',
    cwd: '/other',
    workspaceKind: 'folder',
    updatedAt: now - 120_000,
  }),
  sessionSummary('worktree', {
    title: 'Worktree session',
    cwd: '/repo/.worktrees/feature',
    workspaceKind: 'folder',
    updatedAt: now - 180_000,
  }),
];

async function bridge(page: Page) {
  await page.routeWebSocket(
    (url) => url.searchParams.has('bridgeProtocol'),
    (socket) => {
      let sequence = 0;
      const emit = (event: ServerEvent) => {
        sequence += 1;
        socket.send(
          JSON.stringify({
            type: 'events.batch',
            generation: 'sidebar-review-test',
            firstSeq: sequence,
            lastSeq: sequence,
            events: [{ seq: sequence, event }],
          }),
        );
      };
      socket.onMessage((message) => {
        if (typeof message !== 'string') return;
        const command: unknown = JSON.parse(message);
        if (typeof command !== 'object' || command === null || !('type' in command)) return;
        if (command.type === 'connect') {
          emit({ type: 'connection', status: 'connected' });
          emit({
            type: 'provider.status',
            statuses: [
              {
                provider: 'claude',
                readiness: 'ready',
                defaultModelId: 'claude-opus-4-5',
                models: [
                  {
                    id: 'claude-opus-4-5',
                    displayName: 'Opus 4.5',
                    isCustom: false,
                    isDefault: true,
                    supportedReasoningEfforts: ['low', 'medium', 'high'],
                    defaultReasoningEffort: 'high',
                    supportsFastMode: true,
                  },
                ],
              },
            ],
          });
        }
        if (command.type === 'sessions.list') {
          emit({ type: 'sessions.list', sessions, earlierSessionsByCwd: {} });
        }
        if (command.type === 'projects.list') emit({ type: 'projects.snapshot', projects: [] });
        if (command.type === 'catalog.models') {
          emit({
            type: 'catalog.updated',
            catalog: 'models',
            items: [
              {
                id: 'droid-model',
                displayName: 'Droid model',
                isCustom: false,
                isDefault: true,
                supportedReasoningEfforts: ['low', 'medium', 'high'],
                defaultReasoningEffort: 'high',
                supportsFastMode: true,
              },
            ],
          });
        }
      });
    },
  );
}

async function open(page: Page) {
  await page.addInitScript(() => {
    if (!window.localStorage.getItem('droid-workspaces'))
      window.localStorage.setItem('droid-workspaces', JSON.stringify(['/repo', '/other']));
  });
  await bridge(page);
  await page.setViewportSize({ width: 1100, height: 760 });
  await page.goto(appUrl);
  await expect(page.getByText('Alpha session', { exact: true })).toBeVisible();
  await expect(page.getByText('Beta session', { exact: true })).toBeVisible();
}

async function workspaceOrder(page: Page) {
  const positions: { name: string; y: number }[] = [];
  for (const name of ['repo', 'other']) {
    const box = await page.getByRole('button', { name, exact: true }).boundingBox();
    positions.push({ name, y: box?.y ?? Number.POSITIVE_INFINITY });
  }
  return positions.sort((a, b) => a.y - b.y).map((position) => position.name);
}

test('keyboard reorder persists across reload', async ({ page }) => {
  await open(page);

  await expect.poll(() => workspaceOrder(page)).toEqual(['repo', 'other']);
  await page.getByRole('button', { name: 'Move repo workspace' }).press('Alt+ArrowDown');
  await expect.poll(() => workspaceOrder(page)).toEqual(['other', 'repo']);
  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem('droid-workspaces')))
    .toBe(JSON.stringify(['/other', '/repo']));

  await page.reload();
  await expect(page.getByText('Alpha session', { exact: true })).toBeVisible();
  await expect.poll(() => workspaceOrder(page)).toEqual(['other', 'repo']);
});

test('the session hover card names workspace, harness, model, effort, and worktree', async ({
  page,
}) => {
  await open(page);

  await page.getByText('Alpha session', { exact: true }).hover();
  const tooltip = page.getByRole('tooltip');
  await expect(tooltip).toBeVisible({ timeout: 1500 });
  await expect(tooltip).toContainText('Alpha session');
  await expect(tooltip).toContainText('repo');
  await expect(tooltip).toContainText('Workspace');
  await expect(tooltip).toContainText('Claude Code');
  await expect(tooltip).toContainText('Opus 4.5 · high · fast mode');
  await expect(tooltip).toContainText('Failed');

  const box = await tooltip.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 6 });
  await expect(tooltip).toBeVisible();

  await page.getByText('Worktree session', { exact: true }).hover();
  await expect(tooltip).toContainText('Worktree session');
  await expect(tooltip).toContainText('feature');
  await expect(tooltip).toContainText('Worktree');

  await page.keyboard.press('Escape');
  await expect(tooltip).toBeHidden();
});

test('pointer drag reorders workspaces', async ({ page }) => {
  await open(page);
  await expect.poll(() => workspaceOrder(page)).toEqual(['repo', 'other']);

  const grip = page.getByRole('button', { name: 'Move repo workspace' });
  await page.getByText('Alpha session', { exact: true }).hover();
  const gripBox = await grip.boundingBox();
  const target = await page.getByText('Beta session', { exact: true }).boundingBox();
  expect(gripBox).not.toBeNull();
  expect(target).not.toBeNull();
  if (!gripBox || !target) return;
  await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + 12, target.y + target.height + 16, { steps: 16 });
  await page.mouse.up();
  await expect.poll(() => workspaceOrder(page)).toEqual(['other', 'repo']);
});
