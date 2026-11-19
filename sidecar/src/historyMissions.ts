import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import type { BridgeFeature, ProgressEntry, SessionPhase } from '@droidex/protocol';
import {
  normalizeCompactionTokenLimit,
  normalizeCompactionTokenLimitPerModel,
} from './compaction.js';
import { errMsg } from './errors.js';
import type { FactoryDefaults, HistoricalSession, PersistedChildSession } from './history.js';
import { shouldIncludeCwd, type HistoricalSummaryFilter } from './historySummaryFilter.js';
import { readJson, readJsonLines } from './jsonFiles.js';
import { bridgeFeature } from './missionFeatures.js';
import { reasoningValue } from './modelCatalog.js';
import { DEFAULT_PROVIDER } from './providers/providerKind.js';
import { dateMs, normalizeAutonomy, objectValue, stringValue } from './values.js';

interface StoredMissionState {
  missionId?: string;
  baseSessionId?: string;
  state?: string;
  workingDirectory?: string;
  cwd?: string;
  workerSessionIds?: string[];
  createdAt?: string;
  updatedAt?: string;
}

interface StoredFeatureFile {
  features?: unknown[];
}

interface StoredModelSettings {
  model?: string;
  modelId?: string;
  reasoningEffort?: string;
  compactionModel?: string;
  compactionTokenLimit?: number;
  compactionTokenLimitPerModel?: Record<string, number>;
  autonomyLevel?: string;
  workerModel?: string;
  workerReasoningEffort?: string;
  validationWorkerModel?: string;
  validationWorkerReasoningEffort?: string;
}

interface StoredProgressEntry extends ProgressEntry {
  workerProviderSessionId?: string;
  spawnId?: string;
}

const STATE_TO_PHASE: Record<string, SessionPhase> = {
  initializing: 'initializing',
  running: 'running',
  paused: 'paused',
  orchestrator_turn: 'orchestrator_turn',
  completed: 'completed',
  failed: 'failed',
  awaiting_input: 'running',
};

function missionWorkingDirectory(state: StoredMissionState): string {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- Empty directories fall back to the next source.
  return state.workingDirectory || state.cwd || '';
}

export function loadMissionControlSessions(
  options: HistoricalSummaryFilter = {},
): HistoricalSession[] {
  const workspaceCwds = options.workspaceCwds
    ? new Set(options.workspaceCwds.filter(Boolean))
    : null;
  if (workspaceCwds?.size === 0 && !options.includePlainChats) return [];
  const isFiltered = workspaceCwds !== null || options.includePlainChats === true;
  const sessions: HistoricalSession[] = [];
  for (const dir of missionDirs()) {
    try {
      if (isFiltered) {
        const state = readJson(join(dir, 'state.json')) as StoredMissionState;
        const cwd = missionWorkingDirectory(state);
        if (!shouldIncludeCwd(cwd, workspaceCwds, options.includePlainChats)) continue;
      }
      sessions.push(loadMissionControlSession(dir));
    } catch (error) {
      reportUnreadableMission(dir, error);
    }
  }
  return sessions.sort((a, b) => b.summary.updatedAt - a.summary.updatedAt);
}

