// The canvas scenario's gestures: each opens on one board tool and streams one
// gesture's input at 120 Hz. Every stream but the marquee goes out and comes
// back, so it leaves the board as it found it and the page can stream it again.

import type { Page } from '@playwright/test';
import type { BoardTool } from './board';
import { PacedInput, type Point } from './input';

/** Events each way: half a second out, half a second back. */
const STEPS = 60;

/** The board's stage, whose transform is the viewport. */
const STAGE = '[data-testid="canvas-board"] > [style*="transform-origin"]';
const FRAME_A = '[data-design-frame="a"]';

export interface Gesture {
  name: string;
  description: string;
  tool: BoardTool;
  /** The element whose inline style the gesture changes, checked in the warm-up stream. */
  moves?: string;
  /** Readies the page once, before the first stream. */
  prepare?: (page: Page) => Promise<void>;
  stream: (page: Page) => Promise<void>;
}

/** Where a trip from `from` by `by` and back is, `index` events in. */
function roundTrip(from: Point, by: Point, index: number): Point {
  const out = index < STEPS ? index + 1 : 2 * STEPS - index - 1;
  return { x: from.x + (by.x * out) / STEPS, y: from.y + (by.y * out) / STEPS };
}

async function rectOf(page: Page, selector: string) {
  const rect = await page.locator(selector).first().boundingBox();
  if (!rect) throw new Error(`Nothing on the page matches ${selector}.`);
  return rect;
}

/** Empty board in the fitted board's top margin, which Fit leaves clear of frames. */
async function background(page: Page): Promise<Point> {
  const board = await rectOf(page, '[data-testid="canvas-board"]');
  const point = { x: board.x + board.width / 2 - 120, y: board.y + 30 };
  const isEmpty = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-design-frame], button') === null,
    point,
  );
  if (!isEmpty) throw new Error('The board margin is not empty board.');
  return point;
}

/** Presses at `from`, moves along `path` for the whole stream, and lets go where it ends. */
async function drag(input: PacedInput, from: Point, path: (index: number) => Point) {
  input.move(from);
  input.press(from);
  await input.stream(2 * STEPS, (index) => {
    input.move(path(index));
  });
  input.lift(path(2 * STEPS - 1));
  await input.flush();
}

async function wheel(page: Page, deltaY: number, modifier: 'Control' | 'Meta' | null) {
  const board = await rectOf(page, '[data-testid="canvas-board"]');
  const centre = { x: board.x + board.width / 2, y: board.y + board.height / 2 };
  const input = await PacedInput.open(page);
  input.move(centre);
  if (modifier) await input.hold(modifier);
  await input.stream(2 * STEPS, (index) => {
    input.wheel(centre, index < STEPS ? deltaY : -deltaY);
  });
  if (modifier) await input.release(modifier);
}

/** Answers every arrange the board sent, as the sidecar would, so the next drag starts clean. */
async function answerArranges(page: Page) {
  await page.evaluate(() => {
    const harness = window.boardHarness;
    harness.calls.forEach((_, index) => {
      harness.answer(index);
    });
    harness.calls.length = 0;
  });
}

async function moveFrames(page: Page, selected: string[]) {
  await page.evaluate((ids) => {
    window.boardHarness.select(ids);
  }, selected);
  const header = await rectOf(page, '[data-design-frame="a"] [data-frame-header]');
  const from = { x: header.x + 12, y: header.y + header.height / 2 };
  await drag(await PacedInput.open(page), from, (index) =>
    roundTrip(from, { x: 240, y: 160 }, index),
  );
  await answerArranges(page);
}

/** The pointer over the box in a zigzag of six rows, there and back. */
function zigzag(
  box: { x: number; y: number; width: number; height: number },
  index: number,
): Point {
  const rows = 6;
  const step = index < STEPS ? index : 2 * STEPS - index - 1;
  const progress = (step / STEPS) * rows;
  const row = Math.min(rows - 1, Math.floor(progress));
  const along = progress - row;
  const across = row % 2 === 0 ? along : 1 - along;
  return { x: box.x + across * box.width, y: box.y + ((row + 0.5) / rows) * box.height };
}

async function sweep(input: PacedInput, path: (index: number) => Point) {
  await input.stream(2 * STEPS, (index) => {
    input.move(path(index));
  });
}

/** Zooms to Design A and enters Edit, where its guest answers what is under the pointer. */
async function editFrameA(page: Page) {
  await page.evaluate(() => {
    window.boardHarness.focusFrame('a');
  });
  await page.waitForTimeout(600);
  await page.getByTestId('canvas-board').focus();
  await page.keyboard.press('e');
}

async function selectFrameA(page: Page) {
  await page.evaluate(() => {
    window.boardHarness.select(['a']);
  });
}

