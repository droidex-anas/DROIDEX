// The layers panel against the board harness: a row per frame, front to back,
// with only the visible ones mounted, picking and lighting frames from
// it, the keyboard's way to a frame and back, renaming, the rail's toggle,
// and moving, deleting, duplicating and hiding a layer in its source.

import { expect, test } from '@playwright/test';
import { box, boardUrl, serveBoard, stubGuests } from './board/boardPage';

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
  // 300 frames, front first, and only the rows in view are in the document.
  await expect(row('Design X297')).toBeVisible();
  expect(await tree.getByRole('treeitem').count()).toBeLessThan(60);
  // The first frames placed are the furthest back, at the bottom.
  await tree.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(row('Design A')).toBeVisible();

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
  await page.keyboard.press('ArrowUp');
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
  await expect(row('Design X297')).toBeVisible();
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
    element.scrollTop = element.scrollHeight;
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
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Space');
  await expect.poll(() => selection(page)).toEqual(['b']);
  await page.keyboard.press('Space');
  await expect.poll(() => selection(page)).toEqual([]);
  await keyboardOn('Design B');

  // A lit row scrolled away under a still pointer takes its frame's light with it.
  const frameA = page.locator('[data-design-frame="a"]');
  await row('Design A').hover();
  await expect(frameA).toHaveAttribute('data-layer-hover', '');
  await tree.evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect(row('Design A')).toHaveCount(0);
  await expect(frameA).not.toHaveAttribute('data-layer-hover');
});

