import type { McpServerConfig } from '@factory/droid-sdk';
import type { FactorySession } from './DroidRuntime.js';
import type { PersistedChildSession, PersistedChildSpawnLink } from './history.js';
import { publishedStreamFidelity } from './childStreamFidelity.js';
import type {
  Autonomy,
  ChildActivity,
  ChildStatus,
  ReasoningEffort,
  SessionSummary,
  StreamFidelity,
} from './protocol.js';
import { normalizeAutonomy, reasoningValue, type SessionInitResult } from './sessionHelpers.js';
/* eslint-disable @typescript-eslint/no-unused-vars -- persisted-only fields are intentionally omitted. */
export interface ChildIdentity {
  parentAppSessionId: string;
  childSessionId: string;
}
export interface ChildSettings {
  modelId?: string;
  reasoningEffort?: ReasoningEffort;
  autonomy?: Autonomy;
}
export interface ChildSpawnObservation {
  parentAppSessionId: string;
  providerSessionId?: string;
  role: PersistedChildSession['role'];
  spawnLink?: PersistedChildSession['spawnLink'];
  label?: string;
  prompt?: string;
  modelId?: string;
  reasoningEffort?: ReasoningEffort;
  // Task children choose their model in Factory. DROIDEX must wait for that
  // provider session's settings instead of substituting parent defaults.
  requiresExactLaunchSettings?: boolean;
  done?: boolean;
  // Latest activity observed for this child (a poll's status, plus the last line
  // it had produced). Live-only: never persisted, since it describes a moment
  // rather than the session.
  activity?: ChildActivity;
  status?: ChildStatus;
  group?: string;
  phase?: string;
  transcriptAvailable?: boolean;
}
export interface ChildParentLease {
  summary: SessionSummary;
  // Opening a child runtime is supported only through the parent's SDK session.
  droid?: FactorySession;
  mcpConfigs: McpServerConfig[];
  closeMode?: 'discard-pending' | 'preserve-pending';
}

export function parentDroidSession(lease: ChildParentLease): FactorySession {
  if (!lease.droid)
    throw new Error(`Child sessions are not supported for the ${lease.summary.provider} provider.`);
  return lease.droid;
}
export interface ChildRuntimeState {
  session: FactorySession;
  generation: number;
  lastUsedAt: number;
  unsubscribe?: () => void;
}
export interface ChildTurnState {
  generation: number;
  phase: 'idle' | 'streaming';
  autoCompacting: boolean;
  pendingSends: string[];
  pendingDrainEpoch: number;
  interruptingForSteer: boolean;
  interrupting: boolean;
}
export interface ChildSessionState {
  identity: ChildIdentity;
  role: PersistedChildSession['role'];
  status: PersistedChildSession['status'];
  providerSessionId?: string;
  label?: string;
  prompt?: string;
  group?: string;
  phase?: string;
  modelId: string;
  reasoningEffort?: ReasoningEffort;
  // Confirmed effective autonomy reported by the child's init result. Runtime-
  // scoped: set when the child opens, cleared when its runtime closes or is
  // replaced. Never persisted and never inherited from the parent.
  autonomy?: Autonomy;
  spawnLink?: PersistedChildSession['spawnLink'];
  transcriptAvailable: boolean;
  startedAt?: number;
  settledAt?: number;
  // See ChildSpawnObservation.activity: live-only, so it is absent after a
  // restart even though the child itself is restored from history.
  activity?: ChildActivity;
  // Live-only. Absent until a token/tool stream is opened; summaries publish `state`.
  streamFidelity?: StreamFidelity;
  runtimeGeneration: number;
  configurationGeneration: number;
  retiredProviderSessionIds: Set<string>;
  runtime?: ChildRuntimeState;
  turn: ChildTurnState;
  closeWhenIdle: boolean;
  mutationTail?: Promise<void>;
  queued?: boolean;
  queuedRequestId?: string | null;
}
export interface ChildOpenAttempt {
  settled: Promise<void>;
  settle(): void;
  cancelled: Promise<void>;
  cancel(): void;
  isCancelled: boolean;
  provisionalSession?: FactorySession;
  provisionalClose?: Promise<void>;
}
export interface ParentChildSessions {
  parentAppSessionId: string;
  generation: number;
  lease: ChildParentLease;
  children: Map<string, ChildSessionState>;
  pendingSpawns: Map<string, ChildSpawnObservation>;
  openAttempts: Map<string, ChildOpenAttempt>;
  reservedOpenSlots: Set<string>;
  runtimeQueue: string[];
  closing: boolean;
}
export interface ChildRuntimeTarget {
  parent: ParentChildSessions;
  child: ChildSessionState;
  runtime: ChildRuntimeState;
}
export function childIdentity(parentAppSessionId: string, childSessionId: string): ChildIdentity {
  return { parentAppSessionId, childSessionId };
}

