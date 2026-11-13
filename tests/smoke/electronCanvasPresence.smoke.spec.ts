// Agents at work on the board, against the harness: each working frame wears
// its agent's colour and its named cursor, selection takes the edge over, the
// working state leaves once the work lands, and a landed write's cursor visits
// what it changed before it goes.

import { expect, test, type Locator, type Page } from '@playwright/test';
import { frame, openBoard, serveBoard, stubGuests } from './board/boardPage';

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
  // The board culls on the view the wheel settles on once it goes quiet.
  await page.clock.runFor(200);
  await page.clock.runFor(400);
  await expect(presences(page)).toHaveCount(1);
  await expect(presences(page).getByText('Kairo', { exact: true })).toBeAttached();
});

/** Live previews whose guests draw Design B's title centred at 35% across and a sixth down. */
async function openWithGuests(page: Page, reducedMotion: 'reduce' | 'no-preference') {
  await stubGuests(page);
  await openBoard(page, 14, reducedMotion, '&presence=1&preview=guest&edit=1');
  await page.evaluate(() => {
    window.boardGuestReady = true;
    window.guestAnswer = (command) =>
      command === 'locate' ? [{ x: 40, y: 30, width: 200, height: 40 }] : null;
  });
  await page.clock.runFor(300);
}

function locates(page: Page) {
  return page.evaluate(() => window.guestCommands.filter(({ command }) => command === 'locate'));
}

/** Lyra's write on Design B lands with its title rewritten, and her call ends. */
async function landLyrasWrite(page: Page, reducedMotion: 'reduce' | 'no-preference') {
  await openWithGuests(page, reducedMotion);
  await page.evaluate(() => window.boardHarness.landWrite('b'));
  // The write's revision renders in a guest of its own before its call ends.
  await page.clock.runFor(300);
  await page.evaluate(() => window.boardHarness.leave());
  await page.clock.runFor(32);
  expect(await locates(page)).toEqual([{ command: 'locate', elementIds: ['el_title'] }]);
}

const TITLE = /translate\(35(\.0*\d*)?%, 16\.66\d*%\)/;

function lyrasCursor(page: Page) {
  return presences(page)
    .filter({ hasText: 'Lyra' })
    .locator('.canvas-presence-track:has(.canvas-presence-cursor)');
}

/** The transform each of Lyra's cursor animations ends on. */
function cursorDestinations(page: Page) {
  return lyrasCursor(page).evaluate((track) =>
    track.getAnimations().map((animation) => {
      const keyframes = (animation.effect as KeyframeEffect).getKeyframes();
      return String(keyframes.at(-1)?.transform);
    }),
  );
}

test("a landed write's cursor visits what it changed, then leaves", async ({ page }) => {
  await landLyrasWrite(page, 'no-preference');

  // Kairo leaves; Lyra stays to visit the title before she goes.
  await expect(presences(page)).toHaveCount(1);
  await expect(presences(page).getByText('Lyra', { exact: true })).toBeVisible();
  await expect.poll(() => cursorDestinations(page)).toEqual([expect.stringMatching(TITLE)]);
  await page.clock.runFor(1100);
  await expect(presences(page)).toHaveCount(0);
});

test("a new write ends the last one's tour, and its cursor wanders again from there", async ({
  page,
}) => {
  await landLyrasWrite(page, 'no-preference');
  await expect.poll(() => cursorDestinations(page)).toEqual([expect.stringMatching(TITLE)]);
  const cursor = lyrasCursor(page);
  await expect
    .poll(() => cursor.evaluate((track) => track.getAnimations()[0]?.playState))
    .toBe('finished');
  const stood = await cursor.evaluate((track) => getComputedStyle(track).transform);

  await page.evaluate(() => window.boardHarness.returnToWork());
  await expect.poll(() => cursorDestinations(page)).not.toEqual([expect.stringMatching(TITLE)]);
  const setsOutFrom = await cursor.evaluate((track) =>
    String((track.getAnimations()[0]?.effect as KeyframeEffect).getKeyframes()[0]?.transform),
  );
  expect(setsOutFrom).toBe(stood);
  await page.clock.runFor(1100);
  await expect(presences(page).getByText('Lyra', { exact: true })).toBeVisible();
  expect(await runningAnimations(page)).toBeGreaterThan(0);
});

test("a user's edit during an agent's call that then stops is no tour of hers", async ({
  page,
}) => {
  await openWithGuests(page, 'no-preference');
  await page.evaluate(() => window.boardHarness.editByUser('b'));
  await page.clock.runFor(300);
  await page.evaluate(() => window.boardHarness.leave());
  await page.clock.runFor(1100);
  await expect(presences(page)).toHaveCount(0);
  expect(await locates(page)).toEqual([]);
});

test('a frame taken off while its tour is found comes back with no one on it', async ({ page }) => {
  await openWithGuests(page, 'no-preference');
  await page.evaluate(() => {
    window.boardHarness.holdSourceReads();
    window.boardHarness.landWrite('b');
  });
  await page.clock.runFor(300);
  await page.evaluate(() => window.boardHarness.leave());
  await expect(presences(page).getByText('Lyra', { exact: true })).toBeVisible();

  await page.evaluate(() => window.boardHarness.takeOff('b'));
  await expect(frame(page, 'B')).toHaveCount(0);
  await page.evaluate(() => window.boardHarness.putBack('b'));
  await page.clock.runFor(1100);
  await expect(presences(page)).toHaveCount(0);
  // Both revisions' reads were waiting, and once answered they find the tour gone.
  expect(await page.evaluate(() => window.boardHarness.releaseSourceReads())).toBe(2);
  await page.clock.runFor(32);
  expect(await locates(page)).toEqual([]);
  await expect(presences(page)).toHaveCount(0);
});

test('under reduced motion a landed write shows its cursor on what changed', async ({ page }) => {
  await landLyrasWrite(page, 'reduce');

  const cursor = presences(page).locator('.canvas-presence-track:has(.canvas-presence-cursor)');
  await expect(cursor).toHaveAttribute('style', TITLE);
  expect(await runningAnimations(page)).toBe(0);
  await page.clock.runFor(700);
  await expect(presences(page)).toHaveCount(0);
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
