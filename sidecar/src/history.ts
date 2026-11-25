import { existsSync, mkdirSync, statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';
import { normalizeAutonomy, numberValue, objectValue, stringValue } from './values.js';
import { reasoningValue } from './modelCatalog.js';
import {
  type SessionRole,
  type ContextWindowTokens,
  type FactoryDefaultSettings,
  type SessionHistoryEntry,
  type SessionSummary,
  type ProgressEntry,
  type ReasoningEffort,
  type TranscriptEvent,
  DROID_PROFILES,
} from '@droidex/protocol';
import {
  normalizeCompactionTokenLimit,
  normalizeCompactionTokenLimitPerModel,
} from './compaction.js';
import {
  SessionFileCache,
  type SessionFileLaunchSettings,
  type SessionFileReconciliation,
  type SessionFileSnapshot,
  type SessionFileStat,
  type SessionFileSummary,
} from './sessionFileCache.js';
import { SessionFileMirror } from './sessionFileMirror.js';
import {
  readSessionRawWindow,
  type StoredMessageLine,
  type StoredSessionStart,
} from './sessionTranscript.js';
import { decodeProviderSessionIdList } from './historyProviderIds.js';
import { persistedChildSessionFromRow } from './persistedChildSessionRowDecoder.js';
import { scanSessionFileTree, statSessionFile } from './historyDiscovery.js';
import {
  loadMissionControlSession,
  missionSessionId,
  projectMissionProgress,
  resolveMissionDir,
  type StoredMissionState,
} from './historyMissions.js';
import { shouldIncludeCwd, type HistoricalSummaryFilter } from './historySummaryFilter.js';
import { parseJsonLines, readJson } from './jsonFiles.js';
import {
  assertCanonicalHistorySchema,
  ensureCanonicalHistorySchema,
  historySchemaRecovery,
} from './historySchema.js';
import { DEFAULT_PROVIDER, providerKind } from './providers/providerKind.js';
import { migrateHistoryPermissions, migrateTranscriptPermissions } from './permissionSemantics.js';
import { readSessionFileHead, readSessionStart } from './sessionFileHead.js';
import { droidexHistoryDir } from './droidexPaths.js';
import { altSessionRoots, DROID_PROFILE_SCOPE_PREFIX } from './droidProfiles.js';
import { HistoryTranscriptWindow } from './historyTranscriptWindow.js';

const SUMMARY_ROWS_SQL = `
  SELECT app_sessions.*, settings.value_json AS droid_profile_json
  FROM app_sessions
  LEFT JOIN settings ON settings.scope = ? || app_sessions.app_session_id
`;

export interface HistoricalSession {
  summary: SessionSummary;
  progress: ProgressEntry[];
}

interface SummaryPatchesAndHidden {
  patches: Map<string, Partial<SessionSummary>>;
  hiddenProviderSessionIds: Set<string>;
}

export interface HydratedSessionHistory {
  progress: ProgressEntry[];
  transcripts: TranscriptEvent[];
  // Opaque cursor for the next (older) page of orchestrator scrollback across
  // the compaction chain; undefined once the oldest segment has been loaded.
  olderCursor?: string;
}

export type FactoryDefaults = FactoryDefaultSettings;

type PersistedChildRole = 'worker' | 'validator';
type PersistedChildStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed';

export interface PersistedChildSpawnLink {
  kind: 'tool-use' | 'spawn';
  id: string;
}

export interface PersistedChildSession {
  parentAppSessionId: string;
  childSessionId: string;
  providerSessionId?: string;
  previousProviderSessionIds?: string[];
  role: PersistedChildRole;
  label?: string;
  prompt?: string;
  group?: string;
  phase?: string;
  status: PersistedChildStatus;
  modelId: string;
  reasoningEffort?: ReasoningEffort;
  spawnLink?: PersistedChildSpawnLink;
  transcriptAvailable: boolean;
  startedAt?: number;
  settledAt?: number;
  updatedAt: number;
}

export const SESSION_INDEX_FILENAME = 'session-index.sqlite';
export const SESSION_SEARCH_INDEX_FILENAME = 'session-search.sqlite';

function sessionTitle(start: StoredSessionStart, providerSessionId: string): string {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- Empty titles fall back to the next source.
  return start.sessionTitle || start.title || `Session ${providerSessionId.slice(0, 8)}`;
}

export function loadSessionHistory(): SessionHistoryEntry[] {
  const rows: SessionHistoryEntry[] = [];
  for (const [providerSessionId, path] of sessionPathIndex()) {
    const stat = statSync(path);
    const start = readSessionStart(path, stat.size);
    rows.push({
      providerSessionId,
      title: sessionTitle(start, providerSessionId),
      cwd: start.cwd,
      modifiedTime: stat.mtimeMs,
      createdTime: stat.birthtimeMs,
      messageCount: countSessionMessages(path),
    });
  }
  return rows.sort((a, b) => b.modifiedTime - a.modifiedTime);
}

export function sessionFilePath(providerSessionId: string): string | undefined {
  return sessionPathIndex().get(providerSessionId);
}

export function sessionOrganizationId(providerSessionId: string): string | undefined {
  const path = sessionPathIndex().get(providerSessionId);
  if (!path) return undefined;
  try {
    return readSessionStart(path, statSync(path).size).organizationId;
  } catch {
    // The file can be removed between the index update and this read.
    return undefined;
  }
}

export class HistoryIndex {
  private db: DatabaseSync;
  private readonly sessionFiles = new SessionFileMirror();

  constructor() {
    const dir = droidexHistoryDir();
    mkdirSync(dir, { recursive: true });
    const db = new DatabaseSync(join(dir, SESSION_INDEX_FILENAME));
    try {
      HistoryIndex.initializeOrValidateHistorySchema(db);
      db.exec('PRAGMA journal_mode = WAL');
      this.db = db;
      sessionIndexMemo ??= this.sessionFiles.pathIndex();
    } catch (error) {
      db.close();
      throw error;
    }
  }

  get sessionFileCacheSize(): number {
    return this.sessionFiles.size;
  }

  sessionLaunchSettings(
    providerSessionId: string,
  ): Pick<FactoryDefaults, 'modelId' | 'reasoningEffort'> | undefined {
    return this.sessionFiles.sessionLaunchSettings(providerSessionId);
  }

  listHistoricalSessions(options: HistoricalSummaryFilter = {}): HistoricalSession[] {
    const workspaceCwds = options.workspaceCwds
      ? new Set(options.workspaceCwds.filter(Boolean))
      : null;
    if (workspaceCwds?.size === 0 && !options.includePlainChats) return [];
    const patches = this.summaryPatches();
    const rows: HistoricalSession[] = [];
    for (const cached of this.sessionFiles.summaries()) {
      const summary = applyCachedSummary(cached, patches);
      if (
        (workspaceCwds || options.includePlainChats) &&
        !shouldIncludeCwd(summary.cwd, workspaceCwds, options.includePlainChats)
      )
        continue;
      rows.push({ summary, progress: [] });
    }
    return rows.sort((a, b) => b.summary.updatedAt - a.summary.updatedAt);
  }

  applySessionFileReconciliation(result: SessionFileReconciliation): boolean {
    if (!this.sessionFiles.applyReconciliation(result)) return false;
    updateSessionIndex(result, this.sessionFiles);
    return true;
  }

  replaceSessionFileSnapshot(snapshot: SessionFileSnapshot): boolean {
    const changed = this.sessionFiles.replaceSnapshot(snapshot);
    sessionIndexMemo = this.sessionFiles.pathIndex();
    return changed;
  }

  static initializeOrValidateHistorySchema(db: DatabaseSync): void {
    ensureCanonicalHistorySchema(db);
    migrateHistoryPermissions(db);
  }

  summaryPatchesAndHidden(): SummaryPatchesAndHidden {
    const rows = this.db.prepare(SUMMARY_ROWS_SQL).all(DROID_PROFILE_SCOPE_PREFIX) as Record<
      string,
      unknown
    >[];
    const patches = summaryPatchesFromRows(rows);
    applyStoredCompactionGenerations(this.db, patches);
    return { patches, hiddenProviderSessionIds: hiddenProviderSessionIdsFromRows(rows) };
  }

  appSessionIds(): string[] {
    const rows = this.db
      .prepare('SELECT app_session_id FROM app_sessions ORDER BY app_session_id')
      .all() as { app_session_id: unknown }[];
    return rows.map((row) => {
      const id = stringValue(row.app_session_id);
      if (!id) throw new Error('Canonical history contains an invalid app session ID.');
      return id;
    });
  }

  private summaryPatches(): Map<string, Partial<SessionSummary>> {
    const rows = this.db.prepare(SUMMARY_ROWS_SQL).all(DROID_PROFILE_SCOPE_PREFIX) as Record<
      string,
      unknown
    >[];
    const patches = summaryPatchesFromRows(rows);
    applyStoredCompactionGenerations(this.db, patches);
    return patches;
  }

  childSessions(parentAppSessionId: string): PersistedChildSession[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM child_sessions WHERE parent_app_session_id = ? ORDER BY updated_at ASC, child_session_id ASC',
      )
      .all(parentAppSessionId) as Record<string, unknown>[];
    return rows.map(persistedChildSessionFromRow);
  }

  childSession(
    parentAppSessionId: string,
    childSessionId: string,
  ): PersistedChildSession | undefined {
    const row = this.db
      .prepare(
        'SELECT * FROM child_sessions WHERE parent_app_session_id = ? AND child_session_id = ?',
      )
      .get(parentAppSessionId, childSessionId) as Record<string, unknown> | undefined;
    return row ? persistedChildSessionFromRow(row) : undefined;
  }

  close(): void {
    this.db.close();
  }
}

