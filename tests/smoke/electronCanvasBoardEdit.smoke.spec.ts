// The board's Edit element mode against the harness: picking in a stand-in
// guest, the style panel, and the edit it sends.

import { expect, test } from '@playwright/test';
import { box, frame, openBoard, serveBoard, stubGuests } from './board/boardPage';

serveBoard();

test('Edit picks an element in the guest, previews a style, and commits it once', async ({
  page,
}) => {
  await stubGuests(page);
  // The guest's design: a card holding a title, in the design's own pixels.
  await page.addInitScript(() => {
    const title = { elementId: 'el_title', instancePath: '0/0' };
    const card = { elementId: 'el_card', instancePath: '0' };
    const box = { x: 8, y: 8, width: 240, height: 30 };
    window.guestAnswer = (command, argument) => {
      const point = argument as { x?: number; y?: number; target?: { elementId: string } };
      let element: { elementId: string; instancePath: string } | null = card;
      if (command === 'select' && !point.target) element = null;
      else if (command === 'select')
        element = point.target?.elementId === 'el_title' ? title : card;
      else if (
        point.x !== undefined &&
        point.x < box.x + box.width &&
        point.y! < box.y + box.height
      )
        element = title;
      if (!element) return null;
      const previewed = (argument.target as { styles?: Record<string, string> } | null)?.styles;
      return {
        ...element,
        rect: element === title ? box : { x: 0, y: 0, width: 400, height: 300 },
        styles: { fontSize: '24px', color: 'rgb(20, 20, 20)', ...previewed },
      };
    };
  });
  await openBoard(page, 14, 'reduce', '&preview=guest&edit=1');
  await page.evaluate(() => {
    window.boardGuestReady = true;
  });
  await page.clock.runFor(240);
  await expect(page.locator('[data-preview-phase="ready"]')).toHaveCount(2);

  const board = page.getByTestId('canvas-board');
  await board.focus();
  await page.keyboard.press('e');
  await expect(board).toHaveAttribute('data-board-mode', 'edit');

  // A press over the title picks it at the design's own pixels, not the screen's.
  const sheet = await box(frame(page, 'A').locator('.canvas-sheet'));
  const scale = sheet.width / 400;
  const before = await box(frame(page, 'A'));
  await page.mouse.click(sheet.x + 20 * scale, sheet.y + 20 * scale);
  await page.clock.runFor(100);
  const [picked] = await page.evaluate(() => window.guestCommands);
  expect(picked).toMatchObject({ command: 'pick' });
  expect(picked.x).toBeCloseTo(20, 0);
  expect(picked.y).toBeCloseTo(20, 0);
  const outline = await box(page.locator('.canvas-element-outline'));
  expect(outline.width).toBeCloseTo(240 * scale, 0);
  const panel = page.getByRole('region', { name: 'Styles of the selected h1' });
  const fontSize = panel.getByLabel('Font size', { exact: true });
  await expect(fontSize).toHaveValue('24px');
  // The panel opens beside the board and nothing on the board moves for it.
  expect(await box(frame(page, 'A'))).toEqual(before);

  // The panel is a column beside the board: a wheel over it scrolls its fields
  // and leaves the board where it was.
  const placed = await box(frame(page, 'A'));
  const column = await box(panel);
  await page.mouse.move(column.x + column.width / 2, column.y + column.height / 2);
  await page.mouse.wheel(0, 400);
  await expect
    .poll(() => panel.locator('.overflow-y-auto').evaluate((fields) => fields.scrollTop))
    .toBeGreaterThan(0);
  expect(await box(frame(page, 'A'))).toEqual(placed);

  // Typing previews in the guest; Enter sends the canonical value, once.
  await fontSize.fill(' 28PX ');
  await page.clock.runFor(100);
  expect(await page.evaluate(() => window.guestCommands.at(-1))).toMatchObject({
    command: 'select',
    target: { elementId: 'el_title', instancePath: '0/0', styles: { fontSize: ' 28PX ' } },
  });
  await fontSize.press('Enter');
  await fontSize.press('Enter');
  await expect(panel.getByRole('status')).toHaveText('Saving…');
  expect(await page.evaluate(() => window.boardHarness.editCalls)).toEqual([
    {
      mutationId: expect.any(String),
      edit: {
        element: {
          designId: 'a',
          revisionId: 'rev_01',
          elementId: 'el_title',
          instancePath: '0/0',
        },
        change: { kind: 'style', styles: [{ property: 'fontSize', value: '28px' }] },
      },
    },
  ]);

  // The written revision builds and the selection follows the title into it.
  await page.evaluate(() => window.boardHarness.answerEdit(0));
  await page.clock.runFor(240);
  await expect(panel.getByRole('status')).toHaveText(
    'Enter saves your changes; Escape takes one back.',
  );
  await expect
    .poll(() => page.evaluate(() => window.guestCommands.at(-1)))
    .toMatchObject({ command: 'select', target: { elementId: 'el_title', styles: {} } });

  // A shared element is the agent's to change, and Escape steps out one level at a time.
  const card = await box(frame(page, 'A').locator('.canvas-sheet'));
  await page.mouse.click(card.x + 300 * scale, card.y + 200 * scale);
  await page.clock.runFor(100);
  const shared = page.getByRole('region', { name: 'Styles of the selected section' });
  await expect(shared).toContainText('Ask the agent to change it.');
  await expect(shared.getByLabel('Font size', { exact: true })).toHaveAttribute('readonly', '');
  await board.focus();
  await page.keyboard.press('Escape');
  await expect(shared).toHaveCount(0);
  await expect(board).toHaveAttribute('data-board-mode', 'edit');
  await page.keyboard.press('Escape');
  await expect(board).toHaveAttribute('data-board-mode', 'select');
});

