import { chmodSync } from 'node:fs';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

import type { OpaqueUsageCursor, OpaqueUsageIngestBatch } from './UsageSourceContract.js';
import { dailyUpsertSql, initializeUsageSchema, SUM_COLUMNS } from './UsageSchema.js';
import {
  canonicalTimeZone,
  createUsageSnapshot,
  dayKey,
  systemTimeZone,
  type UsageSnapshot,
} from './UsageSnapshot.js';
import type { UsageEvent, UsageIngestCursor, UsageTokenCounts } from './types.js';
import { UsagePricer } from './UsagePricing.js';
import { ClaudeUsageUpdates } from './ClaudeUsageUpdates.js';
import { UsageCursorStore } from './UsageCursorStore.js';
import { nullableRowNumber, nullableRowString, rowNumber, rowString } from './UsageRows.js';
import {
  assertCursorAdvance,
  assertExpectedCursor,
  assertExpectedOpaqueCursor,
  assertOpaqueCursorAdvance,
  validateOpaqueSourceKey,
  validateOpaqueUsageBatch,
  validateSourcePath,
  validateUsageBatch,
  type UsageIngestBatch,
} from './UsageValidation.js';

export type { UsageCursorAdvance, UsageIngestBatch } from './UsageValidation.js';
const MAX_DROIDEX_SESSION_IDS_PER_WRITE = 10_000;
const MAX_DROIDEX_SESSION_ID_LENGTH = 512;
type RollupEvent = UsageTokenCounts &
  Pick<
    UsageEvent,
    | 'harnessId'
    | 'sessionId'
    | 'tsMs'
    | 'model'
    | 'serviceTier'
    | 'providerCostMicrousd'
    | 'estimatedCostMicrousd'
    | 'cacheWrite1hTokens'
  >;

export interface UsageDatabaseOptions {
  databasePath: string;
  now?: () => number;
  timeZone?: string;
}

export class UsageDatabase {
  private readonly db: DatabaseSync;
  private readonly now: () => number;
  private readonly followsSystemTimeZone: boolean;
  private timeZone: string;
  private readonly insertEventStatement: StatementSync;
  private readonly insertDroidexSessionStatement: StatementSync;
  private readonly upsertDailyStatement: StatementSync;
  private readonly upsertHarnessStatement: StatementSync;
  private readonly upsertSessionStatement: StatementSync;
  private readonly upsertSessionModelStatement: StatementSync;
  private readonly updateSessionUsageStatement: StatementSync;
  private readonly updateRollupStateStatement: StatementSync;
  private readonly writeRollupStateStatement: StatementSync;
  private readonly cursors: UsageCursorStore;
  private readonly pricer: UsagePricer;
  private readonly claudeUpdates: ClaudeUsageUpdates;
  private closed = false;

