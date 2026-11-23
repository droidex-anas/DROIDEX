import { expect, test, type Locator, type Page } from '@playwright/test';

// The PR workspace with one open pull request: the bridge connects with no
// chats, and the desktop's GitHub calls answer from a fixture. Every other
// desktop call stays pending, so the shell renders without a laptop behind it.
async function openPullRequests(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem('droid-workspaces', JSON.stringify(['/repo']));
  });
  await page.routeWebSocket(
    (url) => url.searchParams.has('bridgeProtocol'),
    (socket) => {
      let seq = 0;
      const emit = (event: object) => {
        seq += 1;
        socket.send(
          JSON.stringify({
            type: 'events.batch',
            generation: 'pr-tabs-test',
            firstSeq: seq,
            lastSeq: seq,
            events: [{ seq, event }],
          }),
        );
      };
      socket.onMessage((message) => {
        if (typeof message !== 'string') return;
        const command = JSON.parse(message) as { type: string };
        if (command.type === 'connect') emit({ type: 'connection', status: 'connected' });
        if (command.type === 'projects.list') emit({ type: 'projects.snapshot', projects: [] });
        if (command.type === 'sessions.list') {
          emit({ type: 'sessions.list', sessions: [], earlierSessionsByCwd: {} });
        }
      });
    },
  );
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Pull requests', exact: true })).toBeVisible();
  // Installed once the app is up, so start-up runs as the browser build.
  await page.evaluate(() => {
    const pending = () => {
      const result = Object.assign(() => undefined, {
        then: () => result,
        catch: () => result,
        finally: () => result,
      });
      return result;
    };
    const pr = {
      number: 42,
      title: 'Keep release notes in sync',
      state: 'OPEN',
      url: 'https://github.com/example/project/pull/42',
      isDraft: false,
      headRefName: 'release-notes',
      baseRefName: 'main',
      mergeable: 'MERGEABLE',
      reviewDecision: 'REVIEW_REQUIRED',
      additions: 12,
      deletions: 3,
      changedFiles: 1,
      createdAt: null,
      updatedAt: null,
      author: 'contributor',
      reviewRequests: ['reviewer'],
      reviews: [],
      checks: 'pass',
    };
    const calls = {
      remoteBrowser: undefined,
      openBridgeSocket: undefined,
      githubAvailable: async () => ({ installed: true, authenticated: true, installMethod: null }),
      githubListPrs: async () => ({ ok: true, viewerLogin: 'reviewer', prs: [pr] }),
      githubViewPr: async () => ({ ok: true, pr: { ...pr, body: '', commits: [] } }),
      githubPrChecks: async () => ({ ok: true, checks: [] }),
      githubPrComments: async () => ({ ok: true, comments: [] }),
      githubPrDiff: async () => ({ ok: true, diff: '' }),
      gitWorktrees: async (path: string) => [{ path, isMain: true, bare: false, branch: 'main' }],
      repoStatus: async () => null,
    };
    Object.assign(window, {
      droidex: new Proxy(calls, {
        get: (target, key) => (key in target ? target[key as keyof typeof target] : pending),
      }),
    });
  });
  await page.getByRole('button', { name: 'Pull requests', exact: true }).click();
}

async function expectSelected(tablist: Locator, name: string): Promise<void> {
  const tab = tablist.getByRole('tab', { name, exact: true });
  await expect(tab).toBeFocused();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(tablist.locator('[role="tab"][tabindex="0"]')).toHaveText(name);
}

test('the inbox filters are one tab stop that the arrows move through and wrap', async ({
  page,
}) => {
  await openPullRequests(page);
  const filters = page.getByRole('tablist', { name: 'Pull request filters', exact: true });
  await page.getByRole('button', { name: 'Refresh', exact: true }).first().focus();
  await page.keyboard.press('Shift+Tab');
  await expectSelected(filters, 'All');

  await page.keyboard.press('ArrowRight');
  await expectSelected(filters, 'Reviewing');
  await expect(page.getByRole('tabpanel', { name: 'Reviewing', exact: true })).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expectSelected(filters, 'Backlog');
  await page.keyboard.press('ArrowRight');
  await expectSelected(filters, 'All');

  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Refresh', exact: true }).first()).toBeFocused();
});

test('the detail views switch with the arrows and keep their number shortcuts', async ({
  page,
}) => {
  await openPullRequests(page);
  await page.getByRole('button').filter({ hasText: 'Keep release notes in sync' }).first().click();
  const views = page.getByRole('tablist', { name: 'Pull request views', exact: true });
  await views.getByRole('tab', { name: 'Summary', exact: true }).focus();

  await page.keyboard.press('ArrowRight');
  await expectSelected(views, 'Code');
  await expect(page.getByRole('tabpanel', { name: 'Code', exact: true })).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expectSelected(views, 'Summary');
  await page.keyboard.press('ArrowLeft');
  await expectSelected(views, 'Code');

  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Refresh', exact: true }).last()).toBeFocused();
  await page.keyboard.press('1');
  await expect(views.getByRole('tab', { name: 'Summary', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  // A shortcut can select Code while Summary keeps focus; the arrows move from the focused tab.
  await views.getByRole('tab', { name: 'Summary', exact: true }).click();
  await page.keyboard.press('2');
  await page.keyboard.press('ArrowRight');
  await expectSelected(views, 'Code');
});