test('Edit works from the keyboard: Enter picks, arrows step, and a refused edit is dropped', async ({
  page,
}) => {
  await stubGuests(page);
  await page.addInitScript(() => {
    const title = { elementId: 'el_title', instancePath: '0/0' };
    const card = { elementId: 'el_card', instancePath: '0' };
    window.guestAnswer = (command, argument) => {
      const target = argument.target as { elementId: string } | null | undefined;
      let element = argument.step === 'next' ? card : title;
      if (command === 'select') {
        if (!target) return null;
        element = target.elementId === 'el_title' ? title : card;
      }
      return { ...element, rect: { x: 8, y: 8, width: 240, height: 30 }, styles: {} };
    };
  });
  await openBoard(page, 14, 'reduce', '&preview=guest&edit=1');
  await page.evaluate(() => {
    window.boardGuestReady = true;
  });
  await page.clock.runFor(240);
  await expect(page.locator('[data-preview-phase="ready"]')).toHaveCount(2);

  // Each key that asks the guest waits out its poll.
  const press = async (key: string) => {
    await page.keyboard.press(key);
    await page.clock.runFor(100);
  };
  await frame(page, 'A').locator('[data-frame-header]').focus();
  await page.keyboard.press('e');
  await press('Enter');
  const title = page.getByRole('region', { name: 'Styles of the selected h1' });
  await expect(title).toBeVisible();
  expect(await page.evaluate(() => window.guestCommands[0])).toMatchObject({
    command: 'pick',
    step: 'first',
  });
  await press('ArrowDown');
  await expect(page.getByRole('region', { name: 'Styles of the selected section' })).toBeVisible();
  await press('ArrowUp');
  await expect(title).toBeVisible();

  // Enter moves into the panel; Escape with nothing previewed hands the keyboard back.
  await page.keyboard.press('Enter');
  await expect(title.getByRole('textbox').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('canvas-board')).toBeFocused();
  await expect(title).toBeVisible();

  const fontSize = title.getByLabel('Font size', { exact: true });
  await fontSize.fill('30px');
  await fontSize.press('Enter');
  await page.evaluate(() => window.boardHarness.refuseEdit(0));
  await expect(page.getByRole('alert')).toHaveText('This element changed. Pick it again.');
  await expect(title).toHaveCount(0);
});