export function createHistorySessionFileCache(
  db: DatabaseSync,
  canonicalDb: DatabaseSync,
): SessionFileCache {
  const ownedChat = canonicalDb.prepare(`
    SELECT * FROM app_sessions WHERE provider_session_id = ?
  `);
  return new SessionFileCache(
    db,
    scanSessionFileTree,
    summarizeSessionFile,
    statSessionFile,
    (summary) => {
      if (summary.role !== 'primary' || summary.sessionPurpose !== 'chat') return false;
      const row = ownedChat.get(summary.providerSessionId ?? summary.appSessionId);
      return (
        row?.session_purpose === 'chat' &&
        stringValue(row.title) !== undefined &&
        numberValue(row.updated_at) !== undefined
      );
    },
  );
}

function readStoredSummaryPatches(): Map<string, Partial<SessionSummary>> {
  const path = join(droidexHistoryDir(), SESSION_INDEX_FILENAME);
  if (!existsSync(path)) return new Map();
  const db = new DatabaseSync(path);
  try {
    assertCanonicalHistorySchema(db);
    const rows = db.prepare(SUMMARY_ROWS_SQL).all(DROID_PROFILE_SCOPE_PREFIX) as Record<
      string,
      unknown
    >[];
    const patches = summaryPatchesFromRows(rows);
    applyStoredCompactionGenerations(db, patches);
    return patches;
  } finally {
    db.close();
  }
}