export function loadMissionControlSession(
  dir: string,
  options: { includeProgress?: boolean } = {},
): HistoricalSession & {
  state: StoredMissionState;
  features: BridgeFeature[];
  storedProgress: StoredProgressEntry[];
} {
  const state = readJson(join(dir, 'state.json')) as StoredMissionState;
  const storedProgress =
    options.includeProgress === false ? [] : readProgress(join(dir, 'progress_log.jsonl'));
  const progress = storedProgress.map(publicProgressEntry);
  const features = readFeatures(join(dir, 'features.json'));
  const dirId = basename(dir);
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- Empty session IDs use the directory name.
  const providerSessionId = state.baseSessionId || dirId;
  const firstProgressTitle = progress.find((p) => p.title)?.title;
  const cwd = missionWorkingDirectory(state);
  /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- Empty titles and mission IDs fall back to the next source. */
  const title =
    firstProgressTitle ||
    state.missionId ||
    lastPathSegment(cwd) ||
    `Mission ${providerSessionId.slice(0, 8)}`;
  /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */
  const createdAt =
    dateMs(state.createdAt) || dateMs(progress[0]?.timestamp) || statSync(dir).birthtimeMs;
  const updatedAt =
    dateMs(state.updatedAt) ||
    dateMs(progress[progress.length - 1]?.timestamp) ||
    statSync(dir).mtimeMs;
  const modelSettings = readMissionModelSettings(dir);

  return {
    summary: {
      appSessionId: providerSessionId,
      providerSessionId,
      missionId: state.missionId ?? dirId,
      provider: DEFAULT_PROVIDER,
      sessionPurpose: 'mission-control',
      interactionMode: 'agi',
      role: 'primary',
      title,
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- Empty progress messages use the title.
      goal: progress[0]?.message || title,
      cwd,
      workspaceKind: cwd ? 'folder' : 'none',
      ...modelSettings,
      autonomy: modelSettings.autonomy ?? 'medium',
      phase: STATE_TO_PHASE[state.state ?? ''] ?? 'paused',
      features,
      tokensIn: 0,
      tokensOut: 0,
      contextTokens: 0,
      createdAt,
      updatedAt,
    },
    progress,
    storedProgress,
    state,
    features,
  };
}

function readMissionModelSettings(dir: string): FactoryDefaults {
  const path = join(dir, 'model-settings.json');
  if (!existsSync(path)) return {};
  const settings = readJson(path) as StoredModelSettings;
  return {
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- Empty model names fall back to the next source.
    modelId: settings.model || settings.modelId,
    reasoningEffort: reasoningValue(settings.reasoningEffort),
    compactionModel: settings.compactionModel,
    compactionTokenLimit: normalizeCompactionTokenLimit(settings.compactionTokenLimit),
    compactionTokenLimitPerModel: normalizeCompactionTokenLimitPerModel(
      settings.compactionTokenLimitPerModel,
    ),
    workerModelId: settings.workerModel,
    workerReasoningEffort: reasoningValue(settings.workerReasoningEffort),
    validatorModelId: settings.validationWorkerModel,
    validatorReasoningEffort: reasoningValue(settings.validationWorkerReasoningEffort),
    autonomy: normalizeAutonomy(settings.autonomyLevel),
  };
}

function readProgress(path: string): StoredProgressEntry[] {
  if (!existsSync(path)) return [];
  return readJsonLines<Record<string, unknown>>(path).map((entry) => {
    const handoff = objectValue(entry.handoff);
    const validation = objectValue(entry.validation);
    return {
      /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- Empty progress fields fall back to the next source. */
      type: stringValue(entry.type) || 'entry',
      timestamp: stringValue(entry.timestamp) || new Date().toISOString(),
      title: stringValue(entry.title) || titleFromProgressType(stringValue(entry.type)),
      message:
        stringValue(entry.message) ||
        stringValue(handoff?.salientSummary) ||
        stringValue(validation?.summary) ||
        stringValue(entry.reason),
      /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */
      featureId: stringValue(entry.featureId),
      workerProviderSessionId: stringValue(entry.workerSessionId),
      spawnId: stringValue(entry.spawnId),
    };
  });
}

