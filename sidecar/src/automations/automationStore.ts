import { PERMISSION_SEMANTICS_REVISION } from '../permissionSemantics.js';

import { parseAutomationStore } from './automationStoreParsing.js';
import { mkdir, open, readFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import type {
  AutomationRun,
  AutomationRunStatus,
  AutomationSnapshot,
  AutomationStore,
} from './types.js';

// Retention is deliberately tight: the whole store is serialized on every state
// change and the snapshot is broadcast to every renderer, so history costs both
// disk writes and socket traffic.
const MAX_RUNS = 150;
const MAX_PROPOSALS = 50;
const MAX_ORIGINS = 200;
const SNAPSHOT_RUNS = 60;
const SNAPSHOT_PROPOSALS = 25;

export function emptyAutomationStore(): AutomationStore {
  return {
    version: 1,
    permissionSemanticsRevision: PERMISSION_SEMANTICS_REVISION,
    automations: [],
    runs: [],
    proposals: [],
    sessionOrigins: {},
  };
}

/** Puts a snapshot taken before a mutation back onto the live store object. */
export function restoreAutomationStore(store: AutomationStore, snapshot: AutomationStore): void {
  store.automations = snapshot.automations;
  store.runs = snapshot.runs;
  store.proposals = snapshot.proposals;
  store.sessionOrigins = snapshot.sessionOrigins;
}

/** True when this chat was started by an automation run, even if origins were trimmed. */
export function storeHasRunSession(store: AutomationStore, appSessionId: string): boolean {
  if (store.sessionOrigins[appSessionId]) return true;
  const matching = store.runs.filter((run) => run.appSessionId === appSessionId);
  if (matching.length > 0)
    return matching.some((run) => run.automation.target.kind === 'new-session');
  return store.automations.some(
    (automation) =>
      automation.target.kind === 'new-session' && automation.lastAppSessionId === appSessionId,
  );
}

export function isActiveRunStatus(status: AutomationRunStatus): boolean {
  return status === 'starting' || status === 'running';
}

export function isSettledRunStatus(status: AutomationRunStatus): boolean {
  return status === 'completed' || status === 'failed';
}

/** Owns the automations file: canonical shape on disk, atomic writes, recovery. */
export class AutomationStoreFile {
  private tail: Promise<void> = Promise.resolve();
  private pendingPayload: string | null = null;
  private pendingWrite: Promise<void> | null = null;

  constructor(private readonly filePath: string) {}

  async read(now: number): Promise<AutomationStore> {
    let text: string;
    try {
      text = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if (isMissingFile(error)) return emptyAutomationStore();
      // Starting empty here would overwrite a store we simply could not read.
      throw error;
    }
    try {
      return parseAutomationStore(JSON.parse(text), now);
    } catch (error) {
      const quarantinePath = `${this.filePath}.unreadable-${String(now)}`;
      await rename(this.filePath, quarantinePath);
      throw new Error(
        `The DROIDEX automations file could not be read and was moved to ${quarantinePath}. Restart DROIDEX to start a new store, or restore that file after fixing it. Cause: ${errorMessage(error)}`,
      );
    }
  }

  /** Coalesce writes not yet started; a failed write never poisons the queue. */
  write(store: AutomationStore): Promise<void> {
    this.pendingPayload = `${JSON.stringify(store)}\n`;
    if (this.pendingWrite) return this.pendingWrite;
    const write = this.tail.then(() => {
      const payload = this.pendingPayload;
      this.pendingPayload = null;
      this.pendingWrite = null;
      return payload === null ? undefined : this.writeAtomically(payload);
    });
    this.pendingWrite = write;
    this.tail = write.catch(() => undefined);
    return write;
  }

  /** Resolves once every queued write has settled, successfully or not. */
  flush(): Promise<void> {
    return this.tail;
  }

  private async writeAtomically(payload: string): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${String(process.pid)}`;
    const temporary = await open(temporaryPath, 'w', 0o600);
    try {
      await temporary.writeFile(payload, 'utf8');
      await temporary.sync();
    } finally {
      await temporary.close();
    }
    await rename(temporaryPath, this.filePath);
    const directory = await open(dirname(this.filePath), 'r');
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }
}

/** Drops history beyond the retention caps without touching unsettled runs. */
export function trimAutomationStore(store: AutomationStore): void {
  store.runs = retainRuns(store);
  if (store.proposals.length > MAX_PROPOSALS) {
    const drafts = store.proposals.filter((proposal) => proposal.status === 'draft');
    const confirmed = store.proposals
      .filter((proposal) => proposal.status === 'confirmed')
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, Math.max(0, MAX_PROPOSALS - drafts.length));
    store.proposals = [...drafts, ...confirmed];
  }
  trimSessionOrigins(store);
}

export function buildAutomationSnapshot(
  store: AutomationStore,
  scheduler: { ready: boolean; nextWakeAt: number | null; activeRunId: string | null },
): AutomationSnapshot {
  let queuedRunCount = 0;
  let activeRunCount = 0;
  for (const run of store.runs) {
    if (run.status === 'queued') queuedRunCount += 1;
    else if (isActiveRunStatus(run.status)) activeRunCount += 1;
  }
  const runs = [...store.runs]
    .sort((left, right) => right.requestedAt - left.requestedAt)
    .slice(0, SNAPSHOT_RUNS);
  const proposals = [...store.proposals]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, SNAPSHOT_PROPOSALS);
  return {
    automations: structuredClone(store.automations),
    runs: structuredClone(runs),
    proposals: structuredClone(proposals),
    sessionOrigins: structuredClone(store.sessionOrigins),
    queuedRunCount,
    activeRunCount,
    scheduler,
  };
}

/** Preserve unsettled runs, each latest result, and worktrees still open for review. */
function retainRuns(store: AutomationStore): AutomationRun[] {
  const runs = store.runs;
  let excess = runs.length - MAX_RUNS;
  if (excess <= 0) return runs;
  const latestSettledPerAutomation = new Map<string, string>();
  for (const run of runs) {
    if (isSettledRunStatus(run.status)) latestSettledPerAutomation.set(run.automationId, run.id);
  }
  const protectedRunIds = new Set(latestSettledPerAutomation.values());
  const retained: AutomationRun[] = [];
  for (const run of runs) {
    if (
      excess > 0 &&
      isSettledRunStatus(run.status) &&
      !protectedRunIds.has(run.id) &&
      !holdsReviewWorkspace(store, run)
    ) {
      excess -= 1;
      continue;
    }
    retained.push(run);
  }
  return retained;
}

function trimSessionOrigins(store: AutomationStore): void {
  const entries = Object.entries(store.sessionOrigins);
  if (entries.length <= MAX_ORIGINS) return;
  // Origins that still have a run are live routing keys, not history.
  const liveRunIds = new Set(store.runs.map((run) => run.id));
  const keptRequired: typeof entries = [];
  const optional: typeof entries = [];
  for (const entry of entries) {
    const origin = entry[1];
    if (!origin) continue;
    if (liveRunIds.has(origin.runId)) keptRequired.push(entry);
    else optional.push(entry);
  }
  const room = Math.max(0, MAX_ORIGINS - keptRequired.length);
  store.sessionOrigins = Object.fromEntries([...optional.slice(-room), ...keptRequired]);
}

/** Isolated worktrees stay until the review chat closes. */
export function holdsReviewWorkspace(store: AutomationStore, run: AutomationRun): boolean {
  const appSessionId = run.appSessionId;
  return (
    run.automation.executionMode === 'worktree' &&
    Boolean(run.resolvedCwd?.trim()) &&
    typeof appSessionId === 'string' &&
    Boolean(store.sessionOrigins[appSessionId])
  );
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
