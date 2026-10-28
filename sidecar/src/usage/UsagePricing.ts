import { type DatabaseSync, type StatementSync } from 'node:sqlite';

import type { UsageEvent, UsageTokenCounts } from './types.js';

interface ModelPrice {
  model: string;
  effectiveFrom: number;
  pricingVersion: string;
  inputMicrousdPerMtok: number | null;
  outputMicrousdPerMtok: number | null;
  cacheWriteMicrousdPerMtok: number | null;
  cacheReadMicrousdPerMtok: number | null;
  maxStandardInputTokens: number | null;
}

export interface UsagePriceResult {
  estimatedCostMicrousd: number | null;
  pricingVersion: string | null;
}

export type UsagePricingInput = UsageTokenCounts &
  Pick<UsageEvent, 'model' | 'serviceTier' | 'tsMs' | 'cacheWrite1hTokens'>;

const MICROTOKENS_PER_MTOK = 1_000_000n;
const MAX_SAFE_INTEGER = BigInt(Number.MAX_SAFE_INTEGER);
const OPENAI_SHORT_CONTEXT_LIMIT = 272_000;

// Standard, global API list prices checked 2026-10-23. The exact model IDs,
// rates, and effective dates come from the providers' pricing and release notes:
// https://platform.claude.com/docs/en/about-claude/pricing
// https://platform.claude.com/docs/en/release-notes/overview
// https://developers.openai.com/api/docs/pricing
// https://developers.openai.com/api/docs/changelog
const OFFICIAL_PRICES: readonly ModelPrice[] = [
  anthropic('claude-opus-4-6', '2026-02-05', 5, 25, 0.5),
  anthropic('claude-opus-4-7', '2026-04-16', 5, 25, 0.5),
  anthropic('claude-opus-4-8', '2026-05-28', 5, 25, 0.5),
  anthropic('claude-sonnet-4-6', '2026-02-17', 3, 15, 0.3),
  anthropic('claude-sonnet-4-5-20250929', '2025-09-29', 3, 15, 0.3, 200_000),
  anthropic('claude-opus-4-5-20251101', '2025-11-01', 5, 25, 0.5),
  anthropic('claude-haiku-4-5-20251001', '2025-10-01', 1, 5, 0.1),
  anthropic('claude-sonnet-5', '2026-06-30', 2, 10, 0.2),
  anthropic('claude-opus-5', '2026-07-24', 5, 25, 0.5),
  anthropic('claude-fable-5', '2026-06-30', 10, 50, 1),
  anthropic('claude-fable-5-1', '2026-09-01', 10, 50, 0.25),
  anthropic('claude-opus-5-5', '2026-09-23', 4, 20, 0.2),
  anthropic('claude-sonnet-5-5', '2026-09-28', 2, 10, 0.2),
  anthropic('claude-sonnet-5-5', '2026-10-07', 2, 10, 0.1),
  anthropic('claude-haiku-5-5', '2026-10-07', 0.1, 0.5, 0.01, 100_000),
  openai('gpt-5.1-codex-mini', '2025-11-13', 0.25, 2, 0.025, 0, null),
  openai('gpt-5.2', '2025-12-11', 1.75, 14, 0.175, 0, null),
  openai('gpt-5.2-codex', '2025-12-18', 1.75, 14, 0.175, 0, null),
  openai('gpt-5.3-codex', '2026-02-05', 1.75, 14, 0.175, 0, null),
  openai('gpt-5.3-codex-spark', '2026-02-12', 1.75, 14, 0.175, 0, null),
  openai('gpt-5.4', '2026-03-05', 2.5, 15, 0.25, 0),
  openai('gpt-5.4-mini', '2026-03-17', 0.75, 4.5, 0.075, 0, null),
  openai('gpt-5.5', '2026-04-23', 5, 30, 0.5, 0),
  openai('gpt-5.6-sol', '2026-07-09', 5, 30, 0.5, 6.25),
  openai('gpt-5.6-terra', '2026-07-09', 2.5, 15, 0.25, 3.125),
  openai('gpt-5.6-luna', '2026-07-09', 1, 6, 0.1, 1.25),
  openai('gpt-5.6-terra', '2026-07-30', 2, 12, 0.2, 2.5),
  openai('gpt-5.6-luna', '2026-07-30', 0.2, 1.2, 0.02, 0.25),
  openai('gpt-5.6-sol', '2026-08-21', 4, 20, 0.4, 5),
  openai('gpt-6-astra', '2026-09-03', 10, 50, 1, 12.5),
  openai('gpt-6-sol', '2026-09-22', 2, 10, 0.2, 2.5),
  openai('gpt-6-luna', '2026-09-22', 0.1, 0.5, 0.01, 0.125),
  openai('gpt-6.1-sol', '2026-09-29', 2, 10, 0.1, 2.5),
];

