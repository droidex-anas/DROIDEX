import { expect, test, type Locator, type Page } from '@playwright/test';
import { sessionSummary } from '../../src/test/sessionSummary';
import type { ClientCommand, ServerEvent } from '@droidex/protocol';

const appUrl = process.env.DROIDEX_TEST_URL || '/';

// The draft is a CodeMirror editor: its content element is the textbox the
// user types into, and chips on the first line show up as left padding on it.
function composerOf(page: Page): Locator {
  return page.getByRole('textbox', { name: 'Prompt' });
}

function indentOf(composer: Locator): () => Promise<number> {
  return () => composer.evaluate((el) => Number.parseFloat(getComputedStyle(el).paddingLeft));
}

const BASE_PADDING_PX = 16;

test('the plus button offers plugins and Visualize joins the prompt as a selection', async ({
  page,
}) => {
  await page.goto(appUrl);
  const composer = composerOf(page);
  await expect(composer).toBeVisible();

  await page.getByTitle('Add files or a plugin').click();
  const menu = page.getByRole('menu');
  await expect(menu.getByText('Files', { exact: true })).toBeVisible();
  await menu.getByText('Visualize', { exact: true }).click();

  const removeChip = page.getByRole('button', { name: 'Remove Visualize' });
  await expect(removeChip).toBeVisible();
  await expect(menu).toHaveCount(0);
  // The plugin rides along as a selection: the draft stays the user's own words.
  await expect(composer).toHaveText('');
  // The selection is the command, so it can be sent on its own.
  await expect(page.getByRole('button', { name: 'Send prompt' })).toBeEnabled();

  // It sits on the draft's own first line, so that line starts after it and
  // typing continues from there.
  // The indent lands in a layout effect after the selection commits, so poll it.
  const indent = indentOf(composer);
  await expect.poll(indent).toBeGreaterThan(BASE_PADDING_PX + 40);
  await composer.click();
  await composer.pressSequentially('a chart of the last week');
  await expect(composer).toHaveText('a chart of the last week');
  await expect(removeChip).toBeVisible();

  // The row that added it takes it back off, and the line reclaims the space.
  await page.getByTitle('Add files or a plugin').click();
  await menu.getByRole('menuitemcheckbox', { name: /Visualize/ }).click();
  await expect(removeChip).toHaveCount(0);
  await expect.poll(indent).toBe(BASE_PADDING_PX);

  // One Backspace at the start of an empty draft takes the whole selection off.
  await page.getByTitle('Add files or a plugin').click();
  await menu.getByText('Visualize', { exact: true }).click();
  await composer.fill('');
  await composer.click();
  await composer.press('Backspace');
  await expect(removeChip).toHaveCount(0);
});

test('the slash menu keeps /visualize out of the draft text', async ({ page }) => {
  await page.goto(appUrl);
  const composer = composerOf(page);

  await composer.fill('/visual');
  await page.getByText('visualize', { exact: true }).click();

  await expect(page.getByRole('button', { name: 'Remove Visualize' })).toBeVisible();
  await expect(composer).toHaveText('');
});

// /compaction and /compression stay accepted when typed in full, but neither
// matches the command's name, so the menu never offered a row for them and
// still doesn't. What it used to offer was three identical Compact rows.
test('the slash menu lists a single Compact row', async ({ page }) => {
  await page.goto(appUrl);
  const composer = composerOf(page);

  await composer.fill('/compact');
  await expect(page.getByRole('button').filter({ hasText: 'compact' })).toHaveCount(1);

  for (const alias of ['/compaction', '/compression']) {
    await composer.fill(alias);
    await expect(page.getByRole('button').filter({ hasText: 'compact' })).toHaveCount(0);
  }
});

