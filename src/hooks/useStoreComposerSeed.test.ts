import assert from 'node:assert/strict';
import test from 'node:test';
import { initialState, reducer } from './useStore';

test('a composer seed records its replace intent and clears once consumed', () => {
  const seeded = reducer(initialState, { type: 'SEED_COMPOSER', text: 'Build a dashboard' });
  assert.equal(seeded.composerSeed?.text, 'Build a dashboard');
  assert.equal(seeded.composerSeed?.replace, false);

  const consumed = reducer(seeded, { type: 'CLEAR_COMPOSER_SEED' });
  assert.equal(consumed.composerSeed, null);

  // Clearing with nothing pending is a no-op, so repeat consumption is safe.
  const again = reducer(consumed, { type: 'CLEAR_COMPOSER_SEED' });
  assert.equal(again.composerSeed, null);

  // A fresh-chat seed records replacement intent.
  const replacing = reducer(initialState, {
    type: 'SEED_COMPOSER',
    text: '/review Pull request #129',
    replace: true,
  });
  assert.equal(replacing.composerSeed?.replace, true);

  // The browser's prompt box sends its seed at once and leaves the focus alone.
  const sending = reducer(initialState, {
    type: 'SEED_COMPOSER',
    text: 'make this bolder',
    send: true,
    focus: false,
  });
  assert.equal(sending.composerSeed?.send, true);
  assert.equal(sending.composerSeed?.focus, false);
  assert.equal(seeded.composerSeed?.focus, true);
});