test('A double-click in Edit goes to the picked element’s text, and Enter saves the text on its own', async ({
  page,
}) => {
  await stubGuests(page);
  await page.addInitScript(() => {
    window.guestAnswer = (command, argument) => {
      if (command === 'select' && !argument.target) return null;
      return {
        elementId: 'el_title',
        instancePath: '0/0',
        rect: { x: 8, y: 8, width: 240, height: 30 },
        styles: { fontSize: '24px' },
        text: 'Title',
      };
    };
  });
  await openBoard(page, 14, 'reduce', '&preview=guest&edit=1');
  await page.evaluate(() => {
    window.boardGuestReady = true;
  });
  await page.clock.runFor(240);
  await expect(page.locator('[data-preview-phase="ready"]')).toHaveCount(2);
  await page.getByTestId('canvas-board').focus();
  await page.keyboard.press('e');

  // The double-click's own pick is still in flight; the Text field waits for its answer.
  const sheet = await box(frame(page, 'A').locator('.canvas-sheet'));
  const scale = sheet.width / 400;
  await page.mouse.dblclick(sheet.x + 20 * scale, sheet.y + 20 * scale);
  await page.clock.runFor(100);
  const panel = page.getByRole('region', { name: 'Styles of the selected h1' });
  const text = panel.getByRole('textbox', { name: 'Text', exact: true });
  await expect(text).toBeFocused();
  await expect(text).toHaveValue('Title');

  // Text previews in the guest beside a style, and Enter in it sends only the text.
  await panel.getByLabel('Font size', { exact: true }).fill('30px');
  await text.fill('Welcome back');
  await page.clock.runFor(100);
  expect(await page.evaluate(() => window.guestCommands.at(-1))).toMatchObject({
    command: 'select',
    target: { elementId: 'el_title', styles: { fontSize: '30px' }, text: 'Welcome back' },
  });
  await text.press('Enter');
  expect(await page.evaluate(() => window.boardHarness.editCalls)).toEqual([
    {
      mutationId: expect.any(String),
      edit: {
        element: {
          designId: 'a',
          revisionId: 'rev_01',
          elementId: 'el_title',
          instancePath: '0/0',
        },
        change: { kind: 'text', value: 'Welcome back' },
      },
    },
  ]);

  // Once the text's revision builds, the style typed beside it is still there to save.
  await page.evaluate(() => window.boardHarness.answerEdit(0));
  await page.clock.runFor(240);
  await expect
    .poll(() => page.evaluate(() => window.guestCommands.at(-1)))
    .toMatchObject({ command: 'select', target: { styles: { fontSize: '30px' }, text: null } });
  await expect(panel.getByLabel('Font size', { exact: true })).toHaveValue('30px');
});

test('Edit outlines the element under the pointer by its tag, through a zoom, until the pointer or Edit leaves', async ({
  page,
}) => {
  await stubGuests(page);
  await page.addInitScript(() => {
    const title = { elementId: 'el_title', instancePath: '0/0', tagName: 'h1' };
    const card = { elementId: 'el_card', instancePath: '0', tagName: 'section' };
    window.guestAnswer = (command, argument) => {
      if (command === 'select' && !argument.target) return null;
      const y = typeof argument.y === 'number' ? argument.y : 0;
      const element = y < 38 ? title : card;
      const rect =
        element === title
          ? { x: 8, y: 8, width: 240, height: 30 }
          : { x: 0, y: 0, width: 400, height: 300 };
      return command === 'hover' ? { ...element, rect } : { ...element, rect, styles: {} };
    };
  });
  await openBoard(page, 14, 'reduce', '&preview=guest&edit=1');
  await page.evaluate(() => {
    window.boardGuestReady = true;
  });
  await page.clock.runFor(240);
  await expect(page.locator('[data-preview-phase="ready"]')).toHaveCount(2);
  const board = page.getByTestId('canvas-board');
  await board.focus();
  await page.keyboard.press('e');

  const sheet = frame(page, 'A').locator('.canvas-sheet');
  const hover = page.locator('[data-element-hover]');
  const pointAt = async (x: number, y: number) => {
    const drawn = await box(sheet);
    const scale = drawn.width / 400;
    await page.mouse.move(drawn.x + x * scale, drawn.y + y * scale);
    await page.clock.runFor(32);
    return { drawn, scale };
  };
  const { drawn, scale } = await pointAt(20, 20);
  await expect(hover).toHaveAttribute('data-element-hover', 'h1');
  await expect(hover).toHaveText('h1');
  const titleBox = await box(hover);
  expect(titleBox.x).toBeCloseTo(drawn.x + 8 * scale, 0);
  expect(titleBox.width).toBeCloseTo(240 * scale, 0);
  // Its tag would leave the sheet above it, so it sits under it instead, and
  // a box filling the sheet holds its tag in its corner.
  const tag = hover.locator('.canvas-element-tag > span');
  expect((await box(tag)).y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height - 0.5);
  await pointAt(300, 200);
  await expect(hover).toHaveAttribute('data-element-hover', 'section');
  expect((await box(tag)).y).toBeGreaterThanOrEqual(drawn.y - 0.5);
  expect((await box(tag)).y).toBeLessThan(drawn.y + 30);

  // The picked element has its own outline, so the pointer over it adds none.
  await page.mouse.down();
  await page.mouse.up();
  await page.clock.runFor(100);
  await pointAt(300, 200);
  await expect(page.locator('.canvas-element-outline')).toBeVisible();
  await expect(hover).toHaveCount(0);

  // Both outlines stay on their elements through a zoom.
  await pointAt(20, 20);
  await expect(hover).toHaveAttribute('data-element-hover', 'h1');
  await board.focus();
  await page.keyboard.press('ControlOrMeta+0');
  await page.clock.runFor(400);
  const zoomed = await box(sheet);
  const zoom = zoomed.width / 400;
  expect(zoom).not.toBeCloseTo(scale, 2);
  const zoomedTitle = await box(hover);
  expect(zoomedTitle.x).toBeCloseTo(zoomed.x + 8 * zoom, 0);
  expect(zoomedTitle.y).toBeCloseTo(zoomed.y + 8 * zoom, 0);
  expect(zoomedTitle.width).toBeCloseTo(240 * zoom, 0);
  const outline = await box(page.locator('.canvas-element-outline'));
  expect(outline.x).toBeCloseTo(zoomed.x, 0);
  expect(outline.width).toBeCloseTo(zoomed.width, 0);

  // Leaving the design clears the hover, and so does leaving Edit, for good.
  await page.mouse.move(zoomed.x - 40, zoomed.y + 20);
  await expect(hover).toHaveCount(0);
  await pointAt(20, 20);
  await expect(hover).toHaveCount(1);
  await board.focus();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(board).toHaveAttribute('data-board-mode', 'select');
  await expect(hover).toHaveCount(0);
  await page.keyboard.press('e');
  await expect(board).toHaveAttribute('data-board-mode', 'edit');
  await expect(hover).toHaveCount(0);
});