export function childSettingsFromInit(init: SessionInitResult): ChildSettings {
  return {
    modelId: init.settings?.modelId,
    reasoningEffort: reasoningValue(init.settings?.reasoningEffort),
    autonomy: normalizeAutonomy(init.settings?.autonomyLevel),
  };
}

/** Nothing in this process is driving a child that comes back from history: the
    session that was streaming it died with the lease that persisted it, so a
    stored 'running' would read as work in flight forever. */
export function restoredChildStatus(
  status: PersistedChildSession['status'],
): PersistedChildSession['status'] {
  return status === 'running' ? 'paused' : status;
}

export function childStateFromRecord(record: PersistedChildSession): ChildSessionState {
  const {
    parentAppSessionId,
    childSessionId,
    previousProviderSessionIds,
    updatedAt: _updatedAt,
    ...persisted
  } = record;
  return {
    identity: childIdentity(parentAppSessionId, childSessionId),
    ...persisted,
    status: restoredChildStatus(persisted.status),
    runtimeGeneration: 1,
    configurationGeneration: 1,
    retiredProviderSessionIds: new Set(previousProviderSessionIds),
    turn: {
      generation: 0,
      phase: 'idle',
      autoCompacting: false,
      pendingSends: [],
      pendingDrainEpoch: 0,
      interruptingForSteer: false,
      interrupting: false,
    },
    closeWhenIdle: false,
  };
}

export function newChildState(input: {
  parentAppSessionId: string;
  childSessionId: string;
  role: PersistedChildSession['role'];
  spawnLink?: PersistedChildSpawnLink;
  modelId: string;
  reasoningEffort?: ReasoningEffort;
  updatedAt: number;
}): ChildSessionState {
  return childStateFromRecord({
    parentAppSessionId: input.parentAppSessionId,
    childSessionId: input.childSessionId,
    role: input.role,
    status: 'pending',
    modelId: input.modelId,
    reasoningEffort: input.reasoningEffort,
    ...(input.spawnLink ? { spawnLink: input.spawnLink } : {}),
    transcriptAvailable: false,
    updatedAt: input.updatedAt,
  });
}

const isSettledStatus = (status: ChildStatus): boolean =>
  status === 'completed' || status === 'failed';

/** The one door every child status change goes through, so a finished child
    remembers when it finished and one that runs again forgets. The first stamp
    wins: a settled child observed as settled again keeps the moment it stopped. */
export function setChildStatus(child: ChildSessionState, status: ChildStatus, now: number): void {
  child.status = status;
  if (isSettledStatus(status)) child.settledAt ??= now;
  else child.settledAt = undefined;
}

