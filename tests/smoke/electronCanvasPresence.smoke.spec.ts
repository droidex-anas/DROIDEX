// Agents at work on the board, against the harness: each working frame wears
// its agent's colour and its named cursor, selection takes the edge over, and
// the working state leaves once the work lands.

import { expect, test, type Locator } from '@playwright/test';
import { frame, openBoard, serveBoard } from './board/boardPage';

serveBoard();

const working = (name: string) => (page: Parameters<typeof frame>[0]) =>
  frame(page, name).locator('.canvas-working');

/** The agents' cursors and clouds, one per agent at work on a frame on screen. */
const presences = (page: Parameters<typeof frame>[0]) => page.locator('.canvas-presence');

function runningAnimations(page: Parameters<typeof frame>[0]) {
  return presences(page).evaluateAll(
    (layers) => layers.flatMap((layer) => layer.getAnimations({ subtree: true })).length,
  );
}

/** Whether the agent's edge is drawn: selection removes it. */
function edge(state: Locator) {
  return state.evaluate((element) => getComputedStyle(element, '::after').content !== 'none');
}

test('a frame an agent works on wears its colour until the work lands', async ({ page }) => {
  await openBoard(page, 14, 'no-preference', '&presence=1');
  const kairo = working('A')(page);
  const lyra = working('B')(page);

  // Kairo's frame has nothing yet, so it is a blank lattice; Lyra's design stays in view.
  await expect(kairo.getByText('Kairo is working on this frame')).toBeAttached();
  await expect(lyra.getByText('Lyra is working on this frame')).toBeAttached();
  await expect(kairo.locator('.canvas-working-sheet')).toHaveCSS('opacity', '1');
  await expect(lyra.locator('.canvas-working-sheet')).toHaveCSS('opacity', '0');
  expect(await edge(kairo)).toBe(true);
  await expect(presences(page).getByText('Kairo', { exact: true })).toBeVisible();
  await expect(presences(page).getByText('Lyra', { exact: true })).toBeVisible();
  expect(await runningAnimations(page)).toBeGreaterThan(0);

  await page.evaluate(() => window.boardHarness.select(['a']));
  await expect.poll(() => edge(kairo)).toBe(false);
  expect(await edge(lyra)).toBe(true);

  // The designs land and the agents leave: the state fades out and goes.
  await page.evaluate(() => window.boardHarness.finishWork());
  await page.clock.runFor(400);
  await expect(page.locator('.canvas-working')).toHaveCount(0);
  await expect(presences(page)).toHaveCount(0);
  await expect(frame(page, 'A').getByText('Design A preview')).toBeVisible();
});

test('an agent draws nothing over a frame panned off screen', async ({ page }) => {
  await openBoard(page, 14, 'no-preference', '&presence=1');
  await expect(presences(page)).toHaveCount(2);
  await page.mouse.move(600, 500);
  await page.mouse.wheel(-900, 0);
  await page.clock.runFor(400);
  await expect(presences(page)).toHaveCount(1);
  await expect(presences(page).getByText('Kairo', { exact: true })).toBeAttached();
});

test('under reduced motion the agents stand still and leave at once', async ({ page }) => {
  await openBoard(page, 14, 'reduce', '&presence=1');
  await expect(page.locator('.canvas-working')).toHaveCount(2);
  await expect(presences(page)).toHaveCount(2);
  expect(await runningAnimations(page)).toBe(0);
  await page.evaluate(() => window.boardHarness.finishWork());
  await expect(page.locator('.canvas-working')).toHaveCount(0);
  await expect(presences(page)).toHaveCount(0);
});
