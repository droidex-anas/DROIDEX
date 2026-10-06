import assert from 'node:assert/strict';
import test from 'node:test';

import { nextRevealedText } from './streamingText';

test('nextRevealedText caps a large burst and never splits or invents a surrogate pair', () => {
  const burst = nextRevealedText(`${'a'.repeat(800)}${String.fromCodePoint(0x1f680)}`, '');
  assert.equal(burst.length, 64);
  assert.equal(burst.includes('�'), false);

  const emojiStart = 'hello ';
  const step = nextRevealedText(`${emojiStart}${String.fromCodePoint(0x1f680)} world`, emojiStart);
  assert.equal(step.startsWith(emojiStart), true);
  assert.equal(step.includes('🚀') || step.includes('🚀'), true);
  assert.equal(step.includes('�'), false);

  // A lone high surrogate is never paired with the BMP unit after it.
  assert.equal(nextRevealedText('\uD83D'.repeat(800), '').length, 64);
  const mixed = nextRevealedText(`\uD83Dx${'a'.repeat(800)}`, '');
  assert.equal(mixed.startsWith('\uD83Dx'), true);
  assert.equal(mixed.length, 64);
});
