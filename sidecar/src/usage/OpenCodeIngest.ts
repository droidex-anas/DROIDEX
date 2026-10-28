/* eslint-disable complexity -- bounded source adapter state machine. */
import { createHash } from 'node:crypto';
import { lstat, opendir, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { OpaqueUsageCursor, OpaqueUsageSourceStore } from './UsageSourceContract.js';
import type { UsageEvent } from './types.js';
const ADAPTER_NAME = 'opencode-sqlite';
const ADAPTER_VERSION = 2;
const DEFAULT_PAGE_SIZE = 8;
const DEFAULT_MAX_PAGES = 16;
const DEFAULT_MAX_ROWS = 1_024;
const DEFAULT_MAX_BYTES = 8 * 1_024 * 1_024;
const MAX_BYTES_PER_RECONCILE = 64 * 1_024 * 1_024;
const MAX_ROW_DATA_BYTES = 1_024 * 1_024;
const MAX_ROOTS = 32;
const MAX_DATABASES_PER_ROOT = 64;
const MAX_UNFINISHED_ROWS = 1_024;
const DATABASE_NAME = /^opencode(?:-[a-zA-Z0-9_-]+)?\.db$/;
const TABLES = ['message', 'session_message'] as const;
const MAX_TEXT_BYTES = 1_024;
const MAX_MODEL_LENGTH = 160;
const MAX_DATE_MS = 8_640_000_000_000_000;
type OpenCodeTable = (typeof TABLES)[number];
// prettier-ignore
export interface OpenCodeIngestOptions { store: OpaqueUsageSourceStore; roots?: readonly string[]; env?: Readonly<Record<string, string | undefined>>; homeDir?: string; pageSize?: number; maxPagesPerReconcile?: number; maxRowsPerReconcile?: number; maxBytesPerReconcile?: number }
// prettier-ignore
export interface OpenCodeReconcileResult { discoveredDatabases: number; processedDatabases: number; insertedEvents: number; malformedRows: number; unavailableSources: number; backlog: boolean }
// prettier-ignore
interface TableState { after: number; unfinished: number[] }
// prettier-ignore
interface CursorState { fileIdentity: string; tables: Partial<Record<OpenCodeTable, TableState>> }
// prettier-ignore
interface TableInfo { name: OpenCodeTable; columns: ReadonlySet<string>; maxRowId: number }
// prettier-ignore
interface OpenCodeRow { rowId: number; id: string | null; sessionId: string | null; data: unknown; dataBytes: number; created: number | null }
// prettier-ignore
interface Progress { cursor: OpaqueUsageCursor | null; state: CursorState; reset: boolean; inserted: number; malformed: number }
// prettier-ignore
interface SourceContext { sourcePath: string; sourceId: string }
// prettier-ignore
interface Budget { pages: number; rows: number; bytes: number }
type ParsedRow =
  | { kind: 'event'; event: UsageEvent }
  | { kind: 'unfinished' | 'skip' | 'malformed' };

export class OpenCodeIngest {
  private readonly roots: string[];
  private readonly pageSize: number;
  private readonly maxPages: number;
  private readonly maxRows: number;
  private readonly maxBytes: number;
  private nextDatabasePath: string | null = null;
  constructor(private readonly options: OpenCodeIngestOptions) {
    this.roots = normalizeRoots(
      options.roots ?? openCodeDataRoots(options.env ?? process.env, options.homeDir ?? homedir()),
    );
    this.pageSize = boundedInteger(options.pageSize ?? DEFAULT_PAGE_SIZE, 'page size', 1_000);
    this.maxPages = positiveInteger(options.maxPagesPerReconcile ?? DEFAULT_MAX_PAGES, 'pages');
    this.maxRows = positiveInteger(options.maxRowsPerReconcile ?? DEFAULT_MAX_ROWS, 'rows');
    this.maxBytes = boundedInteger(
      options.maxBytesPerReconcile ?? DEFAULT_MAX_BYTES,
      'bytes',
      MAX_BYTES_PER_RECONCILE,
    );
    if (this.maxBytes < MAX_ROW_DATA_BYTES) {
      throw new Error(`OpenCode bytes must be at least ${String(MAX_ROW_DATA_BYTES)}.`);
    }
  }
  async reconcile(): Promise<OpenCodeReconcileResult> {
    const budget = { pages: this.maxPages, rows: this.maxRows, bytes: this.maxBytes };
    const result: OpenCodeReconcileResult = {
      discoveredDatabases: 0,
      processedDatabases: 0,
      insertedEvents: 0,
      malformedRows: 0,
      unavailableSources: 0,
      backlog: false,
    };
    const candidates: { root: string; path: string }[] = [];
    for (const root of this.roots) {
      for (const path of await databasesIn(root)) candidates.push({ root, path });
    }
    result.discoveredDatabases = candidates.length;
    if (candidates.length === 0) return result;
    const requestedStart = this.nextDatabasePath
      ? candidates.findIndex((candidate) => candidate.path === this.nextDatabasePath)
      : -1;
    const start = requestedStart < 0 ? 0 : requestedStart;
    for (let offset = 0; offset < candidates.length; offset += 1) {
      if (exhausted(budget)) return { ...result, backlog: true };
      const index = (start + offset) % candidates.length;
      const candidate = candidates[index];
      this.nextDatabasePath = candidates[(index + 1) % candidates.length]?.path ?? null;
      try {
        const scanned = await this.scanDatabase(candidate.root, candidate.path, budget);
        if (!scanned) continue;
        result.processedDatabases += 1;
        result.insertedEvents += scanned.insertedEvents;
        result.malformedRows += scanned.malformedRows;
        if (scanned.backlog) return { ...result, backlog: true };
      } catch (error) {
        if (!isUnavailable(error)) throw error;
        result.unavailableSources += 1;
      }
    }
    return result;
  }
  private async scanDatabase(root: string, candidate: string, budget: Budget) {
    const stats = await lstat(candidate);
    if (!stats.isFile() || stats.isSymbolicLink()) return null;
    const sourcePath = await realpath(candidate);
    if (!inside(await realpath(root), sourcePath)) return null;
    const source = { sourcePath, sourceId: `opencode:${hash(sourcePath)}` };
    const cursor = this.options.store.usageSourceCursor(sourcePath, ADAPTER_NAME);
    const prior = cursor ? restoreState(cursor, source) : null;
    const fileIdentity = `${String(stats.dev)}:${String(stats.ino)}`;
    const reset = prior !== null && prior.fileIdentity !== fileIdentity;
    const progress: Progress = {
      cursor,
      state: { fileIdentity, tables: reset ? {} : cloneTables(prior?.tables) },
      reset,
      inserted: 0,
      malformed: 0,
    };
    const database = new DatabaseSync(sourcePath, { readOnly: true });
    try {
      database.exec('PRAGMA busy_timeout = 100; PRAGMA query_only = ON');
      const tables = inspectTables(database);
      if (tables.length === 0) throw new Error(`Unsupported OpenCode database: ${sourcePath}`);
      retainTables(progress.state, tables);
      let backlog = false;
      for (const table of tables) {
        let state = tableState(progress.state, table.name);
        if (exhausted(budget)) {
          backlog = state.after !== table.maxRowId;
          if (backlog) break;
          continue;
        }
        if (table.maxRowId < state.after) {
          state = { after: 0, unfinished: [] };
          progress.state.tables[table.name] = state;
          progress.reset = progress.cursor !== null;
        }
        backlog = this.scanTable(database, table, source, progress, budget);
        if (backlog) break;
      }
      if (
        !progress.cursor ||
        progress.reset ||
        progress.cursor.state !== serialize(progress.state)
      ) {
        this.commit(source, progress, []);
      }
      return {
        insertedEvents: progress.inserted,
        malformedRows: progress.malformed,
        backlog,
      };
    } finally {
      database.close();
    }
  }
  private scanTable(
    database: DatabaseSync,
    table: TableInfo,
    source: SourceContext,
    progress: Progress,
    budget: Budget,
  ): boolean {
    const state = tableState(progress.state, table.name);
    const pendingAtStart = [...state.unfinished];
    const stillUnfinished: number[] = [];
    // prettier-ignore
    const pendingBudget = {
      pages: Math.floor(budget.pages / 2),
      rows: Math.floor(budget.rows / 2),
      bytes: Math.floor(budget.bytes / 2),
    };
    let pendingIndex = 0;
    while (pendingIndex < pendingAtStart.length && !exhausted(pendingBudget)) {
      // prettier-ignore
      const size = pageLimit(this.pageSize, pendingBudget, pendingAtStart.length - pendingIndex);
      const ids = pendingAtStart.slice(pendingIndex, pendingIndex + size);
      const rows = readPending(database, table, ids);
      const bytes = rowBytes(rows);
      spend(budget, ids.length, bytes);
      spend(pendingBudget, ids.length, bytes);
      const byId = new Map(rows.map((row) => [row.rowId, row]));
      const events: UsageEvent[] = [];
      for (const id of ids) {
        const row = byId.get(id);
        if (!row) continue;
        const parsed = parseRow(row, source.sourceId);
        if (parsed.kind === 'unfinished') stillUnfinished.push(id);
        else if (parsed.kind === 'event') events.push(parsed.event);
        else if (parsed.kind === 'malformed') progress.malformed += 1;
      }
      pendingIndex += ids.length;
      state.unfinished = [...pendingAtStart.slice(pendingIndex), ...stillUnfinished];
      this.commit(source, progress, events);
    }
    state.unfinished = [...pendingAtStart.slice(pendingIndex), ...stillUnfinished];
    while (state.after < table.maxRowId && !exhausted(budget)) {
      const limit = pageLimit(this.pageSize, budget);
      const rows = readForward(database, table, state.after, table.maxRowId, limit);
      spend(budget, rows.length, rowBytes(rows));
      const events: UsageEvent[] = [];
      for (const row of rows) {
        const parsed = parseRow(row, source.sourceId);
        if (parsed.kind === 'unfinished') {
          if (state.unfinished.length >= MAX_UNFINISHED_ROWS) {
            const oldest = Math.min(...state.unfinished);
            state.unfinished.splice(state.unfinished.indexOf(oldest), 1);
          }
          state.unfinished.push(row.rowId);
        } else if (parsed.kind === 'event') events.push(parsed.event);
        else if (parsed.kind === 'malformed') progress.malformed += 1;
      }
      state.after = rows.length < limit ? table.maxRowId : (rows.at(-1)?.rowId ?? table.maxRowId);
      this.commit(source, progress, events);
    }
    return state.after < table.maxRowId;
  }
  private commit(source: SourceContext, progress: Progress, events: readonly UsageEvent[]): void {
    const committed = this.options.store.ingestUsageSource({
      expectedCursor: progress.cursor,
      nextCursor: {
        ...source,
        adapterName: ADAPTER_NAME,
        adapterVersion: ADAPTER_VERSION,
        state: serialize(progress.state),
      },
      reset: progress.reset,
      events,
    });
    progress.cursor = committed.cursor;
    progress.inserted += committed.insertedEvents;
    progress.reset = false;
  }
}

export function openCodeDataRoots(
  env: Readonly<Record<string, string | undefined>> = process.env,
  homeDir = homedir(),
): string[] {
  const configured = envValue(env, 'OPENCODE_DATA_DIR');
  if (configured?.trim()) {
    return normalizeRoots(configured.split(',').map((path) => expandHome(path.trim(), homeDir)));
  }
  const xdg = envValue(env, 'XDG_DATA_HOME');
  const base = xdg?.trim() ? expandHome(xdg.trim(), homeDir) : join(homeDir, '.local/share');
  return [resolve(base, 'opencode')];
}
async function databasesIn(root: string): Promise<string[]> {
  const names: string[] = [];
  let directory;
  try {
    directory = await opendir(root);
  } catch (error) {
    if (isUnavailable(error)) return names;
    throw error;
  }
  for await (const entry of directory) {
    if (!entry.isFile() || !DATABASE_NAME.test(entry.name)) continue;
    if (names.length === MAX_DATABASES_PER_ROOT) {
      throw new Error(
        `OpenCode database count exceeds ${String(MAX_DATABASES_PER_ROOT)} in ${root}.`,
      );
    }
    names.push(entry.name);
  }
  names.sort(compareDatabaseNames);
  return names.map((name) => join(root, name));
}
function inspectTables(database: DatabaseSync): TableInfo[] {
  const existing = new Set(
    database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('message', 'session_message')",
      )
      .all()
      .map((row) => requiredString(field(row, 'name'), 'table')),
  );
  const result: TableInfo[] = [];
  for (const name of TABLES) {
    if (!existing.has(name)) continue;
    const columns = new Set(
      database
        .prepare(`PRAGMA table_info(${name})`)
        .all()
        .map((row) => requiredString(field(row, 'name'), 'column')),
    );
    if (!columns.has('id') || !columns.has('data')) continue;
    const value = field(database.prepare(`SELECT MAX(rowid) AS value FROM ${name}`).get(), 'value');
    result.push({ name, columns, maxRowId: value === null ? 0 : requiredInteger(value, 'rowid') });
  }
  return result;
}
// prettier-ignore
function readForward(database: DatabaseSync, table: TableInfo, after: number, max: number, limit: number): OpenCodeRow[] { return readRows(database, table, 'rowid > ? AND rowid <= ?', [after, max], limit) }
// prettier-ignore
function readPending(database: DatabaseSync, table: TableInfo, ids: readonly number[]): OpenCodeRow[] { return readRows(database, table, `rowid IN (${ids.map(() => '?').join(',')})`, ids, ids.length) }
function readRows(
  database: DatabaseSync,
  table: TableInfo,
  predicate: string,
  parameters: readonly number[],
  limit: number,
): OpenCodeRow[] {
  const session = table.columns.has('session_id') ? 'session_id' : 'NULL';
  const created = table.columns.has('time_created') ? 'time_created' : 'NULL';
  const assistant =
    table.name === 'session_message' && table.columns.has('type') ? " AND type = 'assistant'" : '';
  const rows = database
    .prepare(
      `SELECT rowid AS row_id,
        CASE WHEN typeof(id)='text' AND length(CAST(id AS BLOB))<=1024 THEN id END AS id,
        CASE WHEN typeof(${session})='text' AND length(CAST(${session} AS BLOB))<=1024 THEN ${session} END AS session_id,
        CASE WHEN typeof(data)='text' AND length(CAST(data AS BLOB))<=1048576 THEN data END AS data,
        MIN(COALESCE(length(CAST(data AS BLOB)), 0), 1048576) AS data_bytes,
        ${created} AS created FROM ${table.name}
       WHERE ${predicate}${assistant} ORDER BY rowid LIMIT ?`,
    )
    .all(...parameters, limit);
  return rows.map((row) => ({
    rowId: requiredInteger(field(row, 'row_id'), 'rowid'),
    id: text(field(row, 'id')),
    sessionId: text(field(row, 'session_id')),
    data: field(row, 'data'),
    dataBytes: requiredInteger(field(row, 'data_bytes'), 'data bytes'),
    created: optionalInteger(field(row, 'created')),
  }));
}
function parseRow(row: OpenCodeRow, sourceId: string): ParsedRow {
  if (typeof row.data !== 'string') return { kind: 'malformed' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.data);
  } catch {
    return { kind: 'malformed' };
  }
  const message = object(parsed);
  if (!message) return { kind: 'malformed' };
  const role = field(message, 'role');
  if (role !== undefined && role !== 'assistant') return { kind: 'skip' };
  const time = object(field(message, 'time'));
  const completed = field(time, 'completed');
  if (completed === undefined || completed === null) return { kind: 'unfinished' };
  if (count(completed) === null) return { kind: 'malformed' };
  const tokens = object(field(message, 'tokens'));
  const cache = object(field(tokens, 'cache'));
  const cacheReadTokens = count(field(cache, 'read'));
  const cacheWriteTokens = count(field(cache, 'write'));
  const reasoningTokens = count(field(tokens, 'reasoning'));
  const inputTokens = completeSum(count(field(tokens, 'input')), cacheReadTokens, cacheWriteTokens);
  const outputTokens = completeSum(count(field(tokens, 'output')), reasoningTokens);
  const providerCostMicrousd = costMicrousd(field(message, 'cost'));
  if (!hasUsage(inputTokens, outputTokens, providerCostMicrousd)) return { kind: 'skip' };
  const modelReference = object(field(message, 'model'));
  const model =
    modelText(field(modelReference, 'id')) ??
    modelText(field(modelReference, 'modelID')) ??
    modelText(field(message, 'modelID'));
  const tsMs = count(field(time, 'created')) ?? row.created;
  if (!model || tsMs === null || tsMs > MAX_DATE_MS) return { kind: 'malformed' };
  const sessionId = row.sessionId ?? text(field(message, 'sessionID'));
  const messageId = row.id ?? text(field(message, 'id'));
  const identity =
    messageId ??
    hash(
      [
        sourceId,
        row.rowId,
        sessionId,
        tsMs,
        model,
        inputTokens,
        outputTokens,
        cacheWriteTokens,
        cacheReadTokens,
        reasoningTokens,
        providerCostMicrousd,
      ].join('\0'),
    );
  return {
    kind: 'event',
    event: {
      dedupeKey: `opencode:${identity.length <= 900 ? identity : hash(identity)}`,
      harnessId: 'opencode',
      harnessDisplayName: 'OpenCode',
      provider:
        modelText(field(modelReference, 'providerID')) ?? modelText(field(message, 'providerID')),
      sourceId,
      sessionId,
      project: null,
      sessionStartedAtMs: null,
      tsMs,
      model,
      serviceTier: null,
      inputTokens,
      outputTokens,
      cacheWriteTokens,
      cacheReadTokens,
      reasoningTokens,
      providerCostMicrousd,
      estimatedCostMicrousd: null,
      pricingVersion: null,
    },
  };
}
function restoreState(cursor: OpaqueUsageCursor, source: SourceContext): CursorState {
  if (
    cursor.sourcePath !== source.sourcePath ||
    cursor.sourceId !== source.sourceId ||
    cursor.adapterName !== ADAPTER_NAME ||
    cursor.adapterVersion !== ADAPTER_VERSION
  ) {
    throw resetError(source.sourcePath);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(cursor.state);
  } catch {
    throw resetError(source.sourcePath);
  }
  const value = object(parsed);
  const tables = object(field(value, 'tables'));
  const fileIdentity = text(field(value, 'fileIdentity'));
  if (!fileIdentity || !tables) throw resetError(source.sourcePath);
  const result: CursorState = { fileIdentity, tables: {} };
  for (const name of TABLES) {
    const stored = field(tables, name);
    if (stored === undefined) continue;
    const table = object(stored);
    const unfinished = field(table, 'unfinished');
    const after = requiredInteger(field(table, 'after'), 'cursor');
    if (!Array.isArray(unfinished) || unfinished.length > MAX_UNFINISHED_ROWS) {
      throw resetError(source.sourcePath);
    }
    const rows = unfinished.map((row) => requiredInteger(row, 'unfinished rowid'));
    if (new Set(rows).size !== rows.length || rows.some((row) => row === 0 || row > after)) {
      throw resetError(source.sourcePath);
    }
    result.tables[name] = { after, unfinished: rows };
  }
  return result;
}
function tableState(state: CursorState, name: OpenCodeTable): TableState {
  return (state.tables[name] ??= { after: 0, unfinished: [] });
}
function retainTables(state: CursorState, tables: readonly TableInfo[]): void {
  const active = new Set(tables.map((table) => table.name));
  for (const name of TABLES) if (!active.has(name)) Reflect.deleteProperty(state.tables, name);
}
function cloneTables(
  tables: Partial<Record<OpenCodeTable, TableState>> | undefined,
): Partial<Record<OpenCodeTable, TableState>> {
  const result: Partial<Record<OpenCodeTable, TableState>> = {};
  for (const name of TABLES) {
    const state = tables?.[name];
    if (state) result[name] = { after: state.after, unfinished: [...state.unfinished] };
  }
  return result;
}
const serialize = (state: CursorState): string => JSON.stringify(state);
// prettier-ignore
function spend(budget: Budget, rows: number, bytes: number): void { budget.pages -= 1; budget.rows -= rows; budget.bytes -= bytes }
// prettier-ignore
function exhausted(budget: Budget): boolean { return budget.pages === 0 || budget.rows === 0 || budget.bytes < MAX_ROW_DATA_BYTES }
function pageLimit(pageSize: number, budget: Budget, available = Number.MAX_SAFE_INTEGER): number {
  return Math.min(pageSize, budget.rows, Math.floor(budget.bytes / MAX_ROW_DATA_BYTES), available);
}
function rowBytes(rows: readonly OpenCodeRow[]): number {
  return rows.reduce((total, row) => total + row.dataBytes, 0);
}
// prettier-ignore
function normalizeRoots(roots: readonly string[]): string[] { if (roots.length > MAX_ROOTS) throw new Error('Too many OpenCode data roots.'); return [...new Set(roots.filter(Boolean).map((path) => resolve(path)))] }
function expandHome(path: string, homeDir: string): string {
  if (path === '~') return homeDir;
  return path.startsWith(`~${sep}`) ? join(homeDir, path.slice(2)) : path;
}
// prettier-ignore
function envValue(env: Readonly<Record<string, string | undefined>>, name: string) { return env[name] }
// prettier-ignore
function compareDatabaseNames(left: string, right: string): number { if (left === 'opencode.db') return -1; if (right === 'opencode.db') return 1; return left.localeCompare(right) }
function inside(root: string, candidate: string): boolean {
  const path = relative(resolve(root), candidate);
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}
function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function field(record: Record<string, unknown> | null | undefined, name: string): unknown {
  return record?.[name];
}
function text(value: unknown): string | null {
  return typeof value === 'string' &&
    value.length > 0 &&
    Buffer.byteLength(value) <= MAX_TEXT_BYTES &&
    !value.includes('\0')
    ? value
    : null;
}
// prettier-ignore
function modelText(value: unknown): string | null { const model = text(value); return model && model.length <= MAX_MODEL_LENGTH ? model : null }
function count(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}
function completeSum(...values: (number | null)[]): number | null {
  if (values.some((value) => value === null)) return null;
  const total = values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  return Number.isSafeInteger(total) ? total : null;
}
function costMicrousd(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  const result = Math.round(value * 1_000_000);
  return Number.isSafeInteger(result) ? result : null;
}
function hasUsage(...values: (number | null)[]): boolean {
  return values.some((value) => value !== null && value > 0);
}
function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new Error(`OpenCode ${name} is invalid.`);
  return value;
}
function requiredInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`OpenCode ${name} is invalid.`);
  }
  return Number(value);
}
function positiveInteger(value: unknown, name: string): number {
  const integer = requiredInteger(value, name);
  if (integer === 0) throw new Error(`OpenCode ${name} must be positive.`);
  return integer;
}
function boundedInteger(value: unknown, name: string, max: number): number {
  const integer = positiveInteger(value, name);
  if (integer > max) throw new Error(`OpenCode ${name} exceeds ${String(max)}.`);
  return integer;
}
function optionalInteger(value: unknown): number | null {
  return value === null || value === undefined ? null : requiredInteger(value, 'timestamp');
}
// prettier-ignore
function resetError(path: string): Error { return new Error(`OpenCode usage cursor is incompatible for ${path}. Rebuild the local ledger.`) }
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
function isUnavailable(error: unknown): boolean {
  const code = field(object(error), 'code');
  return ['ENOENT', 'EACCES', 'EPERM', 'SQLITE_BUSY', 'SQLITE_CANTOPEN'].includes(String(code));
}
