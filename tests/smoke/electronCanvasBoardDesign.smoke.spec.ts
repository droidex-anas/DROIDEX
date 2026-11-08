// The board's Design mode against the harness: hovering and picking elements
// in a stand-in guest, the outlines it draws, and the quick prompt it opens.

import { expect, test } from '@playwright/test';
import { box, frame, openBoard, serveBoard, stubGuests } from './board/boardPage';

serveBoard();

test('Design names what it hovers, picks by click, shift-click and text drag, and hands the quick prompt to the composer', async ({
  page,
}) => {
  await stubGuests(page);
  // The guest's design: a card holding a title, in the design's own pixels. The
  // card runs on past the frame's bottom edge, which clips it.
  await page.addInitScript(() => {
    const title = { elementId: 'el_title', instancePath: '0/0', tagName: 'h1' };
    const card = { elementId: 'el_card', instancePath: '0', tagName: 'section' };
    const titleRect = { x: 8, y: 8, width: 240, height: 30 };
    const cardRect = { x: 0, y: 0, width: 400, height: 900 };
    const at = (point: unknown) => {
      const { x, y } = point as { x: number; y: number };
      if (x > 390) return null;
      return y < 38 ? { ...title, rect: titleRect } : { ...card, rect: cardRect };
    };
    window.guestAnswer = (command, argument) => {
      if (command === 'hover') return at(argument);
      if (command !== 'probe') return null;
      if ('at' in argument) return at(argument.at);
      const text = { excerpt: 'Pro plan', rect: { x: 10, y: 12, width: 90, height: 20 } };
      return { ...title, rect: titleRect, text };
    };
  });
  await openBoard(page, 14, 'reduce', '&preview=guest&edit=1&design=1');
  await page.evaluate(() => {
    window.boardGuestReady = true;
  });
  await page.clock.runFor(240);
  await expect(page.locator('[data-preview-phase="ready"]')).toHaveCount(2);

  const board = page.getByTestId('canvas-board');
  await board.focus();
  await page.keyboard.press('d');
  await expect(board).toHaveAttribute('data-board-mode', 'design');
  await expect(page.getByRole('button', { name: 'Design', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  const drawn = await box(frame(page, 'A').locator('.canvas-sheet'));
  const scale = drawn.width / 400;
  const point = (x: number, y: number) => ({ x: drawn.x + x * scale, y: drawn.y + y * scale });
  const settle = () => page.clock.runFor(64);

  // The hover names the component the element is written in, then its tag.
  const title = point(20, 20);
  await page.mouse.move(title.x, title.y);
  await settle();
  const hover = page.locator('[data-element-hover]');
  await expect(hover).toHaveAttribute('data-element-hover', 'h1');
  await expect(hover.locator('.canvas-element-tag')).toHaveText('Cardh1');

  // A click picks the element and opens the quick prompt beside it, ready to type.
  await page.mouse.click(title.x, title.y);
  await settle();
  const picks = page.locator('[data-design-pick]');
  await expect(picks).toHaveCount(1);
  expect((await box(picks)).width).toBeCloseTo(240 * scale, 0);
  const prompt = page.getByRole('textbox', { name: 'Prompt for the picked elements' });
  await expect(prompt).toBeFocused();
  await expect(prompt).toHaveAttribute('placeholder', 'Describe the change to Card');
  // A design pick leaves the frame selection alone.
  expect(await page.evaluate(() => window.boardHarness.interaction().selectedFrameIds)).toEqual([]);

  // Shift-click adds the card beside it; the prompt stays open and moves to it.
  const card = point(300, 200);
  await page.keyboard.down('Shift');
  await page.mouse.click(card.x, card.y);
  await page.keyboard.up('Shift');
  await settle();
  await expect(picks).toHaveCount(2);
  await expect(prompt).toBeVisible();
  // It goes below what the frame shows of the card, just under the frame.
  const placed = page.locator('[data-design-pick-prompt]');
  await expect(placed).toHaveAttribute('data-side', 'below');
  expect((await box(placed)).y).toBeCloseTo(drawn.y + drawn.height + 8, 0);

  // Sending hands the words to the chat's composer, which sends with every pick.
  await prompt.fill('Make it bolder');
  await prompt.press('Enter');
  expect(await page.evaluate(() => window.boardHarness.seeds)).toEqual([
    { text: 'Make it bolder', send: true },
  ]);
  await expect(prompt).toHaveCount(0);

  // A drag across text outlines the words it spans as it goes, naming no element under it.
  const from = point(12, 20);
  const to = point(100, 22);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await settle();
  const dragging = page.locator('[data-design-pick][data-dragging]');
  await expect(dragging).toHaveCount(1);
  expect((await box(dragging)).width).toBeCloseTo(90 * scale, 0);
  await expect(hover).toHaveCount(0);
  const probe = await page.evaluate(() => window.guestCommands.at(-1));
  expect(probe).toMatchObject({ command: 'probe', from: { x: expect.any(Number) } });

  // Released, it picks those words in place of the picks.
  await page.mouse.up();
  await settle();
  await expect(dragging).toHaveCount(0);
  await expect(picks).toHaveCount(1);
  expect((await box(picks)).width).toBeCloseTo(90 * scale, 0);

  // Closed unsent, the prompt's words go on in the composer's draft.
  await expect(prompt).toBeFocused();
  await prompt.fill('Shorter');
  await prompt.press('Escape');
  await expect(prompt).toHaveCount(0);
  expect(await page.evaluate(() => window.boardHarness.seeds.at(-1))).toEqual({
    text: 'Shorter',
    send: false,
  });
  await expect(board).toBeFocused();

  // Escape during a drag lets go of it alone: its release picks nothing.
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(point(50, 22).x, to.y, { steps: 4 });
  await settle();
  await expect(dragging).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(dragging).toHaveCount(0);
  await page.mouse.up();
  await settle();
  await expect(picks).toHaveCount(1);
  expect((await box(picks)).width).toBeCloseTo(90 * scale, 0);
  await expect(prompt).toHaveCount(0);

  // Escape takes the picks off, then leaves Design.
  await page.keyboard.press('Escape');
  await expect(picks).toHaveCount(0);
  await expect(board).toHaveAttribute('data-board-mode', 'design');
  await page.keyboard.press('Escape');
  await expect(board).toHaveAttribute('data-board-mode', 'select');

  // A click on nothing the guest marks clears the picks.
  await page.keyboard.press('d');
  await page.mouse.click(title.x, title.y);
  await settle();
  await expect(picks).toHaveCount(1);
  const empty = point(395, 100);
  await page.mouse.click(empty.x, empty.y);
  await settle();
  await expect(picks).toHaveCount(0);
});