test('The keyboard stays on a frame that leaves the selection, and goes with a frame it restacks', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1300, height: 1100 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(boardUrl('font=14&frames=300'));
  const board = page.getByTestId('canvas-board');
  const tree = page.getByRole('tree', { name: 'Frames' });
  const row = (name: string) => tree.getByRole('treeitem', { name: `${name}, Ready` });
  const keyboardOn = async (name: string) =>
    expect(tree).toHaveAttribute(
      'aria-activedescendant',
      (await row(name).getAttribute('id')) ?? '',
    );

  // Opened on a selection, the panel's keyboard starts on it, and stays there as it is taken out.
  await page.evaluate(() => {
    window.boardHarness.select(['x250']);
  });
  await board.focus();
  await page.keyboard.press('Alt+Digit1');
  await keyboardOn('Design X250');
  await page.evaluate(() => {
    window.boardHarness.select([]);
  });
  await keyboardOn('Design X250');

  // With the row at the foot of the list, ⌥↓ moves its frame back a layer, and the
  // keyboard and the list follow it below the edge.
  const placed = await row('Design X250').boundingBox();
  const shown = await tree.boundingBox();
  if (!placed || !shown) throw new Error('Missing row geometry');
  await tree.evaluate(
    (element, by) => {
      element.scrollTop += by;
    },
    placed.y + placed.height - (shown.y + shown.height) + 8,
  );
  await tree.focus();
  await page.keyboard.press('Alt+ArrowDown');
  await expect(
    tree
      .getByRole('treeitem')
      .filter({ hasText: /^Design X24\d$/ })
      .first(),
  ).toBeVisible();
  await keyboardOn('Design X250');
  await expect(row('Design X250')).toBeInViewport({ ratio: 1 });
  expect(await selection(page)).toEqual([]);
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

test('Layers hides and shows a frame, and restacks frames from the keyboard and by a row’s handle', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(boardUrl('font=14&layers=1'));
  const tree = page.getByRole('tree', { name: 'Frames' });
  const items = tree.getByRole('treeitem');
  const onBoard = () =>
    page
      .locator('[data-design-frame]')
      .evaluateAll((frames) => frames.map((frame) => frame.getAttribute('data-design-frame')));
  const calls = () =>
    page.evaluate(() => ({
      hide: window.boardHarness.hideCalls,
      reorder: window.boardHarness.reorderCalls,
    }));
  // Front first: B was placed last, so it paints over A.
  await expect(items).toHaveText(['Design B', 'Design A']);

  // The eye takes A off the board and out of the selection, and leaves its row, dimmed and saying so.
  await page.evaluate(() => {
    window.boardHarness.select(['a']);
  });
  const rowA = tree.getByRole('treeitem', { name: /^Design A/ });
  await rowA.hover();
  await rowA.getByRole('button', { name: 'Hide' }).click();
  expect((await calls()).hide).toEqual([{ designId: 'a', hidden: true }]);
  await expect(rowA).toHaveAccessibleName('Design A, Ready, hidden');
  await expect(rowA.getByRole('button', { name: 'Hide' })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(onBoard).toEqual(['b']);
  await expect.poll(() => selection(page)).toEqual([]);
  const said = page.getByTestId('canvas-board').getByRole('status');
  await expect(said).toHaveText('Design A hidden');

  // The eye leaves the keyboard on the tree, on A's row, so ⇧⌘H shows A again.
  await expect(tree).toBeFocused();
  await page.keyboard.press('ControlOrMeta+Shift+KeyH');
  expect((await calls()).hide).toEqual([
    { designId: 'a', hidden: true },
    { designId: 'a', hidden: false },
  ]);
  await expect.poll(onBoard).toEqual(['a', 'b']);
  await expect(said).toHaveText('Design A shown');

  // ⌥↑ brings A in front of B, and the keyboard stays on A.
  await page.keyboard.press('Alt+ArrowUp');
  expect((await calls()).reorder).toEqual([['b', 'a']]);
  await expect(items).toHaveText(['Design A', 'Design B']);
  await expect.poll(onBoard).toEqual(['b', 'a']);
  await expect(tree).toHaveAttribute(
    'aria-activedescendant',
    (await rowA.getAttribute('id')) ?? '',
  );

  // B's handle drags it back above A.
  const rowB = tree.getByRole('treeitem', { name: /^Design B/ });
  await rowB.hover();
  const handle = await rowB.locator('.canvas-layer-tool').last().boundingBox();
  const top = await rowA.boundingBox();
  if (!handle || !top) throw new Error('Missing row geometry');
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x, top.y + 2, { steps: 4 });
  await page.mouse.up();
  expect((await calls()).reorder).toEqual([
    ['b', 'a'],
    ['a', 'b'],
  ]);
  await expect(items).toHaveText(['Design B', 'Design A']);
  // A drag picks nothing.
  expect(await selection(page)).toEqual([]);

  // Escape mid-drag hands the keyboard to the board and lets the frame go where it was.
  await rowB.hover();
  const grip = await rowB.locator('.canvas-layer-tool').last().boundingBox();
  const bottom = await rowA.boundingBox();
  if (!grip || !bottom) throw new Error('Missing row geometry');
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x, bottom.y + bottom.height - 2, { steps: 4 });
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-design-frame="b"] [data-frame-header]')).toBeFocused();
  await page.mouse.up();
  expect((await calls()).reorder).toHaveLength(2);
  await expect(items).toHaveText(['Design B', 'Design A']);
});

test('A row’s handle restacks under the pointer at a larger UI size, and only once dragged', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(boardUrl('font=16&frames=20&layers=1'));
  const tree = page.getByRole('tree', { name: 'Frames' });
  const row = (name: string) => tree.getByRole('treeitem', { name: `${name}, Ready` });
  const reorders = () => page.evaluate(() => window.boardHarness.reorderCalls);
  const handleOf = async (name: string) => {
    await row(name).hover();
    const box = await row(name).locator('.canvas-layer-tool').last().boundingBox();
    if (!box) throw new Error(`No handle on ${name}`);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };

  // A press on the handle that does not move restacks nothing.
  const grip = await handleOf('Design X7');
  await page.mouse.move(grip.x, grip.y);
  await page.mouse.down();
  await page.mouse.up();
  expect(await reorders()).toEqual([]);

  // Dragged to the top of X12's row, X7 lands in front of X12.
  const target = await row('Design X12').boundingBox();
  if (!target) throw new Error('Missing row geometry');
  await page.mouse.down();
  await page.mouse.move(grip.x, target.y + 2, { steps: 6 });
  await page.mouse.up();
  const extras = (indexes: number[]) => indexes.map((index) => `x${String(index)}`);
  expect(await reorders()).toEqual([
    ['a', 'b', ...extras([0, 1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 7, 13, 14, 15, 16, 17])],
  ]);
});

