import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateEstimatedCost } from './UsagePricing.js';

const TOKENS = {
  inputTokens: 1_000_000,
  outputTokens: 50_000,
  cacheWriteTokens: 200_000,
  cacheReadTokens: 100_000,
  reasoningTokens: 25_000,
};
const PRICE = {
  inputMicrousdPerMtok: 2_000_000,
  outputMicrousdPerMtok: 10_000_000,
  cacheWriteMicrousdPerMtok: 2_500_000,
  cacheReadMicrousdPerMtok: 100_000,
};

test('calculated cost prices disjoint token buckets once with integer rounding', () => {
  assert.equal(calculateEstimatedCost(TOKENS, PRICE), 2_410_000);
  assert.equal(
    calculateEstimatedCost(
      { ...TOKENS, inputTokens: 1, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 },
      { ...PRICE, inputMicrousdPerMtok: 500_000 },
    ),
    1,
  );
});

test('calculated cost stays unknown for incomplete or internally inconsistent accounting', () => {
  assert.equal(calculateEstimatedCost({ ...TOKENS, cacheReadTokens: null }, PRICE), null);
  assert.equal(
    calculateEstimatedCost(
      { ...TOKENS, cacheWriteTokens: 1 },
      { ...PRICE, cacheWriteMicrousdPerMtok: null },
    ),
    null,
  );
  assert.equal(
    calculateEstimatedCost(
      { ...TOKENS, inputTokens: 10, cacheWriteTokens: 6, cacheReadTokens: 5 },
      PRICE,
    ),
    null,
  );
});