  constructor(options: UsageDatabaseOptions) {
    if (typeof options.databasePath !== 'string' || options.databasePath.length === 0) {
      throw new Error('Usage database path is required.');
    }
    this.now = options.now ?? Date.now;
    this.followsSystemTimeZone = options.timeZone === undefined;
    this.timeZone = canonicalTimeZone(options.timeZone ?? systemTimeZone());
    this.db = new DatabaseSync(options.databasePath);
    try {
      initializeUsageSchema(this.db, options.databasePath);
      secureDatabaseFiles(options.databasePath);
      this.insertEventStatement = this.db.prepare(`
        INSERT INTO usage_event (
          dedupe_key, harness_id, source_id, session_id, project, session_started_at,
          ts, model, service_tier,
          input_tokens, output_tokens, cache_write_tokens, cache_read_tokens,
          reasoning_tokens, provider_cost_microusd, estimated_cost_microusd, pricing_version,
          cache_write_1h_tokens, provider, cost_microusd
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(harness_id, dedupe_key) DO NOTHING
      `);
      this.insertDroidexSessionStatement = this.db.prepare(
        'INSERT OR IGNORE INTO droidex_session (id) VALUES (?)',
      );
      this.upsertDailyStatement = this.db.prepare(dailyUpsertSql());
      this.upsertHarnessStatement = this.db.prepare(`
        INSERT INTO harness (id, display_name) VALUES (?, ?)
        ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name
      `);
      this.upsertSessionStatement = this.db.prepare(`
        INSERT INTO usage_session (harness_id, id, project, started_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(harness_id, id) DO UPDATE SET
          project = COALESCE(usage_session.project, excluded.project),
          started_at = COALESCE(usage_session.started_at, excluded.started_at)
      `);
      this.upsertSessionModelStatement = this.db.prepare(`
        INSERT OR IGNORE INTO usage_session_model
          (harness_id, session_id, model_key, model) VALUES (?, ?, ?, ?)
      `);
      this.updateSessionUsageStatement = this.db.prepare(`
        UPDATE usage_session SET
          started_at = CASE WHEN started_at IS NULL THEN ? ELSE MIN(started_at, ?) END,
          ended_at = CASE WHEN ended_at IS NULL THEN ? ELSE MAX(ended_at, ?) END,
          turn_count = CASE WHEN harness_id = 'droid' THEN NULL ELSE COALESCE(turn_count, 0) + 1 END
        WHERE harness_id = ? AND id = ?
      `);
      this.updateRollupStateStatement = this.db.prepare(`
        UPDATE rollup_state SET event_count = event_count + ?,
          first_event_at = CASE
            WHEN ? IS NULL THEN first_event_at
            WHEN first_event_at IS NULL THEN ?
            ELSE MIN(first_event_at, ?)
          END,
          updated_at = ? WHERE id = 1
      `);
      this.writeRollupStateStatement = this.db.prepare(`
        INSERT INTO rollup_state (id, timezone, event_count, first_event_at, updated_at)
        VALUES (1, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          timezone = excluded.timezone,
          event_count = excluded.event_count,
          first_event_at = excluded.first_event_at,
          updated_at = excluded.updated_at
      `);
      this.cursors = new UsageCursorStore(this.db);
      this.pricer = new UsagePricer(this.db);
      this.claudeUpdates = new ClaudeUsageUpdates(this.db);
      this.ensureRollup();
      secureDatabaseFiles(options.databasePath);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  cursor(sourcePath: string): UsageIngestCursor | null {
    this.assertOpen();
    validateSourcePath(sourcePath);
    return this.cursors.readCursor(sourcePath);
  }

  ingest(batch: UsageIngestBatch): { insertedEvents: number; cursor: UsageIngestCursor } {
    this.assertOpen();
    validateUsageBatch(batch);
    this.reconcileTimeZone();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const current = this.cursor(batch.nextCursor.sourcePath);
      assertExpectedCursor(current, batch.expectedCursor);
      assertCursorAdvance(current, batch.nextCursor, batch.reset);
      const inserted = this.insertEvents(batch.events);
      const cursor = this.cursors.writeCursor(current, batch.nextCursor);
      this.updateRollupState(inserted.count, inserted.firstEventAt);
      this.db.exec('COMMIT');
      return { insertedEvents: inserted.count, cursor };
    } catch (error) {
      rollback(this.db);
      throw error;
    }
  }

  usageSourceCursor(sourcePath: string, adapterName: string): OpaqueUsageCursor | null {
    this.assertOpen();
    validateOpaqueSourceKey(sourcePath, adapterName);
    return this.cursors.readSourceCursor(sourcePath, adapterName);
  }

  ingestUsageSource(batch: OpaqueUsageIngestBatch): {
    insertedEvents: number;
    cursor: OpaqueUsageCursor;
  } {
    this.assertOpen();
    validateOpaqueUsageBatch(batch);
    this.reconcileTimeZone();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const current = this.usageSourceCursor(
        batch.nextCursor.sourcePath,
        batch.nextCursor.adapterName,
      );
      assertExpectedOpaqueCursor(current, batch.expectedCursor);
      assertOpaqueCursorAdvance(current, batch.nextCursor, batch.reset);
      const inserted = this.insertEvents(batch.events);
      const cursor = this.cursors.writeSourceCursor(current, batch.nextCursor);
      this.updateRollupState(inserted.count, inserted.firstEventAt);
      this.db.exec('COMMIT');
      return { insertedEvents: inserted.count, cursor };
    } catch (error) {
      rollback(this.db);
      throw error;
    }
  }