test('Layers opens a frame on its elements, picks one in Edit and outlines one under the pointer', async ({
  page,
}) => {
  await stubGuests(page);
  // The guest's design: a card holding a title.
  await page.addInitScript(() => {
    const card = { elementId: 'el_card', instancePath: '0', tagName: 'section' };
    const title = { elementId: 'el_title', instancePath: '0/0', tagName: 'h1' };
    window.guestAnswer = (command, argument) => {
      if (command === 'tree')
        return {
          nodes: [
            { ...card, depth: 0 },
            { ...title, depth: 1 },
          ],
          cap: 400,
          truncated: false,
        };
      const target = (argument.target ?? argument) as { instancePath?: string };
      const element = target.instancePath === '0' ? card : title;
      return {
        ...element,
        rect:
          element === title
            ? { x: 8, y: 8, width: 240, height: 30 }
            : { x: 0, y: 0, width: 400, height: 300 },
        styles: { fontSize: '24px', color: 'rgb(20, 20, 20)' },
      };
    };
  });
  await page.setViewportSize({ width: 1300, height: 1100 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install({ time: new Date('2026-10-07T12:00:00Z') });
  await page.clock.pauseAt(new Date('2026-10-07T12:01:00Z'));
  await page.goto(boardUrl('font=14&preview=guest&edit=1&layers=1'));
  await page.evaluate(() => {
    window.boardGuestReady = true;
  });
  await page.clock.runFor(240);
  await expect(page.locator('[data-preview-phase="ready"]')).toHaveCount(2);

  const tree = page.getByRole('tree', { name: 'Frames' });
  const frameRow = tree.getByRole('treeitem', { name: 'Design A, Ready' });
  const instance = tree.getByRole('treeitem', { name: 'Card, Instance' });
  const card = tree.getByRole('treeitem', { name: 'section, Container, locked', exact: true });
  const title = tree.getByRole('treeitem', { name: 'Pricing, Text', exact: true });
  const trees = () =>
    page.evaluate(() => window.guestCommands.filter(({ command }) => command === 'tree').length);
  // A frame's tree is asked for as it opens, and not before.
  await expect(frameRow).toHaveAttribute('aria-expanded', 'false');
  await frameRow.hover();
  expect(await trees()).toBe(0);
  await frameRow.getByRole('button', { name: 'Expand' }).click();
  // The rows are the source's: the Card instance opens onto the section it renders.
  await expect(title).toHaveAttribute('aria-level', '4');
  await expect(card).toHaveAttribute('aria-expanded', 'true');
  expect(await trees()).toBe(1);
  // The caret leaves the keyboard on the tree, on its row, for an arrow or Escape straight after.
  await page.keyboard.press('ArrowDown');
  await expect(tree).toHaveAttribute(
    'aria-activedescendant',
    (await instance.getAttribute('id')) ?? '',
  );
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-design-frame="a"] [data-frame-header]')).toBeFocused();

  // A click on an element's row picks it in Edit.
  const board = page.getByTestId('canvas-board');
  await title.click();
  await page.clock.runFor(100);
  await expect(board).toHaveAttribute('data-board-mode', 'edit');
  await expect(page.getByRole('region', { name: 'Styles of the selected h1' })).toBeVisible();
  await expect(title).toHaveAttribute('aria-selected', 'true');

  // The pointer over another element's row outlines it on the board, and leaving puts it out.
  await card.hover();
  await page.clock.runFor(100);
  await expect(page.locator('.canvas-element-hover')).toBeVisible();
  await page.getByRole('tab', { name: 'Layers' }).hover();
  await page.clock.runFor(100);
  await expect(page.locator('.canvas-element-hover')).toHaveCount(0);

  // Left goes to the parent and then closes it; Right opens it again. Enter picks.
  await tree.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(tree).toHaveAttribute(
    'aria-activedescendant',
    (await card.getAttribute('id')) ?? '',
  );
  await page.keyboard.press('ArrowLeft');
  await expect(title).toHaveCount(0);
  await page.keyboard.press('ArrowRight');
  await expect(title).toBeVisible();
  await page.keyboard.press('Enter');
  await page.clock.runFor(100);
  await expect(page.getByRole('region', { name: 'Styles of the selected section' })).toBeVisible();
  expect(await trees()).toBe(1);

  // The element under the board's pointer lights its row.
  const drawn = await box(page.locator('[data-design-frame="a"] .canvas-sheet'));
  await page.mouse.move(drawn.x + 40, drawn.y + 20);
  await page.clock.runFor(100);
  await expect(title.locator('.bg-elevated')).toHaveCount(1);
  await expect(card.locator('.bg-elevated')).toHaveCount(0);

  // An element picked on the board opens its shut frame, and its row takes the keyboard and the selection.
  await frameRow.getByRole('button', { name: 'Collapse' }).click();
  await expect(title).toHaveCount(0);
  await page.mouse.click(drawn.x + 40, drawn.y + 20);
  await page.clock.runFor(100);
  await expect(page.getByRole('region', { name: 'Styles of the selected h1' })).toBeVisible();
  await expect(title).toHaveAttribute('aria-selected', 'true');
  await expect(tree).toHaveAttribute(
    'aria-activedescendant',
    (await title.getAttribute('id')) ?? '',
  );
  expect(await trees()).toBe(2);

  // A frame shut and opened again reads where its elements are drawn again; its rows show
  // meanwhile, from the source, saying they are being read, but none of the last read's, so none can be picked.
  await page.evaluate(() => {
    window.guestTreeHeld = true;
  });
  await frameRow.getByRole('button', { name: 'Collapse' }).click();
  await frameRow.getByRole('button', { name: 'Expand' }).click();
  await expect(
    tree.getByRole('treeitem', { name: 'Pricing, Text, reading', exact: true }),
  ).toBeVisible();
  expect(await trees()).toBe(3);
});

test('A layer’s handle and ⌥ with the arrows move it in its source, and a drop it cannot take says why', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(boardUrl('font=14&layers=1&moves=1'));
  const tree = page.getByRole('tree', { name: 'Frames' });
  await tree
    .getByRole('treeitem', { name: 'Design A, Ready' })
    .getByRole('button', { name: 'Expand' })
    .click();
  const row = (name: string) => tree.getByRole('treeitem', { name: new RegExp(`^${name},`) });
  const moves = () =>
    page.evaluate(() =>
      window.boardHarness.editCalls.map(({ edit }) => ('layer' in edit ? edit : null)),
    );
  const line = row('Start free');
  await line.hover();
  const grip = await line.locator('.cursor-grab').boundingBox();
  const title = await row('Pricing').boundingBox();
  const image = await row('img').boundingBox();
  if (!grip || !title || !image) throw new Error('Missing row geometry');

  // Dragged to the boundary above the title, the line goes first in main.
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2, title.y + 2, { steps: 4 });
  await page.mouse.up();
  const layer = { designId: 'a', revisionId: 'rev_01', nodeId: 'line' };
  expect(await moves()).toEqual([
    { layer, change: { kind: 'move', parentId: 'main', beforeId: 'title' } },
  ]);

  // Below the image and a level in, the image would hold it: the line says it can't, and the drop sends nothing.
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 + 14, image.y + image.height - 2, { steps: 4 });
  await expect(tree.getByText('This layer can’t hold other layers.')).toBeVisible();
  await page.mouse.up();
  await expect(tree.getByText('This layer can’t hold other layers.')).toHaveCount(0);
  expect(await moves()).toHaveLength(1);

  // The handle left the keyboard on the line's row: ⌥↓ moves it past the section, ⌥→ nowhere,
  // as the title above it holds text, and ⌥← nowhere, as main is the frame's top layer.
  await expect(tree).toBeFocused();
  await page.keyboard.press('Alt+ArrowDown');
  await page.keyboard.press('Alt+ArrowRight');
  await page.keyboard.press('Alt+ArrowLeft');
  expect((await moves()).slice(1)).toEqual([
    { layer, change: { kind: 'move', parentId: 'main', beforeId: 'image' } },
  ]);

  // Once the first move has built, the keyboard follows the line to the row it landed on.
  await page.keyboard.press('ArrowUp');
  const lineId = (await line.getAttribute('id')) ?? '';
  await expect(tree).not.toHaveAttribute('aria-activedescendant', lineId);
  await page.evaluate(() => window.boardHarness.answerEdit(0));
  await expect(tree).toHaveAttribute('aria-activedescendant', lineId);

  // A drag ends without a move when its frame moves on to another revision, whose rows may
  // name other layers, or when the window loses focus.
  const regrab = async () => {
    await line.hover();
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x + grip.width / 2, title.y + 2, { steps: 4 });
    await expect(tree).toHaveAttribute('data-dragging', 'true');
  };
  await regrab();
  await page.evaluate(() => window.boardHarness.editByUser('a'));
  await expect(tree).not.toHaveAttribute('data-dragging');
  await page.mouse.up();
  await regrab();
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(tree).not.toHaveAttribute('data-dragging');
  await page.mouse.up();
  expect(await moves()).toHaveLength(2);
});