export function projectMissionProgress(
  entries: StoredProgressEntry[],
  children: PersistedChildSession[],
): ProgressEntry[] {
  const childrenBySpawn = new Map(
    children.flatMap((child) =>
      child.spawnLink?.kind === 'spawn'
        ? [[child.spawnLink.id, child.childSessionId] as const]
        : [],
    ),
  );
  const childrenByProvider = new Map<string, string>();
  const correlatedSpawns = new Map<string, string>();
  const providerBySpawn = new Map<string, string>();
  const spawnByProvider = new Map<string, string>();
  const retiredProviders = new Set<string>();
  return entries.map((entry) => {
    if (
      entry.type === 'worker_started' &&
      entry.workerProviderSessionId &&
      entry.spawnId &&
      !retiredProviders.has(entry.workerProviderSessionId) &&
      (!spawnByProvider.has(entry.workerProviderSessionId) ||
        spawnByProvider.get(entry.workerProviderSessionId) === entry.spawnId)
    ) {
      const childSessionId = childrenBySpawn.get(entry.spawnId);
      if (childSessionId) {
        const previousProviderSessionId = providerBySpawn.get(entry.spawnId);
        if (
          previousProviderSessionId &&
          previousProviderSessionId !== entry.workerProviderSessionId
        ) {
          childrenByProvider.delete(previousProviderSessionId);
          retiredProviders.add(previousProviderSessionId);
        }
        childrenByProvider.set(entry.workerProviderSessionId, childSessionId);
        correlatedSpawns.set(entry.spawnId, childSessionId);
        providerBySpawn.set(entry.spawnId, entry.workerProviderSessionId);
        spawnByProvider.set(entry.workerProviderSessionId, entry.spawnId);
      }
    }
    const byProvider =
      entry.workerProviderSessionId && !retiredProviders.has(entry.workerProviderSessionId)
        ? childrenByProvider.get(entry.workerProviderSessionId)
        : undefined;
    const bySpawn = entry.spawnId ? correlatedSpawns.get(entry.spawnId) : undefined;
    const childSessionId =
      entry.workerProviderSessionId && entry.spawnId
        ? providerBySpawn.get(entry.spawnId) === entry.workerProviderSessionId &&
          byProvider === bySpawn
          ? byProvider
          : undefined
        : (byProvider ?? bySpawn);
    const publicEntry = publicProgressEntry(entry);
    return childSessionId ? { ...publicEntry, workerChildSessionId: childSessionId } : publicEntry;
  });
}

function publicProgressEntry(entry: StoredProgressEntry): ProgressEntry {
  const publicEntry = { ...entry };
  delete publicEntry.workerProviderSessionId;
  delete publicEntry.spawnId;
  return publicEntry;
}

function readFeatures(path: string): BridgeFeature[] {
  if (!existsSync(path)) return [];
  const file = readJson(path) as StoredFeatureFile;
  return (file.features ?? []).map((feature) => bridgeFeature(feature));
}

function missionDirs(): string[] {
  const root = join(homedir(), '.factory', 'missions');
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .map((name) => join(root, name))
    .filter((path) => {
      try {
        return statSync(path).isDirectory() && existsSync(join(path, 'state.json'));
      } catch {
        return false;
      }
    });
}

export function resolveMissionDir(missionId: string): string {
  const unreadableDirs: string[] = [];
  for (const dir of missionDirs()) {
    if (basename(dir) === missionId) return dir;
    try {
      const state = readJson(join(dir, 'state.json')) as StoredMissionState;
      if (state.baseSessionId === missionId || state.missionId === missionId) return dir;
    } catch (error) {
      reportUnreadableMission(dir, error);
      unreadableDirs.push(dir);
    }
  }
  // An unreadable state.json hides which mission it belongs to, so name those directories.
  const skipped =
    unreadableDirs.length > 0
      ? `; unreadable mission directories: ${unreadableDirs.join(', ')}`
      : '';
  throw new Error(`Mission history not found for ${missionId}${skipped}`);
}

// Every registry rebuild re-enumerates missions, so each unreadable directory is logged once.
const reportedUnreadableMissionDirs = new Set<string>();

function reportUnreadableMission(dir: string, error: unknown): void {
  if (reportedUnreadableMissionDirs.has(dir)) return;
  reportedUnreadableMissionDirs.add(dir);
  // JSON.parse messages quote the file's contents, so name the failure instead.
  const reason = error instanceof SyntaxError ? 'a mission file is not valid JSON' : errMsg(error);
  console.warn(`Mission history ${dir} was skipped: ${reason}. Repair or remove the directory.`);
}

function titleFromProgressType(type?: string): string | undefined {
  if (!type) return undefined;
  return type.replace(/_/g, ' ');
}

function lastPathSegment(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? '';
}
