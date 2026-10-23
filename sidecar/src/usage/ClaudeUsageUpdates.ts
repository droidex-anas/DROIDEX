import type { DatabaseSync, StatementSync } from 'node:sqlite';

import { SUM_COLUMNS } from './UsageSchema.js';
import { dayKey } from './UsageSnapshot.js';
import type { UsageEvent } from './types.js';

/** A streamed Claude message may repeat with its final, larger usage snapshot. */
export class ClaudeUsageUpdates {
  private readonly find: StatementSync;
  private readonly update: StatementSync;
  private readonly updateDaily: StatementSync;

  constructor(db: DatabaseSync) {
    this.find = db.prepare('SELECT * FROM usage_event WHERE harness_id = ? AND dedupe_key = ?');
    this.update = db.prepare(`UPDATE usage_event SET
      ${SUM_COLUMNS.map((column) => `${column} = ?`).join(',')},
      cache_write_1h_tokens = ?, pricing_version = ? WHERE id = ?`);
    this.updateDaily = db.prepare(`UPDATE usage_daily SET ${SUM_COLUMNS.map(
      (column) =>
        `${column} = CASE WHEN ${column}_known_events + ? = 0 THEN NULL ELSE COALESCE(${column}, 0) + ? END,
       ${column}_known_events = ${column}_known_events + ?`,
    ).join(',')}
      WHERE day = ? AND harness_id = ? AND model_key = ?`);
  }

  replace(event: UsageEvent, timeZone: string): void {
    if (event.harnessId !== 'claude-code') return;
    const previous = this.find.get(event.harnessId, event.dedupeKey);
    if (!previous) return;
    const tokens = (event.inputTokens ?? 0) + (event.outputTokens ?? 0);
    const previousTokens = Number(previous.input_tokens ?? 0) + Number(previous.output_tokens ?? 0);
    if (tokens <= previousTokens) return;
    const values = [
      event.inputTokens,
      event.outputTokens,
      event.cacheWriteTokens,
      event.cacheReadTokens,
      event.reasoningTokens,
      event.providerCostMicrousd,
      event.estimatedCostMicrousd,
      event.providerCostMicrousd ?? event.estimatedCostMicrousd,
    ];
    this.update.run(
      ...values,
      event.cacheWrite1hTokens ?? null,
      event.pricingVersion,
      Number(previous.id),
    );
    const deltas = SUM_COLUMNS.flatMap((column, index) => {
      const before = previous[column];
      const after = values[index];
      const knownDelta = Number(after !== null) - Number(before !== null);
      return [knownDelta, (after ?? 0) - Number(before ?? 0), knownDelta];
    });
    this.updateDaily.run(
      ...deltas,
      dayKey(Number(previous.ts), timeZone),
      event.harnessId,
      String(previous.model ?? ''),
    );
  }
}
