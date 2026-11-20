import { expect, test, type Page } from '@playwright/test';

const appUrl = process.env.DROIDEX_TEST_URL || '/';

// A DROIDEX Remote browser: the preload marks the window as a paired browser,
// and every other desktop call returns a pending result that is also callable
// as an unsubscribe, so the shell renders without a laptop behind it.
async function asRemoteBrowser(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const pending = () => {
      const result = Object.assign(() => undefined, {
        then: () => result,
        catch: () => result,
        finally: () => result,
      });
      return result;
    };
    const remoteBrowser = {
      handle: 'remote-test',
      trustedUntil: () => Date.now() + 60_000,
      notifications: pending,
      setNotifications: pending,
      forget: pending,
    };
    Object.defineProperty(window, 'droidex', {
      value: new Proxy(
        { remoteBrowser },
        { get: (api, key) => (key === 'remoteBrowser' ? api.remoteBrowser : pending) },
      ),
    });
  });
}

async function searchSettings(page: Page, query: string): Promise<void> {
  await page.goto(appUrl);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search settings' }).fill(query);
}

const openTab = (page: Page) => page.locator('nav [aria-current="page"]');

test.describe('settings search in a Remote browser', () => {
  test.beforeEach(async ({ page }) => {
    await asRemoteBrowser(page);
  });

  test('opens the visible match instead of the laptop-only Profile tab', async ({ page }) => {
    await searchSettings(page, 'tokens');

    await expect(page.getByText('1 match')).toBeVisible();
    await expect(openTab(page)).toHaveText('General');
    await expect(page.getByText(/Open DROIDEX on your laptop/)).toHaveCount(0);
  });

  test('stays on the current tab when only laptop-only settings match', async ({ page }) => {
    await searchSettings(page, 'username');

    await expect(page.getByText('No matching settings.')).toBeVisible();
    await expect(page.getByText(/Open DROIDEX on your laptop/)).toHaveCount(0);
  });
});

test('settings search on the laptop still opens Profile for its own settings', async ({ page }) => {
  await searchSettings(page, 'tokens');

  await expect(page.getByText('2 matches')).toBeVisible();
  await expect(openTab(page)).toHaveText('Profile');
});