  rebuildDaily(timeZone = this.timeZone): void {
    this.assertOpen();
    const canonical = canonicalTimeZone(timeZone);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.exec('DELETE FROM usage_daily');
      this.db.exec('DELETE FROM usage_session_model');
      const rows = this.db.prepare('SELECT * FROM usage_event ORDER BY id').iterate();
      let firstEventAt: number | null = null;
      for (const row of rows) {
        const event = eventFromRow(row);
        this.addDaily({ ...event, ...this.pricer.price(event) }, canonical);
        this.upsertSessionModel(event);
        firstEventAt = firstEventAt === null ? event.tsMs : Math.min(firstEventAt, event.tsMs);
      }
      const count = scalarNumber(this.db, 'SELECT COUNT(*) AS value FROM usage_event');
      this.writeRollupStateStatement.run(canonical, count, firstEventAt, this.now());
      this.db.exec('COMMIT');
      this.timeZone = canonical;
    } catch (error) {
      rollback(this.db);
      throw error;
    }
  }

  recordDroidexSessions(ids: readonly string[]): { insertedSessions: number } {
    this.assertOpen();
    validateDroidexSessionIds(ids);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      let insertedSessions = 0;
      for (const id of ids) {
        insertedSessions += Number(this.insertDroidexSessionStatement.run(id).changes);
      }
      this.db.exec('COMMIT');
      return { insertedSessions };
    } catch (error) {
      rollback(this.db);
      throw error;
    }
  }

  snapshot(): UsageSnapshot {
    this.assertOpen();
    this.reconcileTimeZone();
    return createUsageSnapshot(this.db, this.now(), this.timeZone);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Usage database is closed.');
  }

  private ensureRollup(): void {
    const state = this.db
      .prepare('SELECT timezone, event_count FROM rollup_state WHERE id = 1')
      .get();
    const eventCount = scalarNumber(this.db, 'SELECT COUNT(*) AS value FROM usage_event');
    if (
      !state ||
      rowString(state, 'timezone') !== this.timeZone ||
      rowNumber(state, 'event_count') !== eventCount
    ) {
      this.rebuildDaily(this.timeZone);
    }
  }

  private reconcileTimeZone(): void {
    if (!this.followsSystemTimeZone) return;
    const current = canonicalTimeZone(systemTimeZone());
    if (current !== this.timeZone) this.rebuildDaily(current);
  }

  private insertEvents(events: readonly UsageEvent[]): {
    count: number;
    firstEventAt: number | null;
  } {
    let count = 0;
    let firstEventAt: number | null = null;
    this.upsertDimensions(events);
    for (const event of events) {
      const pricedEvent = { ...event, ...this.pricer.price(event) };
      const inserted = this.insertEventStatement.run(
        pricedEvent.dedupeKey,
        pricedEvent.harnessId,
        pricedEvent.sourceId,
        pricedEvent.sessionId,
        pricedEvent.project,
        pricedEvent.sessionStartedAtMs,
        pricedEvent.tsMs,
        pricedEvent.model,
        pricedEvent.serviceTier,
        pricedEvent.inputTokens,
        pricedEvent.outputTokens,
        pricedEvent.cacheWriteTokens,
        pricedEvent.cacheReadTokens,
        pricedEvent.reasoningTokens,
        pricedEvent.providerCostMicrousd,
        pricedEvent.estimatedCostMicrousd,
        pricedEvent.pricingVersion,
        pricedEvent.cacheWrite1hTokens ?? null,
        pricedEvent.provider ?? providerForHarness(pricedEvent.harnessId),
        pricedEvent.providerCostMicrousd ?? pricedEvent.estimatedCostMicrousd,
      ).changes;
      if (Number(inserted) === 0) {
        this.claudeUpdates.replace(pricedEvent, this.timeZone);
        continue;
      }
      count += 1;
      firstEventAt = firstEventAt === null ? event.tsMs : Math.min(firstEventAt, event.tsMs);
      this.addDaily(pricedEvent);
      this.upsertSessionModel(pricedEvent);
      if (pricedEvent.sessionId)
        this.updateSessionUsageStatement.run(
          pricedEvent.tsMs,
          pricedEvent.tsMs,
          pricedEvent.tsMs,
          pricedEvent.tsMs,
          pricedEvent.harnessId,
          pricedEvent.sessionId,
        );
    }
    return { count, firstEventAt };
  }

  private upsertDimensions(events: readonly UsageEvent[]): void {
    const harnesses = new Map<string, string>();
    const sessions = new Map<
      string,
      Map<string, { project: string | null; startedAt: number | null }>
    >();
    for (const event of events) {
      harnesses.set(event.harnessId, event.harnessDisplayName);
      if (!event.sessionId) continue;
      let byId = sessions.get(event.harnessId);
      if (!byId) {
        byId = new Map();
        sessions.set(event.harnessId, byId);
      }
      const previous = byId.get(event.sessionId);
      byId.set(event.sessionId, {
        project: previous?.project ?? event.project,
        startedAt: previous?.startedAt ?? event.sessionStartedAtMs,
      });
    }
    for (const [id, displayName] of harnesses) {
      this.upsertHarnessStatement.run(id, displayName);
    }
    for (const [harnessId, byId] of sessions) {
      for (const [sessionId, session] of byId) {
        this.upsertSessionStatement.run(harnessId, sessionId, session.project, session.startedAt);
      }
    }
  }

  private updateRollupState(insertedEvents: number, firstEventAt: number | null): void {
    this.updateRollupStateStatement.run(
      insertedEvents,
      firstEventAt,
      firstEventAt,
      firstEventAt,
      this.now(),
    );
  }

  private upsertSessionModel(event: RollupEvent): void {
    if (!event.sessionId) return;
    this.upsertSessionModelStatement.run(
      event.harnessId,
      event.sessionId,
      event.model ?? '',
      event.model,
    );
  }

  private addDaily(event: RollupEvent, timeZone = this.timeZone): void {
    const values = SUM_COLUMNS.flatMap((column) => {
      const value = eventColumn(event, column);
      return [value, value === null ? 0 : 1];
    });
    this.upsertDailyStatement.run(
      dayKey(event.tsMs, timeZone),
      event.harnessId,
      event.model ?? '',
      event.model,
      1,
      ...values,
    );
  }
}

