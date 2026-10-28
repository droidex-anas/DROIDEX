import assert from 'node:assert/strict';
import test from 'node:test';

import { easedRevealRate, nextRevealedText } from './streamingText';

test('nextRevealedText caps a large burst and never splits or invents a surrogate pair', () => {
  const burst = nextRevealedText(`${'a'.repeat(800)}${String.fromCodePoint(0x1f680)}`, '', 800);
  assert.equal(burst.length, 64);
  assert.equal(burst.includes('�'), false);

  const emojiStart = 'hello ';
  const step = nextRevealedText(
    `${emojiStart}${String.fromCodePoint(0x1f680)} world`,
    emojiStart,
    3,
  );
  assert.equal(step.startsWith(emojiStart), true);
  assert.equal(step.includes('🚀') || step.includes('🚀'), true);
  assert.equal(step.includes('�'), false);

  // A lone high surrogate is never paired with the BMP unit after it.
  assert.equal(nextRevealedText('\uD83D'.repeat(800), '', 800).length, 64);
  const mixed = nextRevealedText(`\uD83Dx${'a'.repeat(800)}`, '', 800);
  assert.equal(mixed.startsWith('\uD83Dx'), true);
  assert.equal(mixed.length, 64);
});

test('the reveal rate settles at the arrival rate instead of pulsing per burst', () => {
  // 40 code points every 40ms is one per ms; the backlog it holds is the lag.
  let rate = 0;
  let backlog = 0;
  for (let frame = 0; frame < 240; frame++) {
    if (frame % 3 === 0) backlog += 40;
    rate = easedRevealRate(rate, backlog, 40 / 3);
    backlog = Math.max(0, backlog - rate * (40 / 3));
  }
  assert.ok(Math.abs(rate - 1) < 0.2, `rate ${String(rate)} should track 1 per ms`);
  // An idle stream eases down to a slow, non-zero floor rather than stopping dead.
  assert.ok(easedRevealRate(1, 0, 1000) > 0);
});
