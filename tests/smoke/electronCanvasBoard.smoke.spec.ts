import { expect, test, type Locator, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import type { FrameRect } from '../../src/features/canvas/protocol';
import type {} from './board/CanvasBoardHarness';

let server: ViteDevServer;
let url: string;

test.beforeAll(async () => {
  server = await createServer({
    server: { host: '127.0.0.1', port: 0, strictPort: false },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') throw new Error('Missing board server');
  url = `http://127.0.0.1:${address.port}/tests/smoke/board/index.html`;
});

test('window blur and focus leaving the board cancel without arranging and release capture', async ({
  page,
}) => {
  for (const loss of ['window', 'outside']) {
    await openBoard(page);
    const board = page.getByTestId('canvas-board');
    await board.focus();
    const acknowledged = await box(frame(page, 'A'));
    await drag(page, 'A', 60, 40, false);
    expect((await box(frame(page, 'A'))).x).toBeGreaterThan(acknowledged.x);
    expect(await board.evaluate((root) => root.hasPointerCapture(1))).toBe(true);
    if (loss === 'window') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    else await page.locator('#outside').focus();
    await page.mouse.up();
    await page.clock.runFor(32);
    expect(await page.evaluate(() => window.boardHarness.calls)).toEqual([]);
    const restored = await box(frame(page, 'A'));
    expect(restored.x).toBeCloseTo(acknowledged.x, 1);
    expect(restored.y).toBeCloseTo(acknowledged.y, 1);
    expect(await board.evaluate((root) => root.hasPointerCapture(1))).toBe(false);
    await drag(page, 'A');
    expect(await page.evaluate(() => window.boardHarness.calls.length)).toBe(1);
  }
});

test.afterAll(async () => {
  await server?.close();
});

async function openBoard(
  page: Page,
  font = 14,
  reducedMotion: 'reduce' | 'no-preference' = 'reduce',
) {
  await page.setViewportSize({ width: 1300, height: 1100 });
  await page.emulateMedia({ reducedMotion });
  await page.clock.install({ time: new Date('2026-10-07T12:00:00Z') });
  await page.clock.pauseAt(new Date('2026-10-07T12:01:00Z'));
  await page.goto(`${url}?font=${font}`);
  await expect(page.getByTestId('canvas-board')).toBeVisible();
  await page.clock.runFor(32);
}

function frame(page: Page, name: string): Locator {
  return page.getByText(`Design ${name}`, { exact: true }).locator('..').locator('..');
}

async function box(locator: Locator) {
  const rect = await locator.boundingBox();
  if (!rect) throw new Error('Missing frame box');
  return rect;
}

async function drag(page: Page, name: string, x = 60, y = 40, release = true) {
  const header = await box(frame(page, name).locator(':scope > div').first());
  const origin = { x: Math.round(header.x + 30), y: Math.round(header.y + 8) };
  await page.mouse.move(origin.x, origin.y);
  await page.mouse.down();
  await page.mouse.move(origin.x + x, origin.y + y);
  await page.clock.runFor(32);
  if (release) await page.mouse.up();
}

async function wheel(page: Page, x: number, y: number, deltaY: number) {
  await page.getByTestId('canvas-board').evaluate(
    (root, point) => {
      root.dispatchEvent(
        new WheelEvent('wheel', {
          clientX: point.x,
          clientY: point.y,
          deltaY: point.deltaY,
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    { x, y, deltaY },
  );
  await page.clock.runFor(32);
}

async function renderedRect(page: Page, name: string): Promise<FrameRect> {
  return frame(page, name).evaluate((element) => {
    if (!(element instanceof HTMLElement)) throw new Error('Missing frame');
    return {
      x: parseFloat(element.style.left),
      y: parseFloat(element.style.top),
      width: parseFloat(element.style.width),
      height: 300,
    };
  });
}

async function clickFit(page: Page) {
  const button = await box(page.getByRole('button', { name: 'Fit', exact: true }));
  await page.mouse.click(button.x + button.width / 2, button.y + button.height / 2);
}

async function transform(page: Page) {
  return page
    .getByTestId('canvas-board')
    .locator(':scope > div')
    .first()
    .evaluate((root) => {
      if (!(root instanceof HTMLElement)) throw new Error('Missing world layer');
      return root.style.transform;
    });
}

test('Fit suppresses trailing wheel input until quiet, independently of reduced motion or animation', async ({
  page,
}) => {
  for (const motion of ['reduce', 'no-preference'] as const) {
    await openBoard(page, 14, motion);
    const fitted = await transform(page);
    await wheel(page, 400, 300, 20);
    expect(await transform(page)).not.toBe(fitted);
    await clickFit(page);
    for (let trailing = 0; trailing < 5; trailing += 1) {
      await page.clock.runFor(48);
      await wheel(page, 400, 300, 20);
    }
    expect(await transform(page)).toBe(fitted);
    await page.clock.runFor(140);
    await wheel(page, 400, 300, 20);
    expect(await transform(page)).not.toBe(fitted);
  }
});

test('a real Fit click never starts background pan or steals the button capture', async ({
  page,
}) => {
  await openBoard(page);
  const fitted = await transform(page);
  await wheel(page, 400, 300, -30);
  await page.clock.runFor(140);
  expect(await transform(page)).not.toBe(fitted);
  const button = await box(page.getByRole('button', { name: 'Fit', exact: true }));
  await page.mouse.move(button.x + button.width / 2, button.y + button.height / 2);
  await page.mouse.down();
  expect(await page.getByTestId('canvas-board').evaluate((root) => root.hasPointerCapture(1))).toBe(
    false,
  );
  await page.mouse.up();
  await page.clock.runFor(240);
  expect(await transform(page)).toBe(fitted);
  expect(await page.evaluate(() => window.boardHarness.calls)).toEqual([]);
});

test('two deferred releases retain separate holds until each frame receives newer layout', async ({
  page,
}) => {
  await openBoard(page);
  await drag(page, 'A');
  const heldA = await renderedRect(page, 'A');
  await drag(page, 'B', -40, 30);
  const heldB = await renderedRect(page, 'B');
  expect(await renderedRect(page, 'A')).toEqual(heldA);
  expect(await page.evaluate(() => window.boardHarness.calls.length)).toBe(2);
  await page.evaluate(() => {
    window.boardHarness.resolve(0);
    window.boardHarness.publish('b', { x: 700, y: 340, width: 400, height: 300 }, 3);
  });
  await page.clock.runFor(32);
  expect(await renderedRect(page, 'A')).toEqual(heldA);
  expect(await renderedRect(page, 'B')).toEqual(heldB);
  await page.evaluate(() =>
    window.boardHarness.publish('a', { x: 170, y: 95, width: 400, height: 300 }, 4),
  );
  await page.clock.runFor(32);
  expect(await renderedRect(page, 'A')).toEqual({ x: 170, y: 95, width: 400, height: 300 });
  expect(await renderedRect(page, 'B')).toEqual(heldB);
  await page.evaluate(() =>
    window.boardHarness.publish('b', { x: 610, y: 330, width: 400, height: 300 }, 4),
  );
  await page.clock.runFor(32);
  expect(await renderedRect(page, 'B')).toEqual({ x: 610, y: 330, width: 400, height: 300 });
});

test('Escape during a re-drag restores acknowledged geometry, not its earlier hold', async ({
  page,
}) => {
  await openBoard(page);
  const acknowledged = await renderedRect(page, 'A');
  await drag(page, 'A');
  await drag(page, 'A', 25, 20, false);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await page.clock.runFor(32);
  expect(await renderedRect(page, 'A')).toEqual(acknowledged);
  expect(await page.evaluate(() => window.boardHarness.calls.length)).toBe(1);
});

test('obsolete arrange rejections cannot replace newer work or report stale errors', async ({
  page,
}) => {
  await openBoard(page);
  await drag(page, 'A');
  await drag(page, 'A', 30, 20);
  const newest = await renderedRect(page, 'A');
  await page.evaluate(() => window.boardHarness.reject(0));
  await page.clock.runFor(32);
  expect(await renderedRect(page, 'A')).toEqual(newest);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.evaluate(() => {
    window.boardHarness.publish('a', { x: 200, y: 120, width: 400, height: 300 }, 4);
  });
  await page.clock.runFor(32);
  await page.evaluate(() => window.boardHarness.reject(1));
  await page.clock.runFor(32);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(await renderedRect(page, 'A')).toEqual({ x: 200, y: 120, width: 400, height: 300 });
  await drag(page, 'B');
  await page.evaluate(() => window.boardHarness.reject(2));
  await page.clock.runFor(32);
  await expect(page.getByRole('alert')).toHaveText('Arrange rejected');
  expect(await renderedRect(page, 'B')).toEqual({ x: 650, y: 300, width: 400, height: 300 });
});

test('UI zoom preserves pointer anchors and 1:1 frame and background drags at 13/14/16', async ({
  page,
}) => {
  for (const font of [13, 14, 16]) {
    await openBoard(page, font);
    const beforeZoom = await box(frame(page, 'B'));
    const anchor = { x: Math.round(beforeZoom.x), y: Math.round(beforeZoom.y) };
    await wheel(page, anchor.x, anchor.y, 20);
    const afterZoom = await box(frame(page, 'B'));
    const ratio = afterZoom.width / beforeZoom.width;
    expect(afterZoom.x).toBeCloseTo(anchor.x + (beforeZoom.x - anchor.x) * ratio, 1);
    expect(afterZoom.y).toBeCloseTo(anchor.y + (beforeZoom.y - anchor.y) * ratio, 1);
    const beforeDrag = await box(frame(page, 'A'));
    await drag(page, 'A');
    const afterDrag = await box(frame(page, 'A'));
    expect(afterDrag.x - beforeDrag.x).toBeCloseTo(60, 1);
    expect(afterDrag.y - beforeDrag.y).toBeCloseTo(40, 1);
    expect(await page.evaluate(() => window.boardHarness.calls.length)).toBe(1);
    const board = await box(page.getByTestId('canvas-board'));
    await page.mouse.move(Math.round(board.x + 10), Math.round(board.y + 10));
    await page.mouse.down();
    await page.mouse.move(Math.round(board.x + 70), Math.round(board.y + 50));
    await page.mouse.up();
    await page.clock.runFor(32);
    const afterPan = await box(frame(page, 'A'));
    expect(afterPan.x - afterDrag.x).toBeCloseTo(60, 1);
    expect(afterPan.y - afterDrag.y).toBeCloseTo(40, 1);
  }
});
