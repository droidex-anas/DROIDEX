import { expect, test, type Locator, type Page } from '@playwright/test';
import type { ServerEvent, SessionSummary } from '../../src/types/bridge';

const appUrl = process.env.DROIDEX_TEST_URL || '/';

const session: SessionSummary = {
  appSessionId: 'menu-target',
  provider: 'droid',
  providerSessionId: 'menu-target-provider',
  sessionPurpose: 'chat',
  interactionMode: 'auto',
  role: 'primary',
  title: 'Review the sidebar menus',
  goal: 'Move the sidebar menus onto the design system',
  cwd: '/repo',
  workspaceKind: 'git',
  autonomy: 'medium',
  phase: 'completed',
  features: [],
  tokensIn: 0,
  tokensOut: 0,
  contextTokens: 0,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

// The one session the chat list needs, over a mocked bridge: the sidebar draws
// from the session list, which only a connected sidecar provides.
async function sessionBridge(page: Page, sessions: SessionSummary[]): Promise<void> {
  await page.routeWebSocket(
    (url) => url.searchParams.has('bridgeProtocol'),
    (socket) => {
      let sequence = 0;
      const emit = (event: ServerEvent) => {
        sequence += 1;
        socket.send(
          JSON.stringify({
            type: 'events.batch',
            generation: 'sidebar-menu-test',
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
        if (command.type === 'connect') emit({ type: 'connection', status: 'connected' });
        if (command.type === 'sessions.list') {
          emit({ type: 'sessions.list', sessions, earlierSessionsByCwd: {} });
        }
        // The chat list waits for the project graph before it draws, as it does
        // against the real sidecar.
        if (command.type === 'projects.list') emit({ type: 'projects.snapshot', projects: [] });
      });
    },
  );
}

test('loads the DROIDEX shell', async ({ page }) => {
  await page.goto(appUrl);

  await expect(page).toHaveTitle(/DROIDEX/);
  await expect(page.locator('#root')).toBeVisible();
});

// The palette is a centred dialog on the z-dialog layer: its backdrop darkens
// the window without a blur, focus starts in the search field and stays inside,
// and Escape closes it through the shared layer stack.
test('the command palette is a centred dialog that keeps focus inside', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto(appUrl);

  // The primary modifier follows the platform the renderer reports.
  const primary = await page.evaluate(() =>
    navigator.userAgent.includes('Mac OS X') ? 'Meta' : 'Control',
  );
  await page.keyboard.press(`${primary}+k`);
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  const search = page.getByRole('textbox', { name: 'Command palette' });
  await expect(palette).toBeVisible();
  await expect(search).toBeFocused();

  const backdrop = page.locator('.z-dialog');
  await expect(backdrop).toHaveCSS('z-index', '1100');
  await expect(backdrop).toHaveCSS('backdrop-filter', 'none');

  const box = (await palette.boundingBox())!;
  expect(box.y + box.height / 2).toBeCloseTo(400, -1);

  // Tab walks the dialog's own controls, never out into the page behind it.
  for (let step = 0; step < 3; step += 1) {
    await page.keyboard.press('Tab');
    const inside = await palette.evaluate((panel) => panel.contains(document.activeElement));
    expect(inside).toBe(true);
  }

  await search.fill('settings');
  await expect(palette.getByText('Settings', { exact: true })).toBeVisible();
  await expect(palette.getByText('New Thread', { exact: true })).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(palette).toHaveCount(0);
});

// The sidebar's right-click menus are ui/Menu: a right-click anchors them at
// the pointer, the chat row's trailing button anchors its menu to its own right
// edge, and Escape closes either one.
test('the sidebar context menus open at the pointer and from the row button', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('droid-workspaces', JSON.stringify(['/repo']));
  });
  await sessionBridge(page, [session]);
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto(appUrl);

  // The menu fades in while rising 4px, so poll the box until it settles
  // rather than reading it mid-animation.
  const gap = async (locator: Locator, point: { x: number; y: number }) => {
    const box = await locator.boundingBox();
    if (!box) return Number.POSITIVE_INFINITY;
    return Math.max(Math.abs(box.x - point.x), Math.abs(box.y - point.y));
  };

  const workspace = page.getByRole('button', { name: 'repo', exact: true });
  await expect(workspace).toBeVisible();
  const workspaceBox = (await workspace.boundingBox())!;
  const workspacePoint = {
    x: Math.round(workspaceBox.x + 40),
    y: Math.round(workspaceBox.y + 8),
  };
  await page.mouse.click(workspacePoint.x, workspacePoint.y, { button: 'right' });

  const workspaceMenu = page.getByRole('menu', { name: 'repo workspace' });
  await expect(workspaceMenu.getByRole('menuitem')).toHaveText(['Remove workspace']);
  await expect
    .poll(() => gap(workspaceMenu, { x: workspacePoint.x, y: workspacePoint.y + 4 }))
    .toBeLessThan(1.5);
  await page.keyboard.press('Escape');
  await expect(workspaceMenu).toHaveCount(0);

  const row = page.getByTestId('session-row');
  await expect(row).toBeVisible();
  const rowBox = (await row.boundingBox())!;
  const rowPoint = { x: Math.round(rowBox.x + 60), y: Math.round(rowBox.y + 10) };
  await page.mouse.click(rowPoint.x, rowPoint.y, { button: 'right' });

  const menu = page.getByRole('menu', { name: 'Chat actions' });
  await expect(menu.getByRole('menuitem')).toHaveText([
    'Open in new tab',
    'Pin chat',
    'Rename chat',
    'Fork chat',
    'Mark as settled',
    'Archive chat',
    'Copy Working Directory',
    'Copy Session ID',
    'Copy Session Link',
    'Copy as Markdown',
  ]);

  // The menu hangs from the click point with the shared 4px offset.
  await expect.poll(() => gap(menu, { x: rowPoint.x, y: rowPoint.y + 4 })).toBeLessThan(1.5);

  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);

  // The hover "..." button anchors the menu to its own right edge, so the menu
  // stays inside the sidebar instead of hanging off the window.
  const actions = page.getByRole('button', { name: /^Actions for / });
  await row.hover();
  await actions.click();
  await expect(menu).toBeVisible();
  const buttonBox = (await actions.boundingBox())!;
  await expect
    .poll(async () => {
      const box = await menu.boundingBox();
      if (!box) return Number.POSITIVE_INFINITY;
      return Math.abs(box.x + box.width - (buttonBox.x + buttonBox.width));
    })
    .toBeLessThan(1.5);
  await expect
    .poll(async () => (await menu.boundingBox())!.y)
    .toBeGreaterThanOrEqual(buttonBox.y + buttonBox.height);

  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
});

test('slash feedback returns a durable copyable report receipt', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(appUrl);

  const composer = page.getByRole('textbox', { name: 'Prompt' });
  await composer.fill('/');
  await page.getByText('bug', { exact: true }).click();

  const dialog = page.getByRole('dialog');
  const details = page.getByRole('textbox', { name: 'Details' });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('button', { name: 'Bug', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(details).toBeFocused();

  await page.evaluate(() => {
    Reflect.set(window, 'droidex', {
      submitFeedbackReport: async () => ({
        reportId: 'RPT-20260804-A1B2C3D4E5F6',
        userId: 'USR-123456781234',
        eventId: '00112233445566778899aabbccddeeff',
      }),
    });
  });
  await details.fill('The update button stopped responding after download.');
  await page.getByRole('button', { name: 'Submit report' }).click();

  await expect(page.getByRole('heading', { name: 'Report accepted' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Report ID' })).toHaveValue(
    'RPT-20260804-A1B2C3D4E5F6',
  );
  await page.getByRole('button', { name: 'Copy ID' }).click();
  await expect(page.getByRole('button', { name: 'Copied' })).toBeFocused();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe('RPT-20260804-A1B2C3D4E5F6');
});