export function applyObservedChild(
  child: ChildSessionState,
  observed: ChildSpawnObservation,
  spawnLink: PersistedChildSpawnLink | undefined,
  providerSessionId: string,
  now: number,
): { previousPrompt: string | undefined } {
  if (child.providerSessionId && child.providerSessionId !== providerSessionId)
    child.retiredProviderSessionIds.add(child.providerSessionId);
  const previousPrompt = child.prompt;
  if (child.role !== observed.role) {
    child.role = observed.role;
    child.configurationGeneration += 1;
  }
  child.providerSessionId = providerSessionId;
  if (observed.transcriptAvailable === false && !observed.done) child.closeWhenIdle = false;
  // Terminal observations settle through complete(), after metadata is applied.
  // A state feed can report the same ending more than once; a child that has
  // already settled must not be walked back through 'running', which would
  // restart its clock.
  if (observed.done) {
    if (!isSettledStatus(child.status)) setChildStatus(child, 'running', now);
  } else if (observed.status) setChildStatus(child, observed.status, now);
  else if (observed.transcriptAvailable !== false) setChildStatus(child, 'running', now);
  applyChildLaunchSettings(child, {
    modelId: observed.modelId,
    reasoningEffort: observed.reasoningEffort,
  });
  // Polled labels keep their original casing; state feeds can add a nickname later.
  if (observed.transcriptAvailable === false) child.label = observed.label ?? child.label;
  else child.label ??= observed.label;
  child.group ??= observed.group;
  child.phase = observed.phase ?? child.phase;
  child.prompt = observed.prompt ?? child.prompt;
  child.spawnLink = spawnLink ?? child.spawnLink;
  child.activity = observed.activity ?? child.activity;
  child.transcriptAvailable = observed.transcriptAvailable ?? true;
  child.startedAt ??= now;
  return { previousPrompt };
}

export function applyChildLaunchSettings(child: ChildSessionState, settings: ChildSettings): void {
  if (!settings.modelId) return;
  if (child.modelId === settings.modelId && child.reasoningEffort === settings.reasoningEffort)
    return;
  child.modelId = settings.modelId;
  child.reasoningEffort = settings.reasoningEffort;
  child.configurationGeneration += 1;
}

export function persistedChild(child: ChildSessionState): PersistedChildSession {
  return {
    ...child.identity,
    role: child.role,
    status: child.status,
    modelId: child.modelId,
    transcriptAvailable: child.transcriptAvailable,
    updatedAt: 0,
    ...(child.providerSessionId ? { providerSessionId: child.providerSessionId } : {}),
    ...(child.retiredProviderSessionIds.size > 0
      ? { previousProviderSessionIds: [...child.retiredProviderSessionIds] }
      : {}),
    ...(child.label ? { label: child.label } : {}),
    ...(child.prompt ? { prompt: child.prompt } : {}),
    ...(child.group ? { group: child.group } : {}),
    ...(child.phase ? { phase: child.phase } : {}),
    ...(child.reasoningEffort ? { reasoningEffort: child.reasoningEffort } : {}),
    ...(child.spawnLink ? { spawnLink: child.spawnLink } : {}),
    ...(child.startedAt === undefined ? {} : { startedAt: child.startedAt }),
    ...(child.settledAt === undefined ? {} : { settledAt: child.settledAt }),
  };
}

export function childSummary(child: ChildSessionState | PersistedChildSession) {
  const record = 'identity' in child ? persistedChild(child) : child;
  const {
    providerSessionId: _provider,
    previousProviderSessionIds: _previousProviders,
    updatedAt: _updatedAt,
    ...summary
  } = record;
  // Activity is live-only state, so it comes from the in-memory child rather
  // than the persisted record.
  const live = 'identity' in child ? child : undefined;
  return {
    ...summary,
    // Autonomy is runtime-scoped: only a live child reports its confirmed value.
    ...(live?.runtime && live.autonomy ? { autonomy: live.autonomy } : {}),
    ...(live?.activity ? { activity: live.activity } : {}),
    ...(live?.queued ? { queued: true } : {}),
    streamFidelity: publishedStreamFidelity(live?.streamFidelity),
  };
}

export function childHistoryProviderSessionIds(
  child: ChildSessionState | PersistedChildSession,
): string[] {
  const previous =
    'identity' in child
      ? [...child.retiredProviderSessionIds]
      : (child.previousProviderSessionIds ?? []);
  return [...previous, ...(child.providerSessionId ? [child.providerSessionId] : [])];
}

export function childDurabilityKey(identity: ChildIdentity): string {
  return `${identity.parentAppSessionId}\u0000${identity.childSessionId}`;
}