export const GESTURES: Gesture[] = [
  {
    name: 'pan',
    description: 'Background press-drag pan, 240 px across and back',
    tool: 'board',
    moves: STAGE,
    stream: async (page) => {
      const from = await background(page);
      await drag(await PacedInput.open(page), from, (index) =>
        roundTrip(from, { x: 240, y: 0 }, index),
      );
    },
  },
  {
    name: 'wheelPan',
    description: 'Two-finger scroll pan, 60 wheel events of 6 px down and 60 up',
    tool: 'board',
    moves: STAGE,
    stream: (page) => wheel(page, 6, null),
  },
  {
    name: 'pinch',
    description: 'Trackpad pinch (Ctrl+wheel), 60 events in and 60 out',
    tool: 'board',
    moves: STAGE,
    stream: (page) => wheel(page, -3, 'Control'),
  },
  {
    name: 'metaWheel',
    description: '⌘-wheel zoom, 60 events in and 60 out',
    tool: 'board',
    moves: STAGE,
    stream: (page) => wheel(page, -4, 'Meta'),
  },
  {
    name: 'moveOne',
    description: 'Drag one frame by its label, out and back',
    tool: 'board',
    moves: FRAME_A,
    stream: (page) => moveFrames(page, ['a']),
  },
  {
    name: 'moveFive',
    description: 'Drag five selected frames by one label, out and back',
    tool: 'board',
    moves: FRAME_A,
    stream: (page) => moveFrames(page, ['a', 'b', 'x0', 'x1', 'x2']),
  },
  {
    name: 'resizeOne',
    description: 'Resize one frame from its south-east corner, out and back',
    tool: 'board',
    moves: FRAME_A,
    prepare: selectFrameA,
    stream: async (page) => {
      const handle = await rectOf(page, '[data-design-frame="a"] [data-handle="southeast"]');
      const corner = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
      await drag(await PacedInput.open(page), corner, (index) =>
        roundTrip(corner, { x: 120, y: 90 }, index),
      );
      await answerArranges(page);
    },
  },
  {
    name: 'marquee',
    description: 'Shift-drag rubber band from the margin until it holds every frame',
    tool: 'board',
    stream: async (page) => {
      const board = await rectOf(page, '[data-testid="canvas-board"]');
      // From the top margin, right of the tool rail, to past the last frame.
      const from = { x: board.x + 80, y: board.y + 30 };
      const by = { x: board.width - 110, y: board.height - 60 };
      const input = await PacedInput.open(page);
      await input.hold('Shift');
      await drag(input, from, (index) => ({
        x: from.x + (by.x * (index + 1)) / (2 * STEPS),
        y: from.y + (by.y * (index + 1)) / (2 * STEPS),
      }));
      await input.release('Shift');
      await page.keyboard.press('Escape');
    },
  },
  {
    name: 'editHover',
    description: 'Edit mode pointer sweep over a design, element outlines following',
    tool: 'edit',
    prepare: editFrameA,
    stream: async (page) => {
      const sheet = await rectOf(page, '[data-design-frame="a"] .canvas-sheet');
      await sweep(await PacedInput.open(page), (index) => zigzag(sheet, index));
    },
  },
  {
    name: 'altMeasure',
    description:
      'Held Alt over the board, distances from the selection to the frame under the pointer',
    tool: 'board',
    prepare: selectFrameA,
    stream: async (page) => {
      const board = await rectOf(page, '[data-testid="canvas-board"]');
      const input = await PacedInput.open(page);
      await input.hold('Alt');
      await sweep(input, (index) => zigzag(board, index));
      await input.release('Alt');
    },
  },
  {
    name: 'layersSweep',
    description: 'Pointer sweep down the Layers rows and back, lighting each frame',
    tool: 'layers',
    stream: async (page) => {
      const tree = await rectOf(page, '[role="tree"]');
      const from = { x: tree.x + tree.width / 2, y: tree.y + 8 };
      await sweep(await PacedInput.open(page), (index) =>
        roundTrip(from, { x: 0, y: tree.height - 16 }, index),
      );
    },
  },
  {
    name: 'panelScrub',
    description: 'Scrub the picked title’s Font size by its short name, out and back',
    tool: 'edit',
    prepare: async (page) => {
      await editFrameA(page);
      const sheet = await rectOf(page, '[data-design-frame="a"] .canvas-sheet');
      const scale = sheet.width / 400;
      await page.mouse.click(sheet.x + 20 * scale, sheet.y + 20 * scale);
      await page.getByLabel('Font size', { exact: true }).waitFor();
    },
    stream: async (page) => {
      const field = page.getByLabel('Font size', { exact: true });
      const shortName = field.locator('xpath=..').locator('span[aria-hidden]').first();
      const handle = await shortName.boundingBox();
      if (!handle) throw new Error('The Font size field has no short name to scrub.');
      const from = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
      await drag(await PacedInput.open(page), from, (index) =>
        roundTrip(from, { x: 120, y: 0 }, index),
      );
      await page.keyboard.press('Escape');
    },
  },
];
