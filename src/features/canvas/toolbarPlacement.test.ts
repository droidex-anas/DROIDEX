import assert from 'node:assert/strict';
import { test } from 'node:test';
import { placeToolbar, type ToolbarRoom } from './toolbarPlacement';
import type { FrameRect } from './protocol';

const BOARD = { x: 1000, y: 800 };
const BAR = { x: 220, y: 42 };
const frame = (x: number, y: number, width = 300, height = 200): FrameRect => ({
  x,
  y,
  width,
  height,
});
const room = (selected: FrameRect, others: FrameRect[] = []): ToolbarRoom => ({
  frame: selected,
  others,
  board: BOARD,
});

test('the toolbar stands above the label unless that covers another frame or leaves the board', () => {
  const selected = frame(400, 300);
  assert.deepEqual(placeToolbar(room(selected), BAR), { side: 'above', align: 'start' });
  // A neighbour up and to the left: ending where the frame ends clears it.
  assert.deepEqual(placeToolbar(room(selected, [frame(150, 60, 300, 180)]), BAR), {
    side: 'above',
    align: 'end',
  });
  // One right above takes both places over the label, so the bar drops below the size.
  assert.deepEqual(placeToolbar(room(selected, [frame(350, 50, 500, 180)]), BAR), {
    side: 'below',
    align: 'start',
  });
  // A narrow frame's bar reaches past it, where only a neighbour's label stands.
  assert.deepEqual(
    placeToolbar(room(frame(400, 300, 120, 200), [frame(540, 278, 260, 200)]), BAR),
    {
      side: 'above',
      align: 'end',
    },
  );
  // At the board's top edge there is no room above.
  assert.deepEqual(placeToolbar(room(frame(400, 40)), BAR), { side: 'below', align: 'start' });
  // At its right edge the bar ends where the frame does.
  assert.deepEqual(placeToolbar(room(frame(800, 300, 190, 200)), BAR), {
    side: 'above',
    align: 'end',
  });
});

test('with no clear place the toolbar stays on the board, and with none on it stays above', () => {
  const selected = frame(400, 300);
  const crowded = [frame(300, 40, 600, 200), frame(300, 560, 600, 200)];
  assert.deepEqual(placeToolbar(room(selected, crowded), BAR), { side: 'above', align: 'start' });
  // Larger than the board: above, ending where the frame does once the right edge would cut it.
  assert.deepEqual(placeToolbar(room(frame(-50, -50, 1100, 900)), BAR), {
    side: 'above',
    align: 'start',
  });
  assert.deepEqual(placeToolbar(room(frame(900, -50, 300, 900)), BAR), {
    side: 'above',
    align: 'end',
  });
});
