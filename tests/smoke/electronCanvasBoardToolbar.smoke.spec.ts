// The selected frame's toolbar against the harness: rename, the History
// popover and Restore, Source and More, the keyboard's way through it, and
// when it steps aside.

import { expect, test } from '@playwright/test';
import { box, frame, openBoard, serveBoard } from './board/boardPage';

serveBoard();

test('the toolbar renames a frame, restores from its history and opens its source', async ({
  page,
}) => {
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

  // The chip counts the revisions once they are read; Restore asks first.
  const hero = page.getByRole('toolbar', { name: 'Hero actions' });
  await page.evaluate(() => window.boardHarness.answerHistory(0));
  const chip = hero.getByRole('button', { name: /^History of Hero/ });
  await expect(chip).toHaveAccessibleName('History of Hero, version 2');
  await chip.click();
  const popover = page.getByRole('dialog', { name: 'History of Hero' });
  await expect(popover.getByText('v2 · You edited it')).toBeVisible();
  await expect(popover.getByText('Current', { exact: true })).toBeVisible();
  await popover.getByRole('button', { name: 'Restore v1', exact: true }).click();
  await expect(popover.getByText('Restore v1?')).toBeVisible();
  await popover.getByRole('button', { name: 'Restore v1 as the current revision' }).click();
  expect(await page.evaluate(() => window.boardHarness.restoreCalls)).toEqual([
    {
      mutationId: expect.any(String),
      designId: 'a',
      revisionId: 'rev_00',
      expectedRevisionId: 'rev_01',
    },
  ]);

  // A head that moved meanwhile is said plainly, and the history is read again.
  await page.evaluate(() => window.boardHarness.refuseRestore(0));
  await expect(popover.getByRole('alert')).toHaveText(
    'This frame changed since its history was read. Pick again.',
  );
  expect(await page.evaluate(() => window.boardHarness.historyReads)).toEqual(['a', 'a']);
  await page.keyboard.press('Escape');
  await expect(popover).toHaveCount(0);
  await expect(chip).toBeFocused();

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
  const rename = toolbar.getByRole('button', { name: 'Rename Design B' });
  const more = toolbar.getByRole('button', { name: 'More for Design B' });

  await page.keyboard.press('Tab');
  await expect(rename).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(toolbar.getByRole('button', { name: 'History of Design B' })).toBeFocused();
  await page.keyboard.press('End');
  await expect(more).toBeFocused();

  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu', { name: 'More for Design B' });
  await expect(menu.getByRole('menuitem', { name: 'Make variants…' })).toBeFocused();
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => window.boardHarness.dialogs)).toEqual(['variants:b']);
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
  await expect(rename).toBeFocused();
  expect(await page.evaluate(() => window.boardHarness.calls)).toEqual([]);
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