function applyStoredCompactionGenerations(
  db: DatabaseSync,
  patches: Map<string, Partial<SessionSummary>>,
): void {
  const rows = db
    .prepare(
      `SELECT app_session_id,
              SUM(CASE WHEN id LIKE 'compaction-%' THEN 1 ELSE 0 END) AS live_count,
              SUM(CASE WHEN id NOT LIKE 'compaction-%' THEN 1 ELSE 0 END) AS history_count
       FROM events
       WHERE kind = 'compaction'
         AND app_session_id IS NOT NULL
         AND (source_session_id = app_session_id OR source_session_id = 'primary')
       GROUP BY app_session_id`,
    )
    .all() as Record<string, unknown>[];
  for (const row of rows) {
    const appSessionId = stringValue(row.app_session_id);
    const liveCount = numberValue(row.live_count) ?? 0;
    const historyCount = numberValue(row.history_count) ?? 0;
    const patch = appSessionId ? patches.get(appSessionId) : undefined;
    if (!patch) continue;
    patch.autoCompactions = Math.max(patch.autoCompactions ?? 0, liveCount, historyCount);
  }
}

function readStoredChildSessions(parentAppSessionId: string): PersistedChildSession[] {
  const path = join(droidexHistoryDir(), SESSION_INDEX_FILENAME);
  if (!existsSync(path)) return [];
  const db = new DatabaseSync(path);
  try {
    assertCanonicalHistorySchema(db);
    const rows = db
      .prepare(
        'SELECT * FROM child_sessions WHERE parent_app_session_id = ? ORDER BY updated_at ASC, child_session_id ASC',
      )
      .all(parentAppSessionId) as Record<string, unknown>[];
    return rows.map(persistedChildSessionFromRow);
  } finally {
    db.close();
  }
}

