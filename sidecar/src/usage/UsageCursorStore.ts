import type { DatabaseSync, StatementSync } from 'node:sqlite';

import { CURSOR_GUARD_BYTES } from './UsageSchema.js';
import { rowBlob, rowNumber, rowString } from './UsageRows.js';
import type { OpaqueUsageCursor, OpaqueUsageCursorAdvance } from './UsageSourceContract.js';
import type { UsageIngestCursor } from './types.js';
import {
  isUsageParserName,
  validateOpaqueCursor,
  type UsageCursorAdvance,
} from './UsageValidation.js';

/** Revisioned ingest cursors; writes are compare-and-set and run inside the caller's transaction. */
export class UsageCursorStore {
  private readonly readCursorStatement: StatementSync;
  private readonly updateCursorStatement: StatementSync;
  private readonly insertCursorStatement: StatementSync;
  private readonly readSourceCursorStatement: StatementSync;
  private readonly updateSourceCursorStatement: StatementSync;
  private readonly insertSourceCursorStatement: StatementSync;

  constructor(db: DatabaseSync) {
    this.readCursorStatement = db.prepare('SELECT * FROM ingest_cursor WHERE source_path = ?');
    this.readSourceCursorStatement = db.prepare(
      'SELECT * FROM usage_source_cursor WHERE source_path = ? AND adapter_name = ?',
    );
    this.updateCursorStatement = db.prepare(`
      UPDATE ingest_cursor SET
        source_id = ?, file_identity = ?, byte_offset = ?, file_size = ?, mtime_ms = ?,
        guard = ?, parser_name = ?, parser_version = ?, parser_state = ?,
        discarding_oversized = ?, revision = ?
      WHERE source_path = ? AND revision = ?
    `);
    this.insertCursorStatement = db.prepare(`
      INSERT INTO ingest_cursor (
        source_path, source_id, file_identity, byte_offset, file_size, mtime_ms,
        guard, parser_name, parser_version, parser_state, discarding_oversized, revision
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.updateSourceCursorStatement = db.prepare(`
      UPDATE usage_source_cursor SET
        source_id = ?, adapter_version = ?, state = ?, revision = ?
      WHERE adapter_name = ? AND source_path = ? AND revision = ?
    `);
    this.insertSourceCursorStatement = db.prepare(`
      INSERT INTO usage_source_cursor (
        source_path, source_id, adapter_name, adapter_version, state, revision
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);
  }

  readCursor(sourcePath: string): UsageIngestCursor | null {
    const row = this.readCursorStatement.get(sourcePath);
    return row ? cursorFromRow(row) : null;
  }

  readSourceCursor(sourcePath: string, adapterName: string): OpaqueUsageCursor | null {
    const row = this.readSourceCursorStatement.get(sourcePath, adapterName);
    if (!row) return null;
    const cursor = sourceCursorFromRow(row);
    validateOpaqueCursor(cursor, true);
    return cursor;
  }

  writeCursor(current: UsageIngestCursor | null, next: UsageCursorAdvance): UsageIngestCursor {
    const revision = (current?.revision ?? 0) + 1;
    const values = [
      next.sourceId,
      next.fileIdentity,
      next.byteOffset,
      next.fileSize,
      next.mtimeMs,
      next.guard,
      next.parserName,
      next.parserVersion,
      next.parserState,
      Number(next.discardingOversized),
      revision,
    ] as const;
    if (current) {
      const changed = this.updateCursorStatement.run(
        ...values,
        next.sourcePath,
        current.revision,
      ).changes;
      if (Number(changed) !== 1) throw new Error('Usage ingest cursor is stale.');
    } else {
      this.insertCursorStatement.run(next.sourcePath, ...values);
    }
    return { ...next, guard: new Uint8Array(next.guard), revision };
  }

  writeSourceCursor(
    current: OpaqueUsageCursor | null,
    next: OpaqueUsageCursorAdvance,
  ): OpaqueUsageCursor {
    const revision = (current?.revision ?? 0) + 1;
    if (current) {
      const changed = this.updateSourceCursorStatement.run(
        next.sourceId,
        next.adapterVersion,
        next.state,
        revision,
        next.adapterName,
        next.sourcePath,
        current.revision,
      ).changes;
      if (Number(changed) !== 1) throw new Error('Usage source cursor is stale.');
    } else {
      this.insertSourceCursorStatement.run(
        next.sourcePath,
        next.sourceId,
        next.adapterName,
        next.adapterVersion,
        next.state,
        revision,
      );
    }
    return { ...next, revision };
  }
}

function cursorFromRow(row: Record<string, unknown>): UsageIngestCursor {
  const parserName = rowString(row, 'parser_name');
  if (!isUsageParserName(parserName)) throw new Error('Usage cursor parser is invalid.');
  const guard = rowBlob(row, 'guard', CURSOR_GUARD_BYTES);
  return {
    sourcePath: rowString(row, 'source_path'),
    sourceId: rowString(row, 'source_id'),
    fileIdentity: rowString(row, 'file_identity'),
    byteOffset: rowNumber(row, 'byte_offset'),
    fileSize: rowNumber(row, 'file_size'),
    mtimeMs: rowNumber(row, 'mtime_ms'),
    guard: new Uint8Array(guard),
    parserName,
    parserVersion: rowNumber(row, 'parser_version'),
    parserState: rowString(row, 'parser_state'),
    discardingOversized: rowNumber(row, 'discarding_oversized') === 1,
    revision: rowNumber(row, 'revision'),
  };
}

function sourceCursorFromRow(row: Record<string, unknown>): OpaqueUsageCursor {
  return {
    sourcePath: rowString(row, 'source_path'),
    sourceId: rowString(row, 'source_id'),
    adapterName: rowString(row, 'adapter_name'),
    adapterVersion: rowNumber(row, 'adapter_version'),
    state: rowString(row, 'state'),
    revision: rowNumber(row, 'revision'),
  };
}
