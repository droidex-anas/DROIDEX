import assert from 'node:assert/strict';
import test from 'node:test';
import { chatColumnMax } from './designChatColumn';

test('the board keeps 480px of the row besides each column docked beside it', () => {
  assert.equal(chatColumnMax(1300, 0), 720);
  assert.equal(chatColumnMax(1300, 1), 540);
  // Layers and Edit's element panel both open: 480 + 2 × 280 of the row stays the board's.
  assert.equal(chatColumnMax(1600, 2), 560);
  // A narrow row still leaves the chat its minimum, and the board takes what is left.
  assert.equal(chatColumnMax(1200, 2), 320);
  // Unmeasured, the row does not clamp the chat yet.
  assert.equal(chatColumnMax(0, 2), 720);
});