function summaryPatchesFromRows(
  rows: Record<string, unknown>[],
): Map<string, Partial<SessionSummary>> {
  const patches = new Map<string, Partial<SessionSummary>>();
  for (const row of rows) {
    const appSessionId = stringValue(row.app_session_id);
    const providerSessionId = stringValue(row.provider_session_id);
    if (!appSessionId || !providerSessionId) continue;
    const patch: Partial<SessionSummary> = {
      appSessionId,
      providerSessionId,
      ...storedDroidProfile(row.droid_profile_json),
      compactedFromProviderSessionIds: decodeProviderSessionIdList(
        row.compacted_from_provider_session_ids,
        historySchemaRecovery(),
      ),
      sessionPurpose: sessionPurpose(stringValue(row.session_purpose)),
      interactionMode: sessionInteractionModeValue(stringValue(row.interaction_mode)),
      title: stringValue(row.title),
      cwd: stringValue(row.cwd),
      workspaceKind: workspaceKind(stringValue(row.workspace_kind)),
      modelId: stringValue(row.model_id),
      reasoningEffort: reasoningValue(row.reasoning_effort),
      fastMode: fastModeValue(row.fast_mode),
      contextWindowTokens: contextWindowTokensValue(row.context_window_tokens),
      compactionModel: stringValue(row.compaction_model),
      workerModelId: stringValue(row.worker_model_id),
      workerReasoningEffort: reasoningValue(row.worker_reasoning_effort),
      validatorModelId: stringValue(row.validator_model_id),
      validatorReasoningEffort: reasoningValue(row.validator_reasoning_effort),
      autonomy: normalizeAutonomy(row.autonomy),
      tokensIn: numberValue(row.tokens_in),
      tokensOut: numberValue(row.tokens_out),
      contextTokens: numberValue(row.context_tokens),
      contextRemainingTokens: numberValue(row.context_remaining_tokens),
      contextAccuracy: contextAccuracy(row.context_accuracy),
      contextUpdatedAt: stringValue(row.context_updated_at),
      maxContextTokens: numberValue(row.max_context_tokens),
      autoCompactions: numberValue(row.auto_compactions),
      updatedAt: numberValue(row.updated_at),
    };
    patches.set(appSessionId, patch);
    patches.set(providerSessionId, patch);
  }
  return patches;
}

function storedDroidProfile(value: unknown): Pick<SessionSummary, 'droidProfile'> {
  if (value === null || value === undefined) return {};
  const droidProfile = DROID_PROFILES.find((profile) => JSON.stringify(profile) === value);
  if (!droidProfile)
    throw new Error('Stored Droid profile binding is invalid. Restore the history database.');
  return { droidProfile };
}