test('Delete, ⌘D and a layer’s menu remove or copy it in its source, and the keyboard follows', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(boardUrl('font=14&layers=1&moves=1'));
  const tree = page.getByRole('tree', { name: 'Frames' });
  const frameRow = tree.getByRole('treeitem', { name: 'Design A, Ready' });
  await frameRow.getByRole('button', { name: 'Expand' }).click();
  const row = (name: string) => tree.getByRole('treeitem', { name: new RegExp(`^${name},`) });
  const keyboardOn = async (name: string) => {
    await expect(tree).toHaveAttribute(
      'aria-activedescendant',
      (await row(name).getAttribute('id')) ?? '',
    );
  };
  const edits = () => page.evaluate(() => window.boardHarness.editCalls.map(({ edit }) => edit));
  const layer = (revisionId: string, nodeId: string) => ({ designId: 'a', revisionId, nodeId });

  // Delete removes the line, and once that has built the keyboard goes to the row it answers.
  // The caret left the keyboard on the frame's row: down past main and the title.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await keyboardOn('Start free');
  await page.keyboard.press('Delete');
  expect(await edits()).toEqual([{ layer: layer('rev_01', 'line'), change: { kind: 'remove' } }]);
  await page.evaluate(() => window.boardHarness.answerEdit(0, 'section'));
  await keyboardOn('section');

  // ⌘D on a layer's row copies the layer and stays the panel's; on a frame's row it is the
  // window's, which splits the chat. The image's row stands in for the copy.
  await page.evaluate(() => {
    window.addEventListener('keydown', (event) => {
      if (event.key === 'd') document.body.dataset.windowDuplicates = event.code;
    });
  });
  await page.keyboard.press('ControlOrMeta+d');
  expect(await edits()).toHaveLength(2);
  expect((await edits())[1]).toEqual({
    layer: layer('rev_02', 'section'),
    change: { kind: 'duplicate' },
  });
  await expect(page.locator('body')).not.toHaveAttribute('data-window-duplicates');
  await page.evaluate(() => window.boardHarness.answerEdit(1, 'image'));
  await keyboardOn('img');
  await frameRow.click();
  await page.keyboard.press('ControlOrMeta+d');
  await expect(page.locator('body')).toHaveAttribute('data-window-duplicates', 'KeyD');
  expect(await edits()).toHaveLength(2);

  // A right-click opens the row's menu, whose Delete removes its layer; a refusal says why.
  await row('img').click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'img layer' });
  await expect(menu.getByRole('menuitem', { name: /^Duplicate/ })).toBeVisible();
  await menu.getByRole('menuitem', { name: /^Delete/ }).click();
  await expect(menu).toHaveCount(0);
  expect((await edits())[2]).toEqual({
    layer: layer('rev_03', 'image'),
    change: { kind: 'remove' },
  });
  await page.evaluate(() => window.boardHarness.refuseEdit(2));
  await expect
    .poll(() => page.evaluate(() => window.boardHarness.toasts()))
    .toEqual(['This element changed. Pick it again.']);

  // ⇧F10, the menu key and the menu event the tree takes open the keyboard row's menu below
  // it; Escape gives the keyboard back to the tree.
  await expect(tree).toBeFocused();
  await keyboardOn('img');
  const opens = [
    () => page.keyboard.press('Shift+F10'),
    () => page.keyboard.press('ContextMenu'),
    () => tree.dispatchEvent('contextmenu'),
  ];
  for (const open of opens) {
    await open();
    await expect(menu.getByRole('menuitem', { name: /^Duplicate/ })).toBeFocused();
    const [rowBox, menuBox] = await Promise.all([row('img').boundingBox(), menu.boundingBox()]);
    expect(menuBox?.y).toBeGreaterThanOrEqual((rowBox?.y ?? 0) + (rowBox?.height ?? 0));
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(tree).toBeFocused();
  }
  expect(await edits()).toHaveLength(3);
});