// A selection wider than half the line would leave no room to type, so it stops
// indenting and takes a row of its own instead of pushing the draft off-screen.
test('a selection too wide for the first line moves above it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(appUrl);
  const composer = composerOf(page);
  await expect(composer).toBeVisible();
  const indent = indentOf(composer);

  await page.getByTitle('Add files or a plugin').click();
  await page.getByRole('menu').getByText('Visualize', { exact: true }).click();
  await expect.poll(indent).toBeGreaterThan(BASE_PADDING_PX + 40);

  await page.setViewportSize({ width: 420, height: 900 });
  await expect.poll(indent).toBe(BASE_PADDING_PX);
  // Still staged, still visible, and still removable.
  await expect(page.getByRole('button', { name: 'Remove Visualize' })).toBeVisible();
  await expect(composer).toBeVisible();
});

test('the plus menu is reachable by keyboard and on a narrow window', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 900 });
  await page.goto(appUrl);

  const trigger = page.getByTitle('Add files or a plugin');
  await trigger.click();
  const menu = page.getByRole('menu');
  const box = (await menu.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(420);

  // Opening focuses the first row; the arrows walk between them.
  const focusedRow = () => page.evaluate(() => document.activeElement?.textContent ?? '');
  await expect.poll(focusedRow).toContain('Files');
  await page.keyboard.press('ArrowDown');
  await expect.poll(focusedRow).toContain('Visualize');
  await page.keyboard.press('ArrowDown');
  await expect.poll(focusedRow).toContain('Files');
  await page.keyboard.press('ArrowUp');
  await expect.poll(focusedRow).toContain('Visualize');

  // Escape closes it and hands focus back to the button that opened it.
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('the autonomy menu opens on the current level and picks one by its number', async ({
  page,
}) => {
  await page.goto(appUrl);
  const pill = page.getByRole('button', { name: /^Autonomy:/ });
  await pill.click();

  const levels = page.getByRole('menu', { name: 'Autonomy' }).getByRole('menuitemradio');
  await expect(levels).toHaveCount(4);
  const checked = page.getByRole('menuitemradio', { checked: true });
  await expect(checked).toHaveCount(1);
  await expect(checked).toBeFocused();

  await page.keyboard.press('4');
  await expect(levels).toHaveCount(0);
  await expect(pill).toHaveAccessibleName('Autonomy: Full access');

  // Only the chosen level says what it means on this harness.
  await pill.click();
  await expect(page.getByText("Droid's safety checks can still ask.")).toHaveCount(1);
  await expect(page.getByRole('menuitemradio', { checked: true })).toContainText('Full access');
});

// Replacing a multi-line draft with a longer single-line one (what recalling a
// prompt with ArrowUp does) adds characters while removing line breaks, so the
// editor has to shrink even though the draft grew.
test('the composer shrinks when a longer draft needs fewer lines', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 900 });
  await page.goto(appUrl);
  const composer = composerOf(page);
  const editor = page.locator('.cm-editor').first();
  const height = () => editor.evaluate((el) => el.getBoundingClientRect().height);

  await composer.click();
  await composer.pressSequentially('first');
  const oneLine = await height();
  for (const line of ['second', 'third']) {
    await composer.press('Shift+Enter');
    await composer.pressSequentially(line);
  }
  await expect.poll(height).toBeGreaterThan(oneLine);

  // Longer than the three lines it replaces, but only one line tall.
  await composer.press('ControlOrMeta+a');
  await composer.pressSequentially('one line again');
  await expect(composer).toHaveText('one line again');
  await expect.poll(height).toBe(oneLine);
});

test('the draft renders markdown as it is typed and sends the raw text', async ({ page }) => {
  await page.goto(appUrl);
  const composer = composerOf(page);

  await composer.click();
  await composer.pressSequentially('## Plan');
  await composer.press('Shift+Enter');
  await composer.pressSequentially('ship **now**');

  // The heading marker folds once the caret leaves the line; the bold marks
  // fold too, while the text underneath stays exactly what was typed.
  await expect(page.locator('.cm-md-h2')).toHaveCount(1);
  await expect(page.locator('.cm-md-strong')).toHaveText('now');
  await expect(composer).toHaveText('Planship now');
});

