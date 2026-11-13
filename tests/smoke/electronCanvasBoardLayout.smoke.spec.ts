// The board's layout tools against the harness: a selection dragged as one,
// picking every frame, the box a multiple selection is measured by, resizing
// from any edge or to a typed size, the zoom bar and keys, the board's tools
// holding their corners, and undoing a placement.

import { expect, test, type Locator, type Page } from '@playwright/test';
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

/** Whether a press at the middle of what the locator draws would reach it. */
async function isOnTop(locator: Locator) {
  const { x, y, width, height } = await box(locator);
  return locator.evaluate(
    (element, point) => element.contains(document.elementFromPoint(point.x, point.y)),
    { x: x + width / 2, y: y + height / 2 },
  );
}

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

test('held Alt measures from the selection to the frame under the pointer, only while it is held', async ({
  page,
}) => {
  await openBoard(page);
  await page.evaluate(() => window.boardHarness.select(['a']));
  const pills = page.locator('.canvas-snap-pill');
  const overFrame = async (name: string) => {
    const sheet = await box(frame(page, name).locator('.canvas-sheet'));
    await page.mouse.move(sheet.x + sheet.width / 2, sheet.y + sheet.height / 2);
  };
  await overFrame('B');
  await expect(pills).toHaveCount(0);

  // A ends at x 500 and B starts at 650. Across, A's top is 250 above B's and its bottom 50 below B's top.
  await page.keyboard.down('Alt');
  await expect(pills).toHaveText(['150', '250', '50']);
  // Over the selection itself there is nothing to measure.
  await overFrame('A');
  await expect(pills).toHaveCount(0);
  // B over A's lower right: each of A's edges to the nearer edge of B.
  await page.evaluate(() => {
    window.boardHarness.publish('b', { x: 450, y: 300, width: 300, height: 200 }, 4);
  });
  await page.clock.runFor(32);
  await page.mouse.move(1100, 900);
  await overFrame('B');
  await expect(pills).toHaveText(['350', '50', '250', '50']);
  await page.keyboard.up('Alt');
  await expect(pills).toHaveCount(0);

  // An Alt let go in another app sends no keyup, so leaving the window lets go of it.
  await page.keyboard.down('Alt');
  await expect(pills).toHaveCount(4);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(pills).toHaveCount(0);
  await page.keyboard.up('Alt');

  // A distance with room sits on its line; five board pixels have none, so it sits beside.
  await page.keyboard.down('Alt');
  await expect(pills.first()).toHaveText('350');
  await expect(pills.first()).not.toHaveAttribute('data-beside');
  await page.evaluate(() => {
    window.boardHarness.publish('b', { x: 505, y: 300, width: 300, height: 200 }, 5);
  });
  await page.clock.runFor(32);
  await page.mouse.move(1100, 900);
  await overFrame('B');
  await expect(pills.filter({ hasText: /^5$/ })).toHaveAttribute('data-beside', '');
  await page.keyboard.up('Alt');
});

test('Escape lets go of the distances held Alt shows before it closes a menu under them', async ({
  page,
}) => {
  await openBoard(page);
  await page.evaluate(() => window.boardHarness.select(['a']));
  await page.getByRole('button', { name: 'Size 400 × 300' }).click();
  const width = page.getByRole('textbox', { name: 'Width' });
  await expect(width).toBeFocused();
  const sheet = await box(frame(page, 'B').locator('.canvas-sheet'));
  await page.mouse.move(sheet.x + sheet.width / 2, sheet.y + sheet.height / 2);
  await page.keyboard.down('Alt');
  const pills = page.locator('.canvas-snap-pill');
  await expect(pills).toHaveCount(3);

  await page.keyboard.press('Escape');
  await expect(pills).toHaveCount(0);
  await expect(width).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(width).toHaveCount(0);
  await page.keyboard.up('Alt');
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

  // The next drag starts from the unanswered write, where the frame is drawn,
  // and is written once that one lands, at the layout version it leaves.
  await dragHandle(page, 'west', -45, 0);
  await page.evaluate(() => window.boardHarness.answer(0));
  await expect.poll(() => arrangeCount(page)).toBe(2);
  expect((await arranged(page, 1)).a).toEqual({ x: 100, y: 100, width: 400, height: 250 });
  expect(
    await page.evaluate(() => window.boardHarness.calls[1].frames[0].expectedLayoutVersion),
  ).toBe(4);
});

test('a re-drag held while the write it started on is answered is written at the version that answer left', async ({
  page,
}) => {
  await openBoard(page);
  await dragLabel(page, 'A', 45, 45);
  await expect.poll(() => arrangeCount(page)).toBe(1);
  const label = await box(frame(page, 'A').locator('[data-frame-header]'));
  await page.mouse.move(label.x + 30, label.y + 8);
  await page.mouse.down();
  await page.mouse.move(label.x + 75, label.y + 8);
  await page.clock.runFor(32);
  // The answer draws A where the hold found it, so the hold goes on.
  await page.evaluate(() => window.boardHarness.answer(0));
  await page.clock.runFor(32);
  await page.mouse.move(label.x + 90, label.y + 8);
  await page.clock.runFor(32);
  await page.mouse.up();
  await expect.poll(() => arrangeCount(page)).toBe(2);
  const versions = await page.evaluate(() =>
    window.boardHarness.calls.map((call) => call.frames[0].expectedLayoutVersion),
  );
  expect(versions).toEqual([3, 4]);
});

