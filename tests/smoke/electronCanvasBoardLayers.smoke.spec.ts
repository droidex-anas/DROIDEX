// The layers panel against the board harness: a row per frame in the canvas's
// order with only the visible ones mounted, picking and lighting frames from
// it, the keyboard's way to a frame and back, renaming, and the rail's toggle.

import { expect, test } from '@playwright/test';
import { boardUrl, serveBoard } from './board/boardPage';

serveBoard();

const selection = (page: import('@playwright/test').Page) =>
  page.evaluate(() => window.boardHarness.interaction().selectedFrameIds);

test('Layers picks, lights and renames frames, and hands the keyboard to the board', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1300, height: 1100 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(boardUrl('font=14&frames=300&layers=1'));
  const board = page.getByTestId('canvas-board');
  await expect(board).toBeVisible();

  const tree = page.getByRole('tree', { name: 'Frames' });
  const row = (name: string) => tree.getByRole('treeitem', { name: `${name}, Ready` });
  await expect(row('Design A')).toBeVisible();
  // 300 frames, and only the rows in view are in the document.
  expect(await tree.getByRole('treeitem').count()).toBeLessThan(60);

  // A click picks the frame; Shift adds one.
  await row('Design B').click();
  expect(await selection(page)).toEqual(['b']);
  await row('Design A').click({ modifiers: ['Shift'] });
  expect(await selection(page)).toEqual(['b', 'a']);
  await expect(row('Design A')).toHaveAttribute('aria-selected', 'true');
  await expect(row('Design X0')).toHaveAttribute('aria-selected', 'false');

  // A row under the pointer lights its frame on the board, and only while it is there.
  const frameA = page.locator('[data-design-frame="a"]');
  await row('Design A').hover();
  await expect(frameA).toHaveAttribute('data-layer-hover', '');
  await board.hover({ position: { x: 600, y: 700 } });
  await expect(frameA).not.toHaveAttribute('data-layer-hover');

  // The arrows walk the rows without picking; Enter takes the board to the row's frame.
  await tree.focus();
  await page.keyboard.press('ArrowDown');
  await expect(tree).toHaveAttribute(
    'aria-activedescendant',
    (await row('Design B').getAttribute('id')) ?? '',
  );
  expect(await selection(page)).toEqual(['b', 'a']);
  await page.keyboard.press('Enter');
  await expect(board).toBeFocused();
  await expect.poll(() => selection(page)).toEqual(['b']);

  // Escape gives the keyboard back to the board, on the row's frame.
  await tree.focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-design-frame="b"] [data-frame-header]')).toBeFocused();

  // F2 renames the row's frame where its name stood, and the tree takes the keyboard back once it saved.
  const label = await row('Design B').getByText('Design B', { exact: true }).boundingBox();
  await tree.focus();
  await page.keyboard.press('F2');
  const field = page.getByRole('textbox', { name: 'Name of Design B' });
  await expect(field).toBeFocused();
  const fieldTextX = await field.evaluate((input) => {
    const style = getComputedStyle(input);
    return (
      input.getBoundingClientRect().left +
      parseFloat(style.borderLeftWidth) +
      parseFloat(style.paddingLeft)
    );
  });
  expect(fieldTextX).toBe(label?.x);
  // The whole row is the field's box: a press on its padding keeps the keyboard in the field.
  await row('Design B').click({ position: { x: 4, y: 4 } });
  await expect(field).toBeFocused();
  await field.fill('Hero');
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => window.boardHarness.renameCalls)).toEqual([
    { mutationId: 'rename', designId: 'b', name: 'Hero', expectedManifestVersion: 1 },
  ]);
  await page.evaluate(() => {
    window.boardHarness.answerRename(0);
  });
  await expect(row('Hero')).toBeVisible();
  await expect(tree).toBeFocused();

  // The rail's Layers tool closes the panel and opens it again, and no frame moves on screen.
  const tool = page.getByRole('button', { name: 'Layers', exact: true });
  await expect(tool).toHaveAttribute('aria-pressed', 'true');
  const opened = await frameA.boundingBox();
  await tool.click();
  await expect(tree).toBeHidden();
  await expect(tool).toHaveAttribute('aria-pressed', 'false');
  expect(await frameA.boundingBox()).toEqual(opened);
  await tool.click();
  await expect(row('Design A')).toBeVisible();
  expect(await frameA.boundingBox()).toEqual(opened);

  // ⌥1 closes it from inside, handing the keyboard to the row's frame.
  await tree.focus();
  await page.keyboard.press('Alt+Digit1');
  await expect(tree).toBeHidden();
  await expect(page.locator('[data-design-frame="b"] [data-frame-header]')).toBeFocused();
});