test('the hover tag keeps off other content and off the picked size chip', async ({ page }) => {
  await stubGuests(page);
  await page.addInitScript(() => {
    const title = {
      elementId: 'el_title',
      instancePath: '0/0',
      tagName: 'h1',
      rect: { x: 8, y: 8, width: 240, height: 30 },
      room: { above: null, below: 26 },
    };
    const body = {
      elementId: 'el_body',
      instancePath: '0/1',
      tagName: 'p',
      rect: { x: 8, y: 64, width: 240, height: 20 },
      room: { above: 26, below: null },
    };
    // A label wedged between two rows, with no room for a tag above or below it.
    const note = {
      elementId: 'el_note',
      instancePath: '0/2',
      tagName: 'span',
      rect: { x: 264, y: 40, width: 120, height: 16 },
      room: { above: 4, below: 4 },
    };
    window.guestAnswer = (command, argument) => {
      if (command === 'select' && !argument.target) return null;
      const x = typeof argument.x === 'number' ? argument.x : 0;
      const y = typeof argument.y === 'number' ? argument.y : 0;
      let element = y < 50 ? title : body;
      if (x > 260) element = note;
      return command === 'hover' ? element : { ...element, styles: {} };
    };
  });
  await openBoard(page, 14, 'reduce', '&preview=guest&edit=1');
  await page.evaluate(() => {
    window.boardGuestReady = true;
  });
  await page.clock.runFor(240);
  const board = page.getByTestId('canvas-board');
  await board.focus();
  await page.keyboard.press('e');
  const drawn = await box(frame(page, 'A').locator('.canvas-sheet'));
  const hover = page.locator('[data-element-hover]');
  const hoverAt = async (x: number, y: number, tagName: string) => {
    await page.mouse.move(drawn.x + (x * drawn.width) / 400, drawn.y + (y * drawn.width) / 400);
    await page.clock.runFor(32);
    await expect(hover).toHaveAttribute('data-element-hover', tagName);
    return {
      outline: await box(hover),
      tag: await box(hover.locator('.canvas-element-tag > span')),
    };
  };

  // With no room either side, the tag covers only the element it names.
  const wedged = await hoverAt(300, 48, 'span');
  expect(wedged.tag.y).toBeGreaterThanOrEqual(wedged.outline.y - 0.5);
  expect(wedged.tag.y).toBeLessThan(wedged.outline.y + 1);
  const clear = await hoverAt(20, 70, 'p');
  expect(clear.tag.y + clear.tag.height).toBeLessThanOrEqual(clear.outline.y + 1);

  // The full width of the paragraph would meet the picked heading's size
  // chip; the tag at its left does not, so it stays above.
  await page.mouse.click(drawn.x + (20 * drawn.width) / 400, drawn.y + (20 * drawn.width) / 400);
  await page.clock.runFor(100);
  const chip = await box(page.locator('.canvas-element-outline .canvas-frame-size > span'));
  const besideChip = await hoverAt(20, 70, 'p');
  expect(besideChip.tag.y + besideChip.tag.height).toBeLessThanOrEqual(besideChip.outline.y + 1);
  expect(besideChip.tag.x + besideChip.tag.width).toBeLessThan(chip.x);
});

