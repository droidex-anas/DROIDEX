import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { calculateEstimatedCost, UsagePricer } from './UsagePricing.js';
import { initializeUsageSchema } from './UsageSchema.js';

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

test('Claude estimates both cache-write TTLs and defaults aggregate writes to five minutes', () => {
  const db = new DatabaseSync(':memory:');
  try {
    initializeUsageSchema(db, ':memory:');
    const pricer = new UsagePricer(db);
    const event = {
      ...TOKENS,
      model: 'claude-opus-5-5',
      serviceTier: null,
      tsMs: Date.parse('2026-10-14T10:00:00Z'),
    };
    assert.equal(pricer.price(event).estimatedCostMicrousd, 4_820_000);
    assert.equal(
      pricer.price({ ...event, cacheWrite1hTokens: 50_000 }).estimatedCostMicrousd,
      4_970_000,
    );
  } finally {
    db.close();
  }
});

test('pricing covers historical models while unknown model IDs remain unpriced', () => {
  const db = new DatabaseSync(':memory:');
  try {
    initializeUsageSchema(db, ':memory:');
    const pricer = new UsagePricer(db);
    const event = {
      ...TOKENS,
      cacheWriteTokens: 0,
      model: 'gpt-5.3-codex',
      serviceTier: null,
      tsMs: Date.parse('2026-03-01T10:00:00Z'),
    };
    assert.equal(pricer.price(event).estimatedCostMicrousd, 2_292_500);
    assert.equal(pricer.price({ ...event, model: 'unknown-model' }).estimatedCostMicrousd, null);
  } finally {
    db.close();
  }
});

test('GPT-5.6 pricing retains launch rates before its later price reductions', () => {
  const db = new DatabaseSync(':memory:');
  try {
    initializeUsageSchema(db, ':memory:');
    const pricer = new UsagePricer(db);
    const event = {
      ...TOKENS,
      inputTokens: 100_000,
      outputTokens: 10_000,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
      model: 'gpt-5.6-sol',
      serviceTier: null,
    };
    assert.equal(
      pricer.price({ ...event, tsMs: Date.parse('2026-07-15') }).estimatedCostMicrousd,
      800_000,
    );
    assert.equal(
      pricer.price({ ...event, tsMs: Date.parse('2026-08-22') }).estimatedCostMicrousd,
      600_000,
    );
  } finally {
    db.close();
  }
});

test('pricing applies documented long-context and fast multipliers', () => {
  const db = new DatabaseSync(':memory:');
  try {
    initializeUsageSchema(db, ':memory:');
    const pricer = new UsagePricer(db);
    const event = {
      ...TOKENS,
      cacheWriteTokens: 0,
      model: 'gpt-6.1-sol',
      serviceTier: 'default',
      tsMs: Date.parse('2026-10-14'),
    };
    assert.equal(pricer.price(event).estimatedCostMicrousd, 4_370_000);
    assert.equal(
      pricer.price({ ...event, serviceTier: 'priority' }).estimatedCostMicrousd,
      8_740_000,
    );
  } finally {
    db.close();
  }
});

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
