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
        change: { kind: 'typography', property: 'fontSize', value: '28px' },
      },
    },
  ]);

  // The written revision builds and the selection follows the title into it.
  await page.evaluate(() =>
    window.boardHarness.answerEdit(0, { kind: 'token', token: '--ds-font-size-xl' }),
  );
  await page.clock.runFor(240);
  await expect(panel.getByRole('status')).toHaveText('Font size now uses --ds-font-size-xl.');
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