async function startComposerTurn(page: Page) {
  const submissions: ClientCommand[] = [];
  let finishFirstTurn: (() => void) | undefined;
  await page.routeWebSocket(
    (url) => url.searchParams.has('bridgeProtocol'),
    (socket) => {
      socket.onMessage((message) => {
        if (typeof message !== 'string') return;
        const command = JSON.parse(message) as ClientCommand;
        if (command.type === 'session.send') submissions.push(command);
        if (command.type !== 'session.create') return;
        submissions.push(command);
        const event: ServerEvent = {
          type: 'session.created',
          clientRef: command.clientRef,
          session: sessionSummary('composer-test-chat', {
            goal: command.goal,
            title: command.title,
            phase: 'running',
            streaming: true,
          }),
        };
        let seq = 0;
        const emit = (event: ServerEvent) => {
          seq += 1;
          socket.send(
            JSON.stringify({
              type: 'events.batch',
              generation: 'composer-test',
              firstSeq: seq,
              lastSeq: seq,
              events: [{ seq, event }],
            }),
          );
        };
        finishFirstTurn = () => {
          emit({ type: 'session.updated', session: { ...event.session, streaming: false } });
        };
        emit(event);
      });
    },
  );
  await page.goto(appUrl);
  const composer = composerOf(page);

  await composer.fill('ship **now**');
  await composer.press('Enter');
  await expect
    .poll(() => submissions)
    .toMatchObject([{ type: 'session.create', goal: 'ship **now**' }]);
  await expect(composer).not.toContainText('ship now');
  await expect(page.getByRole('button', { name: 'Stop turn' })).toBeVisible();
  if (!finishFirstTurn) throw new Error('The test chat did not start a turn');
  return { composer, submissions, finishFirstTurn };
}

test('the first prompt opens a chat and a queued follow-up waits for its turn', async ({
  page,
}) => {
  const { composer, submissions, finishFirstTurn } = await startComposerTurn(page);
  await composer.fill('Keep going');
  await composer.press('ControlOrMeta+Enter');
  const queue = page.getByText('Queued · sends after the current turn');
  await expect(queue).toBeVisible();
  await expect(composer).not.toContainText('Keep going');
  expect(submissions).toHaveLength(1);

  finishFirstTurn();
  await expect
    .poll(() => submissions.at(1))
    .toEqual({
      type: 'session.send',
      appSessionId: 'composer-test-chat',
      text: 'Keep going',
    });
  await expect(queue).not.toBeVisible();
});

test('a queued follow-up sends when its attachment finishes after the current turn', async ({
  page,
}) => {
  const { composer, submissions, finishFirstTurn } = await startComposerTurn(page);
  const savedAttachment = Promise.withResolvers<string>();
  let savingAttachment = false;
  await page.exposeFunction('saveTestAttachment', () => {
    savingAttachment = true;
    return savedAttachment.promise;
  });
  await composer.evaluate((editor) => {
    // Stub the desktop save only; the renderer still reads and awaits the pasted file.
    Object.defineProperty(window, 'droidex', {
      configurable: true,
      value: {
        saveAttachment: () => {
          Reflect.deleteProperty(window, 'droidex');
          return Reflect.get(window, 'saveTestAttachment')();
        },
      },
    });
    const clipboardData = new DataTransfer();
    clipboardData.items.add(new File(['Review notes'], 'notes.txt', { type: 'text/plain' }));
    editor.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData }));
  });
  await expect.poll(() => savingAttachment).toBe(true);

  await composer.fill('Read my notes');
  await composer.press('ControlOrMeta+Enter');
  const working = page.getByTestId('chat-view').getByText('Working', { exact: true });
  await expect(working).toBeVisible();
  finishFirstTurn();
  await expect(working).toHaveCount(0);
  expect(submissions).toHaveLength(1);

  savedAttachment.resolve('/tmp/notes.txt');
  await expect(composer).not.toContainText('Read my notes');
  await expect
    .poll(() => submissions.slice(1))
    .toEqual([
      {
        type: 'session.send',
        appSessionId: 'composer-test-chat',
        text: 'Read my notes\n\n@/tmp/notes.txt',
      },
    ]);
  await expect(page.getByText('Queued · sends after the current turn')).not.toBeVisible();
});