function hiddenProviderSessionIdsFromRows(rows: Record<string, unknown>[]): Set<string> {
  const hidden = new Set<string>();
  for (const row of rows) {
    const appSessionId = stringValue(row.app_session_id);
    for (const providerSessionId of decodeProviderSessionIdList(
      row.compacted_from_provider_session_ids,
      historySchemaRecovery(),
    )) {
      if (providerSessionId && providerSessionId !== appSessionId) hidden.add(providerSessionId);
    }
  }
  return hidden;
}

export function applyCachedSummary(
  summary: SessionSummary,
  cached: Map<string, Partial<SessionSummary>>,
): SessionSummary {
  const patch =
    cached.get(summary.providerSessionId ?? summary.appSessionId) ??
    cached.get(summary.appSessionId);
  if (!patch) return summary;
  const defined = definedPatch(patch);
  return {
    ...summary,
    ...defined,
    updatedAt: Math.max(summary.updatedAt, defined.updatedAt ?? 0),
    appSessionId: defined.appSessionId ?? summary.appSessionId,
    providerSessionId: defined.providerSessionId ?? summary.providerSessionId,
    missionId: defined.missionId ?? summary.missionId,
    sessionPurpose: defined.sessionPurpose ?? summary.sessionPurpose,
    interactionMode: defined.interactionMode ?? summary.interactionMode,
    role: defined.role ?? summary.role,
  };
}

function definedPatch(patch: Partial<SessionSummary>): Partial<SessionSummary> {
  return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
}

export function hydrateHistoricalSession(
  missionId: string,
  opts: { cursor?: string; limit?: number } = {},
): HydratedSessionHistory {
  const dir = resolveMissionDir(missionId);
  const state = readJson(join(dir, 'state.json')) as StoredMissionState;
  const appSessionId = missionSessionId(state, dir);

  // The orchestrator backing session is rekeyed on every compaction, so the
  // full conversation is spread across a CHAIN of session files. Resolve that
  // chain (oldest -> newest) from the persisted app-session row; replaying only
  // the latest segment is what made compacted chats lose their scrollback.
  const chain = resolveSessionChain(appSessionId, appSessionId);
  const window = loadSessionTranscriptWindow(appSessionId, chain, opts);

  // Older pages only extend the orchestrator scrollback; progress was already delivered with the newest page.
  if (opts.cursor) {
    return { progress: [], transcripts: window.events, olderCursor: window.olderCursor };
  }

  const { storedProgress } = loadMissionControlSession(dir);
  const progress = projectMissionProgress(storedProgress, readStoredChildSessions(appSessionId));
  return { progress, transcripts: window.events, olderCursor: window.olderCursor };
}

// Resolve the compaction chain (oldest -> newest backing session ids) from the
// persisted app-session row, filtered to session files that still exist.
export function resolveSessionChain(appSessionId: string, providerSessionId: string): string[] {
  const patches = readStoredSummaryPatches();
  const patch = patches.get(appSessionId) ?? patches.get(providerSessionId);
  const currentSession = patch?.providerSessionId ?? providerSessionId;
  const sessionFiles = sessionPathIndex();
  const compactedFrom = patch?.compactedFromProviderSessionIds ?? [];
  return dedupeStrings([appSessionId, ...compactedFrom, currentSession]).filter((id) =>
    sessionFiles.has(id),
  );
}