/** The board's zoom as drawn, which only the stage has until a wheel goes quiet. */
const liveScale = (page: Page) =>
  page
    .locator('[data-testid="canvas-board"] > [style*="transform-origin"]')
    .evaluate((stage) =>
      Number(/scale\(([\d.]+)\)/.exec((stage as HTMLElement).style.transform)?.[1]),
    );

/**
 * Presses at `origin`, travels `travel` screen pixels right, pinches in at the
 * pointer, moves one pixel more and lets go, with ⌘ held so nothing snaps.
 * Answers the zoom before and after the pinch.
 */
async function dragThroughPinch(page: Page, origin: { x: number; y: number }, travel: number) {
  await page.mouse.move(origin.x, origin.y);
  await page.mouse.down();
  await page.keyboard.down('Meta');
  const pointer = { x: origin.x + travel, y: origin.y };
  await page.mouse.move(pointer.x, pointer.y);
  await page.clock.runFor(32);
  const before = await liveScale(page);
  await page.getByTestId('canvas-board').evaluate((root, { x, y }) => {
    root.dispatchEvent(
      new WheelEvent('wheel', {
        clientX: x,
        clientY: y,
        deltaY: -40,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, pointer);
  await page.clock.runFor(32);
  const after = await liveScale(page);
  await page.mouse.move(pointer.x + 1, pointer.y);
  await page.clock.runFor(32);
  await page.mouse.up();
  await page.keyboard.up('Meta');
  return { before, after };
}

test('a pinch at the pointer mid-drag keeps the distance already dragged, for a move and a resize', async ({
  page,
}) => {
  await openBoard(page);
  const label = await box(frame(page, 'A').locator('[data-frame-header]'));
  const move = await dragThroughPinch(
    page,
    { x: Math.round(label.x + 30), y: Math.round(label.y + 8) },
    180,
  );
  expect(move.after).toBeGreaterThan(move.before);
  await expect.poll(() => arrangeCount(page)).toBe(1);
  // The 180 pixels in board units at the zoom they were dragged at, and the last one at the new zoom.
  const moved = (await arranged(page, 0)).a.x;
  expect(Math.abs(moved - (100 + 180 / move.before + 1 / move.after))).toBeLessThanOrEqual(1);

  await page.evaluate(() => {
    window.boardHarness.answer(0);
    window.boardHarness.select(['a']);
  });
  await page.clock.runFor(32);
  const grip = await box(page.locator('[data-handle="southeast"]'));
  const resize = await dragThroughPinch(
    page,
    { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 },
    90,
  );
  await expect.poll(() => arrangeCount(page)).toBe(2);
  const width = (await arranged(page, 1)).a.width;
  expect(Math.abs(width - (400 + 90 / resize.before + 1 / resize.after))).toBeLessThanOrEqual(1);
});
test('the selected frame keeps its size and corners over a neighbour, and its edges leave the neighbour its presses', async ({
  page,
}) => {
  await openBoard(page);
  // B over A's lower right, across its southeast corner and the size under its bottom edge.
  await page.evaluate(() => {
    window.boardHarness.publish('b', { x: 250, y: 200, width: 400, height: 300 }, 4);
    window.boardHarness.select(['a']);
  });
  await page.clock.runFor(32);
  const size = page.getByRole('button', { name: 'Size 400 × 300' });
  const corner = page.locator('[data-handle="southeast"]');
  expect(await isOnTop(size)).toBe(true);
  expect(await isOnTop(corner)).toBe(true);

  // Held mid-move, A still draws its size and corners over B.
  const before = await box(frame(page, 'A'));
  const label = await box(frame(page, 'A').locator('[data-frame-header]'));
  await page.mouse.move(label.x + 30, label.y + 8);
  await page.mouse.down();
  await page.mouse.move(label.x + 50, label.y + 18);
  await page.clock.runFor(32);
  expect((await box(frame(page, 'A'))).x).toBeGreaterThan(before.x);
  expect(await isOnTop(size)).toBe(true);
  expect(await isOnTop(corner)).toBe(true);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await page.clock.runFor(32);

  // The corner resizes A, not B; 45 screen pixels at about 90% are 50 board pixels.
  await dragHandle(page, 'southeast', 45, 45);
  await expect.poll(() => arrangeCount(page)).toBe(1);
  expect((await arranged(page, 0)).a).toEqual({ x: 100, y: 50, width: 450, height: 350 });
  expect(await selection(page)).toEqual(['a']);

  // Along A's bottom edge, clear of the corner and the size, a press picks B.
  const resized = await box(frame(page, 'A'));
  await page.mouse.click(resized.x + resized.width * 0.85, resized.y + resized.height);
  expect(await selection(page)).toEqual(['b']);
  expect(await arrangeCount(page)).toBe(1);
});

test('newer layout for a held frame ends the hold where that layout puts it, through Escape and later renders', async ({
  page,
}) => {
  await openBoard(page);
  const drawnStyle = () =>
    frame(page, 'A').evaluate((node) => {
      const { left, top, width, height } = (node as HTMLElement).style;
      return { left, top, width, height };
    });
  const label = await box(frame(page, 'A').locator('[data-frame-header]'));
  await page.mouse.move(label.x + 30, label.y + 8);
  await page.mouse.down();
  await page.mouse.move(label.x + 90, label.y + 48);
  await page.clock.runFor(32);
  await page.evaluate(() => {
    window.boardHarness.publish('a', { x: 700, y: 400, width: 500, height: 350 }, 4);
  });
  await page.clock.runFor(32);
  const moved = { left: '700px', top: '400px', width: '500px', height: '350px' };
  expect(await drawnStyle()).toEqual(moved);
  await page.mouse.move(label.x + 150, label.y + 98);
  await page.clock.runFor(32);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await page.clock.runFor(32);
  expect(await drawnStyle()).toEqual(moved);
  // A render that leaves A's rect alone must not find it drawn elsewhere.
  await page.evaluate(() => {
    window.boardHarness.select(['a']);
  });
  await page.clock.runFor(32);
  expect(await drawnStyle()).toEqual(moved);
  expect(await arrangeCount(page)).toBe(0);
});

test('a frame that joined the open board keeps its size and corners over a later neighbour', async ({
  page,
}) => {
  // With motion on, both frames arrive with an animation; once it ends, the
  // first must not be left a stacking context that traps its chrome under the second.
  await openBoard(page, 14, 'no-preference');
  await page.evaluate(() => {
    window.boardHarness.arrive('first', { x: 100, y: 400, width: 300, height: 200 });
    window.boardHarness.arrive('later', { x: 200, y: 500, width: 300, height: 200 });
  });
  for (const designId of ['first', 'later']) {
    await page
      .locator(`[data-design-frame="${designId}"]`)
      .evaluate((node) => Promise.all(node.getAnimations().map((animation) => animation.finished)));
  }
  await page.evaluate(() => window.boardHarness.select(['first']));
  await page.clock.runFor(32);
  expect(await isOnTop(page.getByRole('button', { name: 'Size 300 × 200' }))).toBe(true);
  expect(await isOnTop(page.locator('[data-handle="southeast"]'))).toBe(true);
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

  // The note goes once the values fit.
  await width.fill('320');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Height' }).fill('240');
  await width.press('Enter');
  await expect.poll(() => arrangeCount(page)).toBe(1);
  expect((await arranged(page, 0)).a).toEqual({ x: 100, y: 50, width: 320, height: 240 });
  await expect(width).toHaveCount(0);

  await page.getByRole('button', { name: 'Size 320 × 240' }).click();
  await page.getByRole('menuitem', { name: /^Desktop/ }).click();
  await page.evaluate(() => window.boardHarness.answer(0));
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

  // The zoom menu takes the arrow keys like every menu, past what it cannot do.
  await page.getByRole('button', { name: 'Zoom options' }).click();
  await expect(page.getByRole('menuitem', { name: /^Zoom in/ })).toBeFocused();
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('menuitem', { name: /^Zoom to fit/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await zoomed('90%');
  await expect(page.getByRole('menu', { name: 'Zoom' })).toHaveCount(0);

  // Off the board the keys are the app's.
  await page.locator('#outside').focus();
  await page.keyboard.press('ControlOrMeta+0');
  await zoomed('90%');
});

test('focus reaching a frame out of view never scrolls the board, so its tools keep their corners', async ({
  page,
}) => {
  await openBoard(page);
  await page.evaluate(() => window.boardHarness.select(['a']));
  const board = page.getByTestId('canvas-board');
  const corner = () =>
    page.evaluate(() => {
      const root = document.querySelector<HTMLElement>('[data-testid="canvas-board"]')!;
      const zoom = root.querySelector<HTMLElement>('[role="group"][aria-label="Zoom"]')!;
      const rail = root.querySelector<HTMLElement>('[aria-label="Board input mode"]')!;
      const outer = root.getBoundingClientRect();
      return {
        scroll: [root.scrollLeft, root.scrollTop],
        zoom: [
          zoom.getBoundingClientRect().left - outer.left,
          outer.bottom - zoom.getBoundingClientRect().bottom,
        ],
        rail: [
          rail.getBoundingClientRect().left - outer.left,
          rail.getBoundingClientRect().top - outer.top,
        ],
      };
    });
  const resting = await corner();
  // Pan A and its toolbar well past the board's bottom edge.
  const { x, y, width, height } = await box(board);
  await page.mouse.move(x + width / 2, y + height / 2);
  await page.mouse.wheel(0, -1500);
  await page.clock.runFor(32);
  const rename = page.getByRole('button', { name: 'Rename Design A' });
  expect((await box(rename)).y).toBeGreaterThan(y + height);

  await rename.focus();
  await expect(rename).toBeFocused();
  expect(await corner()).toEqual(resting);
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
