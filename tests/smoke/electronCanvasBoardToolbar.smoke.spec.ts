// The selected frame's toolbar against the harness: rename, the version
// menu and switching, Source, Variants and More, the keyboard's way through
// it, and when it steps aside.

import { expect, test } from '@playwright/test';
import { box, boardUrl, frame, openBoard, serveBoard } from './board/boardPage';

serveBoard();

test('the toolbar renames a frame, switches its version and opens its source', async ({ page }) => {
  await openBoard(page);
  await page.evaluate(() => window.boardHarness.select(['a']));
  const toolbar = page.getByRole('toolbar', { name: 'Design A actions' });
  await expect(toolbar).toBeVisible();
  expect(await page.evaluate(() => window.boardHarness.historyReads)).toEqual(['a']);

  // Rename saves against the manifest the user renamed, then hands back the label.
  await toolbar.getByRole('button', { name: 'Rename Design A' }).click();
  const field = page.getByRole('textbox', { name: 'Name of Design A' });
  await expect(field).toBeFocused();
  await field.fill('Hero');
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => window.boardHarness.renameCalls)).toEqual([
    { mutationId: 'rename', designId: 'a', name: 'Hero', expectedManifestVersion: 1 },
  ]);
  await page.evaluate(() => window.boardHarness.answerRename(0));
  await expect(page.getByText('Hero', { exact: true }).locator('..')).toBeFocused();

  // The chip names the version on show once the versions are read; choosing another switches to it.
  const hero = page.getByRole('toolbar', { name: 'Hero actions' });
  await page.evaluate(() => window.boardHarness.answerHistory(0));
  const chip = hero.getByRole('button', { name: /^Versions of Hero/ });
  await expect(chip).toHaveAccessibleName('Versions of Hero, version 2 on show');
  await chip.click();
  const menu = page.getByRole('menu', { name: 'Versions of Hero' });
  const current = menu.getByRole('menuitemradio', { name: /^v2/ });
  await expect(current).toHaveAttribute('aria-checked', 'true');
  await expect(current).toBeFocused();
  await menu.getByRole('menuitemradio', { name: /^v1/ }).click();
  // The page clock is paused; let the menu's select blink run out.
  await page.clock.runFor(200);
  await expect(menu).toHaveCount(0);
  await expect(chip).toBeFocused();
  expect(await page.evaluate(() => window.boardHarness.switchCalls)).toEqual([
    {
      mutationId: expect.any(String),
      designId: 'a',
      revisionId: 'rev_00',
      expectedRevisionId: 'rev_01',
    },
  ]);

  // A head that moved meanwhile is said plainly, and the versions are read again.
  await page.evaluate(() => window.boardHarness.refuseSwitch(0));
  await expect(
    page.getByText('This frame changed since its versions were read. Pick again.'),
  ).toBeVisible();
  expect(await page.evaluate(() => window.boardHarness.historyReads)).toEqual(['a', 'a']);

  await hero.getByRole('button', { name: 'Source of Hero' }).click();
  await expect(page.locator('[data-harness-source="a"]')).toBeVisible();
});

test('a rename saves over a build that landed meanwhile, but not over another rename', async ({
  page,
}) => {
  await openBoard(page);
  await page.evaluate(() => window.boardHarness.select(['a']));
  const toolbar = page.getByRole('toolbar', { name: 'Design A actions' });

  // A build commit moves the manifest version while the field is open.
  await toolbar.getByRole('button', { name: 'Rename Design A' }).click();
  const field = page.getByRole('textbox', { name: 'Name of Design A' });
  await page.evaluate(() => window.boardHarness.commitManifest('a'));
  await field.fill('Hero');
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => window.boardHarness.renameCalls)).toEqual([
    { mutationId: 'rename', designId: 'a', name: 'Hero', expectedManifestVersion: 2 },
  ]);
  await page.evaluate(() => window.boardHarness.answerRename(0));
  await expect(page.getByText('Hero', { exact: true }).locator('..')).toBeFocused();

  // Someone else renames it while the field is open: say so, and write nothing.
  await page
    .getByRole('toolbar', { name: 'Hero actions' })
    .getByRole('button', { name: 'Rename Hero' })
    .click();
  await page.evaluate(() => window.boardHarness.commitManifest('a', 'Landing'));
  await page.getByRole('textbox', { name: 'Name of Hero' }).fill('Mine');
  await page.keyboard.press('Enter');
  await expect(page.getByText('This frame was renamed to “Landing” meanwhile.')).toBeVisible();
  await expect(page.getByText('Landing', { exact: true }).locator('..')).toBeFocused();
  expect(await page.evaluate(() => window.boardHarness.renameCalls)).toHaveLength(1);
});

test('the toolbar is one tab stop the arrows walk, and Escape returns to the label', async ({
  page,
}) => {
  await openBoard(page);
  await page.evaluate(() => window.boardHarness.select(['b']));
  const label = frame(page, 'B').locator('[data-frame-header]');
  await label.focus();
  const toolbar = page.getByRole('toolbar', { name: 'Design B actions' });
  const versions = toolbar.getByRole('button', { name: 'Versions of Design B' });
  const more = toolbar.getByRole('button', { name: 'More for Design B' });

  await page.keyboard.press('Tab');
  await expect(versions).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(toolbar.getByRole('button', { name: 'Interact with Design B' })).toBeFocused();
  await page.keyboard.press('End');
  await expect(more).toBeFocused();

  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu', { name: 'More for Design B' });
  await expect(menu.getByRole('menuitem', { name: 'Save to library…' })).toBeFocused();
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => window.boardHarness.dialogs)).toEqual(['save:b']);
  await expect(menu).toHaveCount(0);
  await expect(more).toBeFocused();

  // Escape leaves the bar, not the selection; Tab comes back to the tool last used.
  await page.keyboard.press('Escape');
  await expect(label).toBeFocused();
  expect(await page.evaluate(() => window.boardHarness.interaction().selectedFrameIds)).toEqual([
    'b',
  ]);
  await page.keyboard.press('Tab');
  await expect(more).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(versions).toBeFocused();
  expect(await page.evaluate(() => window.boardHarness.calls)).toEqual([]);
});