function dedupeStrings(values: (string | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

const transcriptWindow = new HistoryTranscriptWindow();

export function invalidateSessionTranscripts(): void {
  transcriptWindow.invalidate();
}

export function loadSessionTranscriptWindow(
  appSessionId: string,
  chainProviderSessionIds: string[],
  opts: { cursor?: string; limit?: number; role?: SessionRole; fullText?: boolean } = {},
): { events: TranscriptEvent[]; olderCursor?: string } {
  return transcriptWindow.loadWindow(
    sessionPathIndex(),
    appSessionId,
    chainProviderSessionIds,
    opts,
  );
}

/**
 * The newest events of the transcript DROIDEX is writing for a session still
 * open. The history index learns of that file only when the session closes.
 */
export function loadOpenTranscriptTail(
  appSessionId: string,
  path: string,
  limit: number,
  fullText = false,
): TranscriptEvent[] {
  return transcriptWindow.loadOpenTail(appSessionId, path, limit, fullText);
}

export function readFactoryDefaults(home = homedir()): FactoryDefaults {
  const path = join(home, '.factory', 'settings.json');
  if (!existsSync(path)) return {};
  const settings = readJson(path) as Record<string, unknown>;
  const session = objectValue(settings.sessionDefaultSettings) ?? {};
  const missionControlSettings = objectValue(settings.missionModelSettings) ?? {};
  return {
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- Empty model names fall back to the next source.
    modelId: stringValue(session.model) || stringValue(session.modelId),
    reasoningEffort: reasoningValue(session.reasoningEffort),
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- Empty model names fall back to the next source.
    compactionModel: stringValue(settings.compactionModel) || stringValue(session.compactionModel),
    compactionTokenLimit: normalizeCompactionTokenLimit(settings.compactionTokenLimit),
    compactionTokenLimitPerModel: normalizeCompactionTokenLimitPerModel(
      settings.compactionTokenLimitPerModel,
    ),
    autonomy: normalizeAutonomy(session.autonomyLevel),
    interactionMode: mapInteractionMode(stringValue(session.interactionMode)),
    specModelId: stringValue(session.specModeModel),
    specReasoningEffort: reasoningValue(session.specModeReasoningEffort),
    missionOrchestratorModelId: stringValue(settings.missionOrchestratorModel),
    missionOrchestratorReasoningEffort: reasoningValue(settings.missionOrchestratorReasoningEffort),
    workerModelId: stringValue(missionControlSettings.workerModel),
    workerReasoningEffort: reasoningValue(missionControlSettings.workerReasoningEffort),
    validatorModelId: stringValue(missionControlSettings.validationWorkerModel),
    validatorReasoningEffort: reasoningValue(
      missionControlSettings.validationWorkerReasoningEffort,
    ),
  };
}

function mapInteractionMode(value?: string): FactoryDefaults['interactionMode'] {
  if (value === 'auto' || value === 'spec' || value === 'agi') return value;
  return undefined;
}

// The worker-maintained file cache is the only owner that populates this path
// mirror. History loads never fall back to a synchronous sessions-tree walk on
// the orchestration thread; a missing path remains unavailable until the boot
// or watcher reconciliation publishes its revisioned delta.
let sessionIndexMemo: Map<string, string> | null = null;

function updateSessionIndex(result: SessionFileReconciliation, files: SessionFileMirror): void {
  if (result.changed === 0) return;
  sessionIndexMemo ??= files.pathIndex();
  for (const providerSessionId of result.removedProviderSessionIds) {
    sessionIndexMemo.delete(providerSessionId);
  }
  for (const entry of result.upserts) {
    sessionIndexMemo.set(entry.providerSessionId, entry.path);
  }
}

export function invalidateSessionIndex(): void {
  sessionIndexMemo = null;
}

function sessionPathIndex(): Map<string, string> {
  sessionIndexMemo ??= new Map();
  return sessionIndexMemo;
}

// Builds the base summary and launch settings for one on-disk session file
// from a single bounded head read. The summary is null when the file is not
// admitted to durable top-level history. The app_sessions patch overlay is
// applied by the caller.
function summarizeSessionFile(
  providerSessionId: string,
  file: SessionFileStat,
): SessionFileSummary {
  const { start, hasPrompt, hasCompletedConversation } = readSessionFileHead(
    file.path,
    file.sizeBytes,
  );
  const settings = readSessionModelSettings(start, file.path);
  // Resuming a session needs its model even when the session never earns a
  // sidebar row, so launch settings are cached independently of admission.
  const launch = launchSettings(settings);
  const cachedLaunch = launch ? { launchSettings: launch } : {};
  if (!start) return { summary: null, ...cachedLaunch };
  const classification = classifyStoredSession(start);
  // A Droid file carries no binding, so it reads as Droid without migration.
  const provider = providerKind(start.provider) ?? DEFAULT_PROVIDER;
  // App-owned transcripts persist the prompt and provider binding before a reply.
  const isDurable = hasCompletedConversation || (provider !== DEFAULT_PROVIDER && hasPrompt);
  if (!classification || !isDurable) return { summary: null, ...cachedLaunch };
  const title = sessionTitle(start, providerSessionId);
  const droidProfile = altSessionRoots().find(({ root }) =>
    file.path.startsWith(`${root}${sep}`),
  )?.profile;
  return {
    summary: {
      appSessionId: providerSessionId,
      providerSessionId,
      missionId: classification.missionId,
      provider,
      ...(droidProfile ? { droidProfile } : {}),
      ...(start.resumeId ? { resumeId: start.resumeId } : {}),
      // A Codex thread stored without the record started before Canvas existed.
      ...(provider === 'codex'
        ? { canvasTools: start.canvasTools === 'at_start' ? 'at_start' : 'none' }
        : {}),
      sessionPurpose: classification.sessionPurpose,
      interactionMode: classification.interactionMode,
      role: classification.role,
      title,
      goal: title,
      cwd: start.cwd ?? '',
      workspaceKind: start.cwd ? 'folder' : 'none',
      ...settings,
      autonomy: settings.autonomy ?? 'low',
      phase: 'paused',
      streaming: false,
      queuedSends: 0,
      features: [],
      tokensIn: 0,
      tokensOut: 0,
      contextTokens: 0,
      createdAt: file.birthtimeMs,
      updatedAt: file.mtimeMs,
    },
    ...cachedLaunch,
  };
}

function launchSettings(settings: FactoryDefaults): SessionFileLaunchSettings | undefined {
  if (!settings.modelId) return undefined;
  return {
    modelId: settings.modelId,
    ...(settings.reasoningEffort ? { reasoningEffort: settings.reasoningEffort } : {}),
  };
}

function classifyStoredSession(
  start: StoredSessionStart,
): Pick<SessionSummary, 'sessionPurpose' | 'interactionMode' | 'role' | 'missionId'> | null {
  if (start.decompSessionType === 'worker') return null;
  if (start.decompSessionType === 'validator') return null;
  // Factory Task-tool children are never standalone conversations.
  if (start.callingSessionId || start.callingToolUseId) return null;
  const mode = sessionInteractionMode(start);
  const missionControlId = start.decompMissionId;
  if (start.decompSessionType === 'orchestrator' || missionControlId) {
    return {
      sessionPurpose: 'mission-control',
      interactionMode: 'agi',
      role: 'primary',
      missionId: missionControlId,
    };
  }
  if (mode === 'spec') {
    return {
      sessionPurpose: 'chat',
      interactionMode: 'spec',
      role: 'primary',
      missionId: undefined,
    };
  }
  return {
    sessionPurpose: 'chat',
    interactionMode: mode === 'agi' ? 'agi' : 'auto',
    role: 'primary',
    missionId: undefined,
  };
}

function sessionInteractionMode(start: StoredSessionStart): string | undefined {
  const direct = objectValue(start)?.interactionMode;
  const settings = objectValue(objectValue(start)?.settings);
  return stringValue(direct) ?? stringValue(settings?.interactionMode);
}

function readSessionModelSettings(
  start: StoredSessionStart | undefined,
  sessionPath: string,
): FactoryDefaults & Pick<SessionSummary, 'fastMode' | 'contextWindowTokens'> {
  const raw = objectValue(start) ?? {};
  const settings = objectValue(raw.settings) ?? objectValue(raw.sessionSettings) ?? {};
  const sidecarSettings = readAdjacentSessionSettings(sessionPath);
  return {
    fastMode: fastModeValue(
      sidecarSettings.fastMode !== undefined ? sidecarSettings.fastMode : raw.fastMode,
    ),
    // Once the sidecar names the model the head line is history, including when
    // it names none: that is the record of a chat reset to its provider's own
    // default, not an absent setting to fall back from.
    /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- Empty model names and reasoning efforts fall back to the next source. */
    modelId: Object.hasOwn(sidecarSettings, 'modelId')
      ? stringValue(sidecarSettings.modelId)
      : stringValue(sidecarSettings.model) ||
        stringValue(settings.modelId) ||
        stringValue(settings.model) ||
        stringValue(raw.modelId) ||
        stringValue(raw.model),
    reasoningEffort: reasoningValue(
      Object.hasOwn(sidecarSettings, 'reasoningEffort')
        ? stringValue(sidecarSettings.reasoningEffort)
        : stringValue(settings.reasoningEffort) || stringValue(raw.reasoningEffort),
    ),
    /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */
    contextWindowTokens: contextWindowTokensValue(
      sidecarSettings.contextWindowTokens !== undefined
        ? sidecarSettings.contextWindowTokens
        : raw.contextWindowTokens,
    ),
    /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- Empty model names fall back to the next source. */
    compactionModel:
      stringValue(sidecarSettings.compactionModel) ||
      stringValue(settings.compactionModel) ||
      stringValue(raw.compactionModel),
    /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */
    compactionTokenLimit:
      normalizeCompactionTokenLimit(sidecarSettings.compactionTokenLimit) ??
      normalizeCompactionTokenLimit(settings.compactionTokenLimit) ??
      normalizeCompactionTokenLimit(raw.compactionTokenLimit),
    compactionTokenLimitPerModel:
      normalizeCompactionTokenLimitPerModel(sidecarSettings.compactionTokenLimitPerModel) ??
      normalizeCompactionTokenLimitPerModel(settings.compactionTokenLimitPerModel) ??
      normalizeCompactionTokenLimitPerModel(raw.compactionTokenLimitPerModel),
    autonomy: migrateTranscriptPermissions(
      sessionPath,
      providerKind(start?.provider) ?? DEFAULT_PROVIDER,
      normalizeAutonomy(
        stringValue(sidecarSettings.autonomyLevel) ??
          stringValue(settings.autonomyLevel) ??
          stringValue(raw.autonomyLevel),
      ),
      raw.permissionSemanticsRevision,
    ),
  };
}

function readAdjacentSessionSettings(sessionPath: string): Record<string, unknown> {
  const settingsPath = sessionPath.replace(/\.jsonl$/, '.settings.json');
  if (!existsSync(settingsPath)) return {};
  try {
    return objectValue(readJson(settingsPath)) ?? {};
  } catch {
    return {};
  }
}

function countSessionMessages(path: string): number {
  const window = readSessionRawWindow(path, statSync(path).size);
  return parseJsonLines<StoredMessageLine>(window.text).filter((line) => line.type === 'message')
    .length;
}

function contextAccuracy(value: unknown): SessionSummary['contextAccuracy'] | undefined {
  if (value === 'exact' || value === 'estimated') return value;
  return undefined;
}

function sessionPurpose(value?: string): SessionSummary['sessionPurpose'] | undefined {
  if (value === 'chat' || value === 'design' || value === 'mission-control') return value;
  return undefined;
}

function sessionInteractionModeValue(
  value?: string,
): SessionSummary['interactionMode'] | undefined {
  if (value === 'auto' || value === 'spec' || value === 'agi') return value;
  return undefined;
}

function workspaceKind(value?: string): SessionSummary['workspaceKind'] | undefined {
  if (value === 'folder' || value === 'none') return value;
  return undefined;
}

function contextWindowTokensValue(value: unknown): ContextWindowTokens | undefined {
  if (value === 200000 || value === 1000000) return value;
  return undefined;
}

// Stored as 0 or 1 in SQLite and as a boolean in a transcript head line.
function fastModeValue(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (value === 0 || value === 1) return value === 1;
  return undefined;
}