test('A layer’s eye and ⇧⌘H hide or show its element in its source, and a hidden one’s row is muted', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(boardUrl('font=14&layers=1&moves=1'));
  const tree = page.getByRole('tree', { name: 'Frames' });
  await tree
    .getByRole('treeitem', { name: 'Design A, Ready' })
    .getByRole('button', { name: 'Expand' })
    .click();
  const row = (name: string) => tree.getByRole('treeitem', { name: new RegExp(`^${name},`) });
  const keyboardOn = async (name: string) => {
    await expect(tree).toHaveAttribute(
      'aria-activedescendant',
      (await row(name).getAttribute('id')) ?? '',
    );
  };
  const edits = () => page.evaluate(() => window.boardHarness.editCalls.map(({ edit }) => edit));
  const layer = (nodeId: string) => ({ designId: 'a', revisionId: 'rev_01', nodeId });

  // The section is written hidden: its row says so, is muted, and keeps its eye pressed in view.
  const section = tree.getByRole('treeitem', {
    name: 'section, Container, hidden, not read',
    exact: true,
  });
  const sectionEye = section.getByRole('button', { name: 'Hide' });
  await expect(sectionEye).toHaveAttribute('aria-pressed', 'true');
  await expect(sectionEye).toHaveCSS('opacity', '1');
  await expect(section.locator('.text-muted', { hasText: /^section$/ })).toBeVisible();

  // The line's eye shows under the pointer, hides the line, and leaves the keyboard on its row.
  const line = row('Start free');
  const lineEye = line.getByRole('button', { name: 'Hide' });
  await expect(lineEye).toHaveCSS('opacity', '0');
  await line.hover();
  await expect(lineEye).toHaveCSS('opacity', '1');
  await lineEye.hover();
  await expect(page.getByRole('tooltip')).toHaveText(/^Hide \(.+H\)$/);
  await lineEye.click();
  expect(await edits()).toEqual([{ layer: layer('line'), change: { kind: 'hide', hidden: true } }]);
  await expect(tree).toBeFocused();
  await keyboardOn('Start free');

  // ⇧⌘H on the section's row shows it; main, the frame's top layer, has no eye and takes none.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ControlOrMeta+Shift+H');
  expect((await edits())[1]).toEqual({
    layer: layer('section'),
    change: { kind: 'hide', hidden: false },
  });
  await expect(row('main').getByRole('button', { name: 'Hide' })).toHaveCount(0);
  // The image's own classes decide its display, so its eye is locked and says why.
  await expect(row('img').getByRole('button', { name: 'Hide' })).toHaveCount(0);
  await expect(row('img')).toHaveAccessibleDescription(/^Its classes or style set how it displays/);
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await keyboardOn('main');
  await page.keyboard.press('ControlOrMeta+Shift+H');
  expect(await edits()).toHaveLength(2);
});
