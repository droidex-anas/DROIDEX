// Deleting frames on the board against the harness: the keys that delete, the
// toast's Undo and ⌘Z, where the keyboard goes, and a refused Undo.

import { expect, test, type Page } from '@playwright/test';
import { frame, openBoard, serveBoard } from './board/boardPage';

serveBoard();

const removeCalls = (page: Page) => page.evaluate(() => window.boardHarness.removeCalls);
const undoCalls = (page: Page) => page.evaluate(() => window.boardHarness.undoCalls);

test('Delete removes the selection once, moves to its neighbour, and Undo brings it back', async ({
  page,
}) => {
  await openBoard(page);
  await page.evaluate(() => window.boardHarness.select(['a']));
  await frame(page, 'A').locator('[data-frame-header]').focus();

  // A second press while the first is on its way sends nothing more.
  await page.keyboard.press('Delete');
  await page.keyboard.press('Backspace');
  expect(await removeCalls(page)).toEqual([{ mutationId: expect.any(String), designIds: ['a'] }]);

  await page.evaluate(() => window.boardHarness.answerRemove(0));
  await expect(frame(page, 'A')).toHaveCount(0);
  const toast = page.getByRole('status').filter({ hasText: 'Deleted Design A' });
  await expect(toast).toBeVisible();
  await expect(frame(page, 'B').locator('[data-frame-header]')).toBeFocused();
  expect(await page.evaluate(() => window.boardHarness.interaction().selectedFrameIds)).toEqual([
    'b',
  ]);
  await expect(page.getByTestId('canvas-board').locator('p[role="status"]')).toHaveText(
    'Design A deleted',
  );

  await toast.getByRole('button', { name: 'Undo' }).click();
  expect(await undoCalls(page)).toEqual([{ mutationId: expect.any(String), undoId: 'undo_0' }]);
  await page.evaluate(() => window.boardHarness.answerUndo(0));
  await expect(frame(page, 'A')).toBeVisible();
  await page.clock.runFor(500);
  await expect(toast).toHaveCount(0);
});

test('⌘Z undoes the latest deletion once, and an occupied place is said plainly', async ({
  page,
}) => {
  await openBoard(page);
  const board = page.getByTestId('canvas-board');
  await page.evaluate(() => window.boardHarness.select(['b']));
  await board.focus();
  await page.keyboard.press('Backspace');
  await page.evaluate(() => window.boardHarness.answerRemove(0));
  await expect(frame(page, 'B')).toHaveCount(0);
  // The last frame in reading order hands the keyboard back to the one before it.
  await expect(frame(page, 'A').locator('[data-frame-header]')).toBeFocused();

  await page.keyboard.press('ControlOrMeta+z');
  await page.evaluate(() => window.boardHarness.answerUndo(0));
  await expect(frame(page, 'B')).toBeVisible();

  await page.evaluate(() => window.boardHarness.select(['b']));
  await board.focus();
  await page.keyboard.press('Delete');
  await page.evaluate(() => window.boardHarness.answerRemove(1));
  await page.keyboard.press('ControlOrMeta+z');
  // Undo is not retried: a second ⌘Z has nothing left to take.
  await page.keyboard.press('ControlOrMeta+z');
  expect((await undoCalls(page)).map((call) => call.undoId)).toEqual(['undo_0', 'undo_1']);
  await page.evaluate(() => window.boardHarness.refuseUndo(1));
  await expect(page.getByText('Something now sits where Design B was.')).toBeVisible();
  await expect(frame(page, 'B')).toHaveCount(0);
});