test('Variants asks for three in one click, and its options choose kind, count and direction', async ({
  page,
}) => {
  await openBoard(page);
  await page.evaluate(() => window.boardHarness.select(['b']));
  const toolbar = page.getByRole('toolbar', { name: 'Design B actions' });

  // A second click while the first set is being made makes no second set.
  const variants = toolbar.getByRole('button', { name: 'Make 3 variants of Design B' });
  await variants.click();
  await variants.click();
  expect(await page.evaluate(() => window.boardHarness.variantCalls)).toEqual([
    { designId: 'b', kind: 'any', count: 3, direction: '' },
  ]);
  await page.evaluate(() => window.boardHarness.answerVariants(0));

  const chevron = toolbar.getByRole('button', { name: 'Variant options for Design B' });
  await chevron.click();
  const options = page.getByRole('dialog', { name: 'Variants of Design B' });
  await options.getByRole('radio', { name: 'Colour' }).click();
  await expect(options.getByRole('radio', { name: 'Colour' })).toBeChecked();
  await options.getByRole('radio', { name: '2', exact: true }).click();
  await options.getByRole('textbox', { name: 'Direction (optional)' }).fill('warmer, rounder');
  await page.keyboard.press('Enter');
  await expect(options).toHaveCount(0);
  await expect(chevron).toBeFocused();
  expect(await page.evaluate(() => window.boardHarness.variantCalls)).toEqual([
    { designId: 'b', kind: 'any', count: 3, direction: '' },
    { designId: 'b', kind: 'colour', count: 2, direction: 'warmer, rounder' },
  ]);
});

test('the toolbar steps aside while a drag holds the frame and offers only Done in Interact', async ({
  page,
}) => {
  await openBoard(page);
  await page.evaluate(() => window.boardHarness.select(['a']));
  const toolbar = page.getByRole('toolbar', { name: 'Design A actions' });
  await expect(toolbar).toBeVisible();

  const label = await box(frame(page, 'A').locator('[data-frame-header]'));
  await page.mouse.move(label.x + 20, label.y + label.height / 2);
  await page.mouse.down();
  await page.mouse.move(label.x + 60, label.y + label.height / 2 + 30, { steps: 4 });
  await expect(toolbar).toHaveCount(0);
  await page.mouse.up();
  await expect(toolbar).toBeVisible();

  await frame(page, 'A').locator('[data-canvas-input-overlay]').dblclick();
  await expect(page.getByTestId('canvas-board')).toHaveAttribute('data-board-mode', 'interact');
  await expect(toolbar.getByRole('button')).toHaveCount(1);
  await expect(toolbar.getByRole('button', { name: 'Return to Select' })).toBeVisible();
});

test('the toolbar drops below its frame rather than cover the frame above it', async ({ page }) => {
  await openBoard(page);
  // B goes under A, overlapping it across, with less than the bar's height between them.
  const label = await box(frame(page, 'B').locator('[data-frame-header]'));
  await page.mouse.move(label.x + 30, label.y + label.height / 2);
  await page.mouse.down();
  await page.mouse.move(label.x - 285, label.y + label.height / 2 + 60, { steps: 4 });
  await page.clock.runFor(32);
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.boardHarness.calls.length)).toBe(1);
  await page.evaluate(() => window.boardHarness.answer(0));
  // One step out leaves the board room under B.
  await page.getByTestId('canvas-board').focus();
  await page.keyboard.press('ControlOrMeta+-');
  await page.clock.runFor(32);

  const toolbar = page.getByRole('toolbar', { name: 'Design B actions' });
  await expect(toolbar).toBeVisible();
  const bar = await box(toolbar);
  const above = await box(frame(page, 'A'));
  const own = await box(frame(page, 'B'));
  expect(bar.y).toBeGreaterThan(own.y + own.height);
  expect(bar.x).toBeLessThan(above.x + above.width);
  expect(bar.y).toBeGreaterThan(above.y + above.height);
});

test('with no place clear of the other frames, the toolbar still paints over them', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1300, height: 1100 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(boardUrl('font=14&frames=3'));
  await expect(page.getByTestId('canvas-board')).toBeVisible();
  // B runs across the board above A and X0 across it below, so every place overlaps one.
  await page.evaluate(() => {
    window.boardHarness.publish('b', { x: -200, y: -500, width: 1400, height: 480 }, 9);
    window.boardHarness.publish('x0', { x: -200, y: 380, width: 1400, height: 400 }, 9);
    window.boardHarness.select(['a']);
  });

  const toolbar = page.getByRole('toolbar', { name: 'Design A actions' });
  await expect(toolbar).toBeVisible();
  const bar = await box(toolbar);
  const centre = { x: bar.x + bar.width / 2, y: bar.y + bar.height / 2 };
  const above = await box(frame(page, 'B'));
  expect(centre.y).toBeLessThan(above.y + above.height);
  expect(
    await toolbar.evaluate(
      (element, point) => element.contains(document.elementFromPoint(point.x, point.y)),
      centre,
    ),
  ).toBe(true);
});
