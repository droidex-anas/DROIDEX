// Agents at work on the board, against the harness: each working frame wears
// its agent's colour, selection takes the edge over, and the working state
// leaves once the work lands.

import { expect, test, type Locator } from '@playwright/test';
import { frame, openBoard, serveBoard } from './board/boardPage';

serveBoard();

const working = (name: string) => (page: Parameters<typeof frame>[0]) =>
  frame(page, name).locator('.canvas-working');

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

  await page.evaluate(() => window.boardHarness.select(['a']));
  await expect.poll(() => edge(kairo)).toBe(false);
  expect(await edge(lyra)).toBe(true);

  // The designs land and the agents leave: the state fades out and goes.
  await page.evaluate(() => window.boardHarness.finishWork());
  await expect(page.locator('.canvas-working')).toHaveCount(0);
  await expect(frame(page, 'A').getByText('Design A preview')).toBeVisible();
});

test('under reduced motion the working state leaves at once', async ({ page }) => {
  await openBoard(page, 14, 'reduce', '&presence=1');
  await expect(page.locator('.canvas-working')).toHaveCount(2);
  await page.evaluate(() => window.boardHarness.finishWork());
  await expect(page.locator('.canvas-working')).toHaveCount(0);
});
