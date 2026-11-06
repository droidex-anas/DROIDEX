// The board's layout tools against the harness: a selection dragged as one,
// picking every frame, the box a multiple selection is measured by, resizing
// from any edge or to a typed size, the zoom bar and keys, and undoing a placement.

import { expect, test, type Page } from '@playwright/test';
import type { FrameRect } from '../../src/features/canvas/protocol';
import { box, boardUrl, frame, openBoard, serveBoard, zoomField } from './board/boardPage';

serveBoard();

const selection = (page: Page) =>
  page.evaluate(() => window.boardHarness.interaction().selectedFrameIds);

/** The rects one arrange call wrote, by design. */
async function arranged(page: Page, call: number): Promise<Record<string, FrameRect>> {
  const frames = await page.evaluate((index) => window.boardHarness.calls[index].frames, call);
  return Object.fromEntries(frames.map(({ designId, rect }) => [designId, rect]));
}

/** Presses at a point and moves the hand by screen pixels. */
async function dragFrom(page: Page, origin: { x: number; y: number }, x: number, y: number) {
  await page.mouse.move(origin.x, origin.y);
  await page.mouse.down();
  await page.mouse.move(origin.x + x, origin.y + y);
  await page.clock.runFor(32);
  await page.mouse.up();
}

async function dragLabel(page: Page, name: string, x: number, y: number) {
  const label = await box(frame(page, name).locator('[data-frame-header]'));
  await dragFrom(page, { x: Math.round(label.x + 30), y: Math.round(label.y + 8) }, x, y);
}

async function dragHandle(page: Page, handle: string, x: number, y: number) {
  const grip = await box(page.locator(`[data-handle="${handle}"]`));
  await dragFrom(page, { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 }, x, y);
}

const arrangeCount = (page: Page) => page.evaluate(() => window.boardHarness.calls.length);

test('dragging one frame of a selection moves all of it in one arrange, and a click picks it alone', async ({
  page,
}) => {
  await openBoard(page);
  await page.evaluate(() => window.boardHarness.select(['a', 'b']));
  await dragLabel(page, 'B', 60, 40);

  await expect.poll(() => page.evaluate(() => window.boardHarness.calls.length)).toBe(1);
  const moved = await arranged(page, 0);
  expect(Object.keys(moved).sort()).toEqual(['a', 'b']);
  // One offset for both, in whole pixels, so the pair keeps its arrangement.
  expect(moved.b.x - 650).toBe(moved.a.x - 100);
  expect(moved.b.y - 300).toBe(moved.a.y - 50);
  expect(moved.a.x).toBeGreaterThan(100);
  expect(await selection(page)).toEqual(['a', 'b']);

  // A press that never becomes a drag is a click: it picks that frame alone.
  const label = await box(frame(page, 'A').locator('[data-frame-header]'));
  await page.mouse.click(label.x + 30, label.y + 8);
  expect(await selection(page)).toEqual(['a']);
  expect(await page.evaluate(() => window.boardHarness.calls.length)).toBe(1);
});

test('⌘A selects every frame, and a multiple selection is measured by its own box', async ({
  page,
}) => {
  await openBoard(page);
  // Off the board ⌘A is the page's own.
  await page.locator('#outside').focus();
  await page.keyboard.press('ControlOrMeta+a');
  expect(await selection(page)).toEqual([]);
  await page.getByTestId('canvas-board').focus();
  await page.keyboard.press('ControlOrMeta+a');
  expect(await selection(page)).toEqual(['a', 'b']);

  // A spans x 100 to 500 from y 50, and B x 650 to 1050 down to y 600.
  const bounds = page.locator('.canvas-selection-bounds');
  await expect(bounds).toHaveText('950 × 550');
  // The frames leave their own sizes and resize handles to it.
  await expect(page.locator('[data-design-frame] .canvas-frame-size')).toHaveCount(0);
  await expect(page.locator('[data-handle]')).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(bounds).toHaveCount(0);
});

test('a frame resizes from an edge or a corner, and the edges opposite stay put', async ({
  page,
}) => {
  await openBoard(page);
  await page.evaluate(() => window.boardHarness.select(['a']));
  // 45 screen pixels at the opening zoom, about 90%, are 50 board pixels.
  await dragHandle(page, 'northwest', 45, 45);
  await expect.poll(() => arrangeCount(page)).toBe(1);
  expect((await arranged(page, 0)).a).toEqual({ x: 150, y: 100, width: 350, height: 250 });

  // The next drag starts from the unanswered write, where the frame is drawn.
  await dragHandle(page, 'west', -45, 0);
  await expect.poll(() => arrangeCount(page)).toBe(2);
  expect((await arranged(page, 1)).a).toEqual({ x: 100, y: 100, width: 400, height: 250 });
});

test('the size menu sets a typed size or a screen, each in one arrange from the same corner', async ({
  page,
}) => {
  await openBoard(page);
  await page.evaluate(() => window.boardHarness.select(['a']));
  await page.getByRole('button', { name: 'Size 400 × 300' }).click();
  const width = page.getByRole('textbox', { name: 'Width' });
  await expect(width).toBeFocused();

  // A size no frame can take is refused, and the menu says why.
  await width.fill('40');
  await width.press('Enter');
  await expect(page.getByRole('alert')).toHaveText('Width and height run from 120 to 8192.');
  expect(await arrangeCount(page)).toBe(0);

  await width.fill('320');
  await page.getByRole('textbox', { name: 'Height' }).fill('240');
  await width.press('Enter');
  await expect.poll(() => arrangeCount(page)).toBe(1);
  expect((await arranged(page, 0)).a).toEqual({ x: 100, y: 50, width: 320, height: 240 });
  await expect(width).toHaveCount(0);

  await page.getByRole('button', { name: 'Size 320 × 240' }).click();
  await page.getByRole('menuitem', { name: /^Desktop/ }).click();
  await expect.poll(() => arrangeCount(page)).toBe(2);
  expect((await arranged(page, 1)).a).toEqual({ x: 100, y: 50, width: 1440, height: 900 });
});

