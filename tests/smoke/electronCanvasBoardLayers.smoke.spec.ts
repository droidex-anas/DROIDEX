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
  await expect(tree).toBeFocused();
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
  await expect(tool).toHaveAttribute('aria-expanded', 'true');
  const opened = await frameA.boundingBox();
  await tool.click();
  await expect(tree).toBeHidden();
  await expect(tool).toHaveAttribute('aria-expanded', 'false');
  expect(await frameA.boundingBox()).toEqual(opened);
  await tool.click();
  await expect(row('Design A')).toBeVisible();
  expect(await frameA.boundingBox()).toEqual(opened);

  // ⌥1 closes it from inside, handing the keyboard to the row's frame.
  await tree.focus();
  await page.keyboard.press('Alt+Digit1');
  await expect(tree).toBeHidden();
  await expect(page.locator('[data-design-frame="b"] [data-frame-header]')).toBeFocused();
  // And from the board, ⌥1 opens it again.
  await page.keyboard.press('Alt+Digit1');
  await expect(tree).toBeVisible();
});

test('A rename that answers late or loses its frame leaves the next edit and the keyboard in the panel', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1300, height: 1100 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(boardUrl('font=14&frames=4&layers=1'));
  const tree = page.getByRole('tree', { name: 'Frames' });
  const row = (name: string) => tree.getByRole('treeitem', { name: `${name}, Ready` });
  const nameField = (name: string) => page.getByRole('textbox', { name: `Name of ${name}` });

  // A's rename is still out when B's starts, and A's answer leaves B's field and draft alone.
  await row('Design A').dblclick();
  await nameField('Design A').fill('Hero');
  await page.keyboard.press('Enter');
  await row('Design B').dblclick();
  await nameField('Design B').fill('Unsaved B');
  await page.evaluate(() => {
    window.boardHarness.answerRename(0);
  });
  await expect(row('Hero')).toBeVisible();
  await expect(nameField('Design B')).toBeFocused();
  await expect(nameField('Design B')).toHaveValue('Unsaved B');

  // A frame that leaves while renamed ends its rename: the keyboard stays on the tree, and
  // the frame comes back without its field.
  await page.evaluate(() => {
    window.boardHarness.takeOff('b');
  });
  await expect(row('Design B')).toBeHidden();
  await expect(tree).toBeFocused();
  await page.evaluate(() => {
    window.boardHarness.putBack('b');
  });
  await expect(row('Design B')).toBeVisible();
  await expect(nameField('Design B')).toHaveCount(0);
  expect(await page.evaluate(() => window.boardHarness.renameCalls.length)).toBe(1);
});

test('Layers keeps the keyboard on its row through board picks, scrolling and Space', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1300, height: 1100 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(boardUrl('font=14&frames=300&layers=1'));
  const tree = page.getByRole('tree', { name: 'Frames' });
  const row = (name: string) => tree.getByRole('treeitem', { name: `${name}, Ready` });
  const keyboardOn = async (name: string) =>
    expect(tree).toHaveAttribute(
      'aria-activedescendant',
      (await row(name).getAttribute('id')) ?? '',
    );

  // A frame picked on the board far down the list brings its row into view, and F2 renames it.
  await page.evaluate(() => {
    window.boardHarness.select(['x250']);
  });
  await expect(row('Design X250')).toBeInViewport();
  await tree.focus();
  await keyboardOn('Design X250');
  await page.keyboard.press('F2');
  const field = page.getByRole('textbox', { name: 'Name of Design X250' });
  await field.fill('Draft');

  // Scrolled away, the row keeps its field, its draft and the keyboard.
  await tree.evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect(row('Design A')).toBeInViewport();
  await expect(field).toBeFocused();
  await expect(field).toHaveValue('Draft');
  await page.keyboard.press('Escape');
  await expect(tree).toBeFocused();

  // Space picks the row's frame and takes it out again, and the keyboard stays on that row.
  await page.evaluate(() => {
    window.boardHarness.select([]);
  });
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Space');
  await expect.poll(() => selection(page)).toEqual(['b']);
  await page.keyboard.press('Space');
  await expect.poll(() => selection(page)).toEqual([]);
  await keyboardOn('Design B');
});

test('A frame the keyboard leaves Layers for keeps its label and toolbar clear of the rail', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(boardUrl('font=14&layers=1'));
  const tree = page.getByRole('tree', { name: 'Frames' });
  const header = page.locator('[data-design-frame="a"] [data-frame-header]');
  await expect(header).toBeVisible();
  const rail = await page.getByRole('group', { name: 'Board input mode' }).boundingBox();
  const railRight = (rail?.x ?? 0) + (rail?.width ?? 0);
  // Once the board has fitted, Design A moves under the rail's column, still wholly on the board.
  await page.evaluate(() => {
    window.boardHarness.publish('a', { x: 10, y: 50, width: 400, height: 300 }, 2);
  });
  await expect.poll(async () => (await header.boundingBox())?.x).toBeLessThan(railRight);

  await tree.getByRole('treeitem', { name: 'Design A, Ready' }).click();
  await page.keyboard.press('Escape');
  await expect(header).toBeFocused();
  expect((await header.boundingBox())?.x).toBeGreaterThan(railRight);
  const toolbar = await page.getByRole('toolbar', { name: 'Design A actions' }).boundingBox();
  expect(toolbar?.x).toBeGreaterThan(railRight);
});

test('Layers says a frame without a design is being written while an agent is at work on it', async ({
  page,
}) => {
  await page.goto(boardUrl('font=14&layers=1&presence=1'));
  const tree = page.getByRole('tree', { name: 'Frames' });
  await expect(tree.getByRole('treeitem', { name: 'Design A, Writing' })).toBeVisible();
  await page.evaluate(() => {
    window.boardHarness.leave();
  });
  await expect(tree.getByRole('treeitem', { name: 'Design A, Empty' })).toBeVisible();
});