function validateDroidexSessionIds(ids: readonly string[]): void {
  if (!Array.isArray(ids) || ids.length > MAX_DROIDEX_SESSION_IDS_PER_WRITE) {
    throw new Error('DROIDEX session ID batch is invalid.');
  }
  for (const id of ids) {
    if (
      typeof id !== 'string' ||
      id.length === 0 ||
      id.length > MAX_DROIDEX_SESSION_ID_LENGTH ||
      id.includes('\0')
    ) {
      throw new Error('DROIDEX session ID is invalid.');
    }
  }
}

function eventFromRow(row: Record<string, unknown>): RollupEvent {
  return {
    harnessId: rowString(row, 'harness_id'),
    sessionId: nullableRowString(row, 'session_id'),
    tsMs: rowNumber(row, 'ts'),
    model: nullableRowString(row, 'model'),
    serviceTier: nullableRowString(row, 'service_tier'),
    inputTokens: nullableRowNumber(row, 'input_tokens'),
    outputTokens: nullableRowNumber(row, 'output_tokens'),
    cacheWriteTokens: nullableRowNumber(row, 'cache_write_tokens'),
    cacheReadTokens: nullableRowNumber(row, 'cache_read_tokens'),
    reasoningTokens: nullableRowNumber(row, 'reasoning_tokens'),
    providerCostMicrousd: nullableRowNumber(row, 'provider_cost_microusd'),
    estimatedCostMicrousd: nullableRowNumber(row, 'estimated_cost_microusd'),
    cacheWrite1hTokens: nullableRowNumber(row, 'cache_write_1h_tokens'),
  };
}

function eventColumn(event: RollupEvent, column: (typeof SUM_COLUMNS)[number]): number | null {
  const fields: Record<(typeof SUM_COLUMNS)[number], number | null> = {
    input_tokens: event.inputTokens,
    output_tokens: event.outputTokens,
    cache_write_tokens: event.cacheWriteTokens,
    cache_read_tokens: event.cacheReadTokens,
    reasoning_tokens: event.reasoningTokens,
    provider_cost_microusd: event.providerCostMicrousd,
    estimated_cost_microusd: event.estimatedCostMicrousd,
    cost_microusd: event.providerCostMicrousd ?? event.estimatedCostMicrousd,
  };
  return fields[column];
}

function providerForHarness(harnessId: string): string | null {
  if (harnessId === 'claude-code') return 'anthropic';
  if (harnessId === 'codex') return 'openai';
  if (harnessId === 'droid') return 'factory';
  return null;
}

function scalarNumber(db: DatabaseSync, sql: string): number {
  return rowNumber(db.prepare(sql).get(), 'value');
}

function rollback(db: DatabaseSync): void {
  try {
    db.exec('ROLLBACK');
  } catch {
    // Preserve the original SQLite failure.
  }
}

function secureDatabaseFiles(databasePath: string): void {
  for (const path of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
    try {
      chmodSync(path, 0o600);
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') throw error;
    }
  }
}

function errorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
}