export function findChildByProvider(
  parent: ParentChildSessions,
  providerSessionId: string,
): ChildSessionState | undefined {
  return [...parent.children.values()].find(
    (child) =>
      child.runtime?.session.sessionId === providerSessionId ||
      child.providerSessionId === providerSessionId,
  );
}

export function findChildBySpawn(parent: ParentChildSessions, spawnLink: PersistedChildSpawnLink) {
  return childrenBySpawn(parent, spawnLink)[0];
}

// Every child that carries this spawn. A workflow gives all of its agents the
// same spawn link, so a caller that needs one child has to say what it means by
// "the" child rather than take whichever comes first.
export function childrenBySpawn(
  parent: ParentChildSessions,
  spawnLink: PersistedChildSpawnLink,
): ChildSessionState[] {
  return [...parent.children.values()].filter(
    (child) => child.spawnLink?.kind === spawnLink.kind && child.spawnLink.id === spawnLink.id,
  );
}

function pendingObservationKey(observation: ChildSpawnObservation): string | undefined {
  if (observation.transcriptAvailable === false && observation.providerSessionId)
    return `provider:${observation.providerSessionId}`;
  if (observation.spawnLink)
    return `spawn:${observation.spawnLink.kind}:${observation.spawnLink.id}`;
  return observation.providerSessionId ? `provider:${observation.providerSessionId}` : undefined;
}

export function findPendingChildObservation(
  parent: ParentChildSessions,
  observation: ChildSpawnObservation,
): ChildSpawnObservation | undefined {
  const key = pendingObservationKey(observation);
  const exact = key ? parent.pendingSpawns.get(key) : undefined;
  if (exact || !observation.providerSessionId) return exact;
  return [...parent.pendingSpawns.values()].find(
    (pending) => pending.providerSessionId === observation.providerSessionId,
  );
}

export function mergeChildObservations(
  pending: ChildSpawnObservation | undefined,
  observation: ChildSpawnObservation,
): ChildSpawnObservation {
  return {
    ...pending,
    ...observation,
    providerSessionId: observation.providerSessionId ?? pending?.providerSessionId,
    spawnLink: pending?.spawnLink ?? observation.spawnLink,
    label: pending?.label ?? observation.label,
    prompt: observation.prompt ?? pending?.prompt,
    modelId: observation.modelId ?? pending?.modelId,
    reasoningEffort:
      observation.modelId !== undefined ? observation.reasoningEffort : pending?.reasoningEffort,
    requiresExactLaunchSettings:
      observation.requiresExactLaunchSettings === true ||
      pending?.requiresExactLaunchSettings === true,
    done:
      observation.status === 'completed' ||
      observation.status === 'failed' ||
      observation.done === true ||
      pending?.done === true,
    activity: observation.activity ?? pending?.activity,
  };
}

export function rememberPendingChildObservation(
  parent: ParentChildSessions,
  previous: ChildSpawnObservation | undefined,
  observation: ChildSpawnObservation,
): void {
  const previousKey = previous ? pendingObservationKey(previous) : undefined;
  if (previousKey) parent.pendingSpawns.delete(previousKey);
  const key = pendingObservationKey(observation);
  if (key) parent.pendingSpawns.set(key, observation);
}

export function forgetPendingChildObservation(
  parent: ParentChildSessions,
  observation: ChildSpawnObservation | undefined,
): void {
  const key = observation ? pendingObservationKey(observation) : undefined;
  if (key && parent.pendingSpawns.get(key) === observation) parent.pendingSpawns.delete(key);
}

export function childAcceptsWork(child: ChildSessionState): boolean {
  return child.status !== 'completed' && child.status !== 'failed' && !child.closeWhenIdle;
}

// Work the parent must not close out from under: a running or queued child, a
// turn in flight, or a mutation that has not settled.
export function childHasWorkInFlight(child: ChildSessionState): boolean {
  return (
    child.status === 'running' ||
    child.status === 'pending' ||
    child.queued === true ||
    child.turn.phase !== 'idle' ||
    child.turn.autoCompacting ||
    child.turn.pendingSends.length > 0 ||
    child.turn.interrupting ||
    child.turn.interruptingForSteer ||
    child.mutationTail !== undefined
  );
}
