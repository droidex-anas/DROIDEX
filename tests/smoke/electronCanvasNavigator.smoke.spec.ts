// The chat column's Components tab against the board harness: every frame
// listed with its state, only the visible rows mounted, search, and the
// keyboard's way from the list to a frame on the board.

import { expect, test } from '@playwright/test';
import { boardUrl, serveBoard } from './board/boardPage';

serveBoard();

test('Components lists every frame, finds one by name and focuses it on the board', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1300, height: 1100 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(boardUrl('font=14&frames=300&navigator=1'));
  const board = page.getByTestId('canvas-board');
  await expect(board).toBeVisible();

  await page.getByRole('tab', { name: 'Components' }).click();
  const list = page.getByRole('listbox', { name: 'Frames' });
  await expect(list.getByRole('option', { name: 'Design A, Ready' })).toBeVisible();
  // 300 frames, and only the rows in view are in the document.
  expect(await list.getByRole('option').count()).toBeLessThan(60);

  const search = page.getByRole('combobox', { name: 'Search frames' });
  await search.fill('x150');
  await expect(list.getByRole('option')).toHaveCount(1);
  await expect(list.getByRole('option', { name: 'Design X150, Ready' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.keyboard.press('Enter');
  await expect(board).toBeFocused();
  expect(await page.evaluate(() => window.boardHarness.interaction().selectedFrameIds)).toEqual([
    'x150',
  ]);

  await search.fill('nothing like it');
  await expect(page.getByRole('status').filter({ hasText: 'No frames match' })).toHaveText(
    'No frames match “nothing like it”.',
  );

  // Escape clears the search, and the arrows walk the whole list again.
  await search.focus();
  await page.keyboard.press('Escape');
  await expect(search).toHaveValue('');
  await page.keyboard.press('ArrowDown');
  await expect(list.getByRole('option', { name: 'Design B, Ready' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.keyboard.press('Enter');
  await expect
    .poll(() => page.evaluate(() => window.boardHarness.interaction().selectedFrameIds))
    .toEqual(['b']);
  await expect(list.getByRole('option', { name: 'Design B, Ready' })).toHaveAttribute(
    'data-picked',
    'true',
  );
});
