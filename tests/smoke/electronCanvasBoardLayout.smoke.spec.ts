// The board's layout tools against the harness: a selection dragged as one,
// picking every frame, and the box a multiple selection is measured by.

import { expect, test, type Page } from '@playwright/test';
import type { FrameRect } from '../../src/features/canvas/protocol';
import { box, frame, openBoard, serveBoard } from './board/boardPage';

serveBoard();

const selection = (page: Page) =>
  page.evaluate(() => window.boardHarness.interaction().selectedFrameIds);

/** The rects one arrange call wrote, by design. */
async function arranged(page: Page, call: number): Promise<Record<string, FrameRect>> {
  const frames = await page.evaluate((index) => window.boardHarness.calls[index].frames, call);
  return Object.fromEntries(frames.map(({ designId, rect }) => [designId, rect]));
}

/** Presses a frame's name label and moves the hand by screen pixels. */
async function dragLabel(page: Page, name: string, x: number, y: number) {
  const label = await box(frame(page, name).locator('[data-frame-header]'));
  const origin = { x: Math.round(label.x + 30), y: Math.round(label.y + 8) };
  await page.mouse.move(origin.x, origin.y);
  await page.mouse.down();
  await page.mouse.move(origin.x + x, origin.y + y);
  await page.clock.runFor(32);
  await page.mouse.up();
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