test('the zoom bar and the ⌘ zoom keys zoom the board, and a typed percentage goes there', async ({
  page,
}) => {
  await openBoard(page);
  const field = zoomField(page);
  const board = page.getByTestId('canvas-board');
  const zoomed = async (shown: string) => {
    await page.clock.runFor(400);
    await expect(field).toHaveValue(shown);
  };

  await page.getByRole('button', { name: 'Zoom in' }).click();
  await zoomed('100%');
  await page.getByRole('button', { name: 'Zoom out' }).click();
  await zoomed('75%');

  await field.fill('150');
  await field.press('Enter');
  await zoomed('150%');
  await expect(board).toBeFocused();
  // Escape leaves the zoom as it was.
  await field.fill('300');
  await field.press('Escape');
  await zoomed('150%');
  await expect(board).toBeFocused();

  for (const [key, shown] of [
    ['ControlOrMeta+0', '100%'],
    ['ControlOrMeta+1', '90%'],
    ['ControlOrMeta+=', '100%'],
    ['ControlOrMeta+-', '75%'],
  ]) {
    await page.keyboard.press(key);
    await zoomed(shown);
  }

  // Off the board the keys are the app's.
  await page.locator('#outside').focus();
  await page.keyboard.press('ControlOrMeta+0');
  await zoomed('75%');
});

/** Where the board draws a frame, in board pixels. */
function drawnAt(page: Page, name: string) {
  return frame(page, name).evaluate((element) => {
    if (!(element instanceof HTMLElement)) throw new Error('Missing frame');
    return { x: parseFloat(element.style.left), y: parseFloat(element.style.top) };
  });
}

test('a released move is one step: ⌘Z puts the frame back and ⇧⌘Z moves it again', async ({
  page,
}) => {
  await openBoard(page);
  await page.evaluate(() => window.boardHarness.select(['a']));
  await dragLabel(page, 'A', 45, 45);
  await expect.poll(() => arrangeCount(page)).toBe(1);
  const moved = (await arranged(page, 0)).a;
  await page.evaluate(() => window.boardHarness.answer(0));

  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => arrangeCount(page)).toBe(2);
  // Each write expects the layout the one before it left.
  expect(await page.evaluate(() => window.boardHarness.calls[1].frames)).toEqual([
    { designId: 'a', expectedLayoutVersion: 4, rect: { x: 100, y: 50, width: 400, height: 300 } },
  ]);
  await page.evaluate(() => window.boardHarness.answer(1));
  await expect.poll(() => drawnAt(page, 'A')).toEqual({ x: 100, y: 50 });

  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(() => arrangeCount(page)).toBe(3);
  expect(await page.evaluate(() => window.boardHarness.calls[2].frames)).toEqual([
    { designId: 'a', expectedLayoutVersion: 5, rect: moved },
  ]);
  await page.evaluate(() => window.boardHarness.answer(2));
  await expect.poll(() => drawnAt(page, 'A')).toEqual({ x: moved.x, y: moved.y });
});

test('a selection dragged together undoes as one step', async ({ page }) => {
  await openBoard(page);
  await page.evaluate(() => window.boardHarness.select(['a', 'b']));
  await dragLabel(page, 'B', 60, 40);
  await expect.poll(() => arrangeCount(page)).toBe(1);
  await page.evaluate(() => window.boardHarness.answer(0));

  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => arrangeCount(page)).toBe(2);
  expect(await arranged(page, 1)).toEqual({
    a: { x: 100, y: 50, width: 400, height: 300 },
    b: { x: 650, y: 300, width: 400, height: 300 },
  });
  await page.evaluate(() => window.boardHarness.answer(1));
  await expect.poll(() => drawnAt(page, 'B')).toEqual({ x: 650, y: 300 });
  // That was the only step.
  await page.keyboard.press('ControlOrMeta+z');
  await page.clock.runFor(32);
  expect(await arrangeCount(page)).toBe(2);
});

test('a panel docked over the board keeps fit, ⌘0 and ⌘1 to the part it leaves visible', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1300, height: 1100 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(boardUrl('font=14&inset=300'));
  const board = await box(page.getByTestId('canvas-board'));
  const panel = await box(page.locator('[data-harness-inset]'));
  // Both frames together sit centred between the board's left edge and the panel.
  const offCentre = async () => {
    const a = await box(page.locator('[data-design-frame="a"]'));
    const b = await box(page.locator('[data-design-frame="b"]'));
    const left = Math.min(a.x, b.x);
    const right = Math.max(a.x + a.width, b.x + b.width);
    return Math.round((left + right) / 2 - (board.x + panel.x) / 2);
  };
  await expect.poll(offCentre).toBe(0);
  // 950 px of frames in the 700 px left visible, less the fit's padding.
  await expect(zoomField(page)).toHaveValue('59%');

  await page.getByTestId('canvas-board').focus();
  await page.keyboard.press('ControlOrMeta+0');
  await expect(zoomField(page)).toHaveValue('100%');
  expect(await offCentre()).toBe(0);
  await page.keyboard.press('ControlOrMeta+1');
  await expect(zoomField(page)).toHaveValue('59%');
  expect(await offCentre()).toBe(0);
});