export class UsagePricer {
  private readonly findPrice: StatementSync;

  constructor(db: DatabaseSync) {
    seedPrices(db);
    this.findPrice = db.prepare(`
      SELECT * FROM model_price
      WHERE model = ? AND effective_from <= ?
      ORDER BY effective_from DESC LIMIT 1
    `);
  }

  price(event: UsagePricingInput): UsagePriceResult {
    if (!event.model) return unknownPrice();
    const tierMultiplier = serviceTierMultiplier(event);
    if (tierMultiplier === null) return unknownPrice();
    const row = this.findPrice.get(event.model, event.tsMs);
    if (!row) return unknownPrice();
    const price = priceFromRow(row);
    const longContext =
      price.maxStandardInputTokens !== null &&
      event.inputTokens !== null &&
      event.inputTokens > price.maxStandardInputTokens;
    const haikuLong = longContext && event.model === 'claude-haiku-5-5';
    let inputMultiplier = tierMultiplier;
    let outputMultiplier = tierMultiplier;
    if (longContext) {
      inputMultiplier *= haikuLong ? 5 : 2;
      outputMultiplier *= haikuLong ? 5 : 1.5;
    }
    const estimatedCostMicrousd = calculateEstimatedCost(event, {
      inputMicrousdPerMtok: scale(price.inputMicrousdPerMtok, inputMultiplier),
      outputMicrousdPerMtok: scale(price.outputMicrousdPerMtok, outputMultiplier),
      cacheWriteMicrousdPerMtok: scale(price.cacheWriteMicrousdPerMtok, inputMultiplier),
      cacheReadMicrousdPerMtok: scale(price.cacheReadMicrousdPerMtok, inputMultiplier),
      cacheWrite1hMicrousdPerMtok:
        event.model.startsWith('claude-') && price.inputMicrousdPerMtok !== null
          ? price.inputMicrousdPerMtok * 2 * inputMultiplier
          : null,
    });
    return estimatedCostMicrousd === null
      ? unknownPrice()
      : {
          estimatedCostMicrousd,
          pricingVersion: [
            price.pricingVersion,
            ...(tierMultiplier !== 1 ? [event.serviceTier] : []),
            ...(longContext ? ['long'] : []),
          ].join(':'),
        };
  }
}

export function calculateEstimatedCost(
  counts: UsageTokenCounts & Pick<UsageEvent, 'cacheWrite1hTokens'>,
  price: Pick<
    ModelPrice,
    | 'inputMicrousdPerMtok'
    | 'outputMicrousdPerMtok'
    | 'cacheWriteMicrousdPerMtok'
    | 'cacheReadMicrousdPerMtok'
  > & { cacheWrite1hMicrousdPerMtok?: number | null },
): number | null {
  const { inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens } = counts;
  if (
    inputTokens === null ||
    outputTokens === null ||
    cacheWriteTokens === null ||
    cacheReadTokens === null
  ) {
    return null;
  }
  const uncachedInputTokens = inputTokens - cacheWriteTokens - cacheReadTokens;
  const oneHourWrites = counts.cacheWrite1hTokens ?? 0;
  if (uncachedInputTokens < 0 || oneHourWrites > cacheWriteTokens) return null;
  const components = [
    [uncachedInputTokens, price.inputMicrousdPerMtok],
    [outputTokens, price.outputMicrousdPerMtok],
    [cacheWriteTokens - oneHourWrites, price.cacheWriteMicrousdPerMtok],
    [oneHourWrites, price.cacheWrite1hMicrousdPerMtok ?? null],
    [cacheReadTokens, price.cacheReadMicrousdPerMtok],
  ] as const;
  let numerator = 0n;
  for (const [tokens, rate] of components) {
    if (tokens === 0) continue;
    if (rate === null) return null;
    numerator += BigInt(tokens) * BigInt(rate);
  }
  const rounded = (numerator + MICROTOKENS_PER_MTOK / 2n) / MICROTOKENS_PER_MTOK;
  return rounded <= MAX_SAFE_INTEGER ? Number(rounded) : null;
}

function anthropic(
  model: string,
  effectiveDate: string,
  inputUsdPerMtok: number,
  outputUsdPerMtok: number,
  cacheReadUsdPerMtok: number,
  maxStandardInputTokens: number | null = null,
): ModelPrice {
  return {
    model,
    effectiveFrom: utcDate(effectiveDate),
    pricingVersion: `anthropic-${effectiveDate}-standard`,
    inputMicrousdPerMtok: microusd(inputUsdPerMtok),
    outputMicrousdPerMtok: microusd(outputUsdPerMtok),
    // The default cache TTL is five minutes; reported one-hour writes are priced separately.
    cacheWriteMicrousdPerMtok: microusd(inputUsdPerMtok * 1.25),
    cacheReadMicrousdPerMtok: microusd(cacheReadUsdPerMtok),
    maxStandardInputTokens,
  };
}