test('The Display row’s ⋯ menu sets a display its segments leave out, and a hidden element keeps its panel but no outline', async ({
  page,
}) => {
  await stubGuests(page);
  await page.addInitScript(() => {
    // The guest keeps the display it was last shown, and draws nothing while it is none.
    let display = 'inline';
    window.guestAnswer = (command, argument) => {
      if (command === 'select' && !argument.target) return null;
      const previewed = (argument.target as { styles?: Record<string, string> } | undefined)?.styles
        ?.display;
      if (previewed) display = previewed;
      const drawn = { x: 8, y: 8, width: 240, height: 30 };
      return {
        elementId: 'el_title',
        instancePath: '0/0',
        rect: display === 'none' ? { x: 0, y: 0, width: 0, height: 0 } : drawn,
        styles: { display },
      };
    };
  });
  await openBoard(page, 14, 'reduce', '&preview=guest&edit=1');
  await page.evaluate(() => {
    window.boardGuestReady = true;
  });
  await page.clock.runFor(240);
  await expect(page.locator('[data-preview-phase="ready"]')).toHaveCount(2);
  await frame(page, 'A').locator('[data-frame-header]').focus();
  await page.keyboard.press('e');
  await page.keyboard.press('Enter');
  await page.clock.runFor(100);
  const panel = page.getByRole('region', { name: 'Styles of the selected h1' });
  const outline = page.locator('.canvas-element-outline');
  await expect(panel).toBeVisible();
  await expect(outline).toHaveCount(1);

  // Inline lays out no layout the segments name, so ⋯ carries it.
  const layouts = panel.getByRole('radiogroup', { name: 'Display' });
  await expect(layouts.getByRole('radio', { checked: true })).toHaveCount(0);
  await panel.getByRole('button', { name: 'More displays, now Inline' }).click();
  const menu = page.getByRole('menu', { name: 'More displays' });
  await expect(menu.getByRole('menuitemradio', { checked: true })).toHaveText('Inline');
  await menu.getByRole('menuitemradio', { name: 'Hidden' }).click();
  await page.clock.runFor(200);
  await expect(menu).toHaveCount(0);
  const changes = () =>
    page.evaluate(() => window.boardHarness.editCalls.map(({ edit }) => edit.change));
  expect(await changes()).toEqual([
    { kind: 'style', styles: [{ property: 'display', value: 'none' }] },
  ]);

  // Hidden, it measures nothing: no outline or size on the board, and the panel says so.
  await page.clock.runFor(240);
  await expect(outline).toHaveCount(0);
  await expect(panel.locator('header')).toContainText('Hidden');
  await page.evaluate(() => window.boardHarness.answerEdit(0));
  await page.clock.runFor(240);
  await expect(panel.getByRole('status')).toHaveText(
    'Enter saves your changes; Escape takes one back.',
  );
  await expect(outline).toHaveCount(0);

  // With no segment checked, the arrow starts at the first, so Block shows it again.
  await layouts.getByRole('radio', { name: 'Block' }).focus();
  await page.keyboard.press('ArrowRight');
  await page.clock.runFor(200);
  expect((await changes()).at(-1)).toEqual({
    kind: 'style',
    styles: [{ property: 'display', value: 'block' }],
  });
  await expect(outline).toHaveCount(1);
  await expect(panel.locator('header')).toContainText('240 × 30');
});
