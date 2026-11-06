import { expect, test } from '@playwright/test';
import { boardUrl, serveBoard } from './board/boardPage';

serveBoard();

test('probe pan', async ({ page }) => {
  await page.setViewportSize({ width: 1300, height: 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(boardUrl('font=14&presence=1&scheme=light'));
  await expect(page.locator('.canvas-presence')).toHaveCount(2);
  await page.mouse.move(600, 500);
  await page.mouse.wheel(-900, 0);
  await page.waitForTimeout(600);
  console.log('after pan', await page.locator('.canvas-presence').count(), await page.getByText('Kairo', { exact: true }).count(), await page.getByText('Lyra', { exact: true }).count());
  await page.screenshot({ path: '/tmp/presence-shots/pan.png' });
});
test('probe reduced', async ({ page }) => {
  await page.setViewportSize({ width: 1300, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(boardUrl('font=14&presence=1&scheme=dark'));
  await expect(page.locator('.canvas-presence')).toHaveCount(2);
  await page.waitForTimeout(300);
  console.log('reduced anims', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.canvas-presence')].map((e) => [getComputedStyle(e).opacity, e.getAnimations({ subtree: true }).length]))));
});