function openai(
  model: string,
  effectiveDate: string,
  inputUsdPerMtok: number,
  outputUsdPerMtok: number,
  cacheReadUsdPerMtok: number,
  cacheWriteUsdPerMtok: number,
  maxStandardInputTokens: number | null = OPENAI_SHORT_CONTEXT_LIMIT,
): ModelPrice {
  return {
    model,
    effectiveFrom: utcDate(effectiveDate),
    pricingVersion: `openai-${effectiveDate}-standard-short`,
    inputMicrousdPerMtok: microusd(inputUsdPerMtok),
    outputMicrousdPerMtok: microusd(outputUsdPerMtok),
    cacheWriteMicrousdPerMtok: microusd(cacheWriteUsdPerMtok),
    cacheReadMicrousdPerMtok: microusd(cacheReadUsdPerMtok),
    maxStandardInputTokens,
  };
}

function seedPrices(db: DatabaseSync): void {
  const insert = db.prepare(`
    INSERT INTO model_price (
      model, effective_from, pricing_version, input_microusd_per_mtok,
      output_microusd_per_mtok, cache_write_microusd_per_mtok,
      cache_read_microusd_per_mtok, max_standard_input_tokens
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(model, effective_from) DO UPDATE SET
      pricing_version = excluded.pricing_version,
      input_microusd_per_mtok = excluded.input_microusd_per_mtok,
      output_microusd_per_mtok = excluded.output_microusd_per_mtok,
      cache_write_microusd_per_mtok = excluded.cache_write_microusd_per_mtok,
      cache_read_microusd_per_mtok = excluded.cache_read_microusd_per_mtok,
      max_standard_input_tokens = excluded.max_standard_input_tokens
    WHERE pricing_version IS NOT excluded.pricing_version
      OR input_microusd_per_mtok IS NOT excluded.input_microusd_per_mtok
      OR output_microusd_per_mtok IS NOT excluded.output_microusd_per_mtok
      OR cache_write_microusd_per_mtok IS NOT excluded.cache_write_microusd_per_mtok
      OR cache_read_microusd_per_mtok IS NOT excluded.cache_read_microusd_per_mtok
      OR max_standard_input_tokens IS NOT excluded.max_standard_input_tokens
  `);
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const price of OFFICIAL_PRICES) {
      insert.run(
        price.model,
        price.effectiveFrom,
        price.pricingVersion,
        price.inputMicrousdPerMtok,
        price.outputMicrousdPerMtok,
        price.cacheWriteMicrousdPerMtok,
        price.cacheReadMicrousdPerMtok,
        price.maxStandardInputTokens,
      );
    }
    db.exec('COMMIT');
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Preserve the catalog failure.
    }
    throw error;
  }
}

function priceFromRow(row: Record<string, unknown>): ModelPrice {
  return {
    model: requiredString(row.model),
    effectiveFrom: requiredInteger(row.effective_from),
    pricingVersion: requiredString(row.pricing_version),
    inputMicrousdPerMtok: nullableInteger(row.input_microusd_per_mtok),
    outputMicrousdPerMtok: nullableInteger(row.output_microusd_per_mtok),
    cacheWriteMicrousdPerMtok: nullableInteger(row.cache_write_microusd_per_mtok),
    cacheReadMicrousdPerMtok: nullableInteger(row.cache_read_microusd_per_mtok),
    maxStandardInputTokens: nullableInteger(row.max_standard_input_tokens),
  };
}

function microusd(usd: number): number {
  return Math.round(usd * 1_000_000);
}

function utcDate(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`);
}

function serviceTierMultiplier(event: UsagePricingInput): number | null {
  const tier = event.serviceTier;
  if (tier === null || tier === 'auto' || tier === 'default' || tier === 'standard') return 1;
  if (tier === 'batch') return 0.5;
  if (tier === 'flex' && event.model?.startsWith('gpt-')) return 0.5;
  if (tier !== 'fast' && tier !== 'priority') return null;
  if (event.model?.startsWith('gpt-') && event.tsMs >= utcDate('2026-07-30')) return 2;
  if (['claude-opus-5-5', 'claude-opus-5', 'claude-opus-4-8'].includes(event.model ?? '')) return 2;
  return null;
}

function scale(rate: number | null, multiplier: number): number | null {
  return rate === null ? null : Math.round(rate * multiplier);
}

function unknownPrice(): UsagePriceResult {
  return { estimatedCostMicrousd: null, pricingVersion: null };
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw corruptCatalog();
  return value;
}

function requiredInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw corruptCatalog();
  return Number(value);
}

function nullableInteger(value: unknown): number | null {
  return value === null ? null : requiredInteger(value);
}

function corruptCatalog(): Error {
  return new Error('Usage price catalog is corrupt.');
}
