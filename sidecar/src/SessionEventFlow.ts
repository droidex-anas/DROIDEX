import type { DroidStreamEvent } from '@factory/droid-sdk';

import { normalizeNotification, normalizeStreamEvent, type NormalizedEvent } from './normalize.js';
import type { ChildSpawnLink, SessionRole, TranscriptEvent } from './protocol.js';
import { hotPathMetrics } from './telemetry/hotPathMetrics.js';

export type NormalizedSideEffects = Omit<
  NormalizedEvent,
  'transcript' | 'done' | 'tokens' | 'childOwner'
>;

// Where a row the provider marked as a child's own belongs.
export interface ChildTranscriptScope {
  childSessionId: string;
  role: SessionRole;
}
export type NormalizedTokenUsage = NonNullable<NormalizedEvent['tokens']>;

export interface SessionEventFlowDependencies {
  appendTranscript: (event: TranscriptEvent) => void;
  flushTranscript: (appSessionId: string, sourceSessionId: string) => void;
  applySideEffects: (appSessionId: string, sideEffects: NormalizedSideEffects) => void;
  // The child that owns a spawn link, 'ambiguous' when several share it, or
  // undefined while the store has not admitted one yet.
  resolveChildScope: (
    appSessionId: string,
    spawnLink: ChildSpawnLink,
  ) => ChildTranscriptScope | 'ambiguous' | undefined;
  recordUsage: (
    appSessionId: string,
    sourceProviderSessionId: string,
    usage: NormalizedTokenUsage,
  ) => void;
}

const POST_TERMINAL_GENERATION_KINDS = new Set(['text', 'thinking', 'tool_call', 'tool_result']);

export class SessionEventFlow {
  private readonly terminalSources = new Map<string, Set<string>>();
  // Spawns already reported as unadmitted. Every delta of an unresolved or
  // ambient agent reaches the drop, and one line per row is a flood, not a
  // diagnostic.
  private readonly warnedSpawns = new Map<string, Set<string>>();

  constructor(private readonly dependencies: SessionEventFlowDependencies) {}

  beginTurn(appSessionId: string, sourceProviderSessionId: string): void {
    this.terminalSources.get(appSessionId)?.delete(sourceProviderSessionId);
  }

  applyStreamEvent(
    appSessionId: string,
    sourceProviderSessionId: string,
    role: SessionRole,
    event: DroidStreamEvent,
    childSessionId?: string,
  ): void {
    const normalizeStartedAt = performance.now();
    const normalized = normalizeStreamEvent(appSessionId, sourceProviderSessionId, role, event);
    hotPathMetrics.recordNormalize(performance.now() - normalizeStartedAt);
    if (normalized) {
      this.apply(appSessionId, sourceProviderSessionId, role, normalized, childSessionId);
    }
  }

  applyNotification(
    appSessionId: string,
    sourceProviderSessionId: string,
    role: SessionRole,
    notification: Record<string, unknown>,
    childSessionId?: string,
  ): void {
    const normalizeStartedAt = performance.now();
    const notifications = normalizeNotification(
      appSessionId,
      sourceProviderSessionId,
      role,
      notification,
    );
    hotPathMetrics.recordNormalize(performance.now() - normalizeStartedAt);
    for (const normalized of notifications) {
      this.apply(appSessionId, sourceProviderSessionId, role, normalized, childSessionId);
    }
  }

  forgetSession(appSessionId: string): void {
    this.terminalSources.delete(appSessionId);
    this.warnedSpawns.delete(appSessionId);
  }

  // A provider session streams already-normalized events; SDK-shaped callbacks
  // reach the same path through applyStreamEvent / applyNotification.
  apply(
    appSessionId: string,
    sourceProviderSessionId: string,
    role: SessionRole,
    normalized: NormalizedEvent,
    childSessionId?: string,
  ): void {
    if (normalized.done) {
      this.terminalScope(appSessionId).add(sourceProviderSessionId);
      return;
    }

    // A subagent's own rows arrive inside the parent's stream. They are that
    // agent's steps, so they take its scope and never fall back to the parent's
    // feed: shown there they read as the parent's own work and cut its answer in
    // half.
    const owned = this.ownedBy(appSessionId, normalized.childOwner);
    if (owned === 'unadmitted') {
      // A row with no agent to hold it would read as the parent's own work, so
      // it is dropped; say so once per spawn, because a silent loss is
      // undiagnosable and a line per row is a flood.
      this.warnUnadmitted(appSessionId, normalized);
      return;
    }

    const terminal = this.terminalSources.get(appSessionId)?.has(sourceProviderSessionId);
    const transcript =
      terminal && isPostTerminalGeneration(normalized.transcript)
        ? undefined
        : normalized.transcript;
    if (transcript) this.dependencies.appendTranscript(scoped(transcript, childSessionId, owned));
    if (normalized.tokens)
      this.dependencies.recordUsage(appSessionId, sourceProviderSessionId, normalized.tokens);

    const sideEffects = normalizedSideEffects(normalized);
    if (hasSideEffects(sideEffects)) {
      try {
        const sourceSessionId =
          childSessionId ??
          owned?.childSessionId ??
          (role === 'primary' ? appSessionId : sourceProviderSessionId);
        this.dependencies.flushTranscript(appSessionId, sourceSessionId);
      } catch {
        // Provider notifications are synchronous SDK callbacks. Persistence
        // failures are already reported and remain owned by turn settlement;
        // never let a callback consume or rethrow that sticky failure.
        return;
      }
      this.dependencies.applySideEffects(appSessionId, sideEffects);
    }
  }

  // Where a row the provider attributed to a spawn belongs, or 'unadmitted'
  // while the store has no child for that spawn yet.
  private ownedBy(
    appSessionId: string,
    owner: ChildSpawnLink | undefined,
  ): ChildTranscriptScope | 'unadmitted' | undefined {
    if (!owner) return undefined;
    const scope = this.dependencies.resolveChildScope(appSessionId, owner);
    // Several agents share this spawn, so nothing here can say which one acted.
    // The row stays the parent's rather than being filed under a sibling, where
    // it would be wrong in one pane and missing from another.
    if (scope === 'ambiguous') return undefined;
    return scope ?? 'unadmitted';
  }

  private warnUnadmitted(appSessionId: string, normalized: NormalizedEvent): void {
    const spawnId = normalized.childOwner?.id ?? 'unknown';
    let warned = this.warnedSpawns.get(appSessionId);
    if (!warned) {
      warned = new Set<string>();
      this.warnedSpawns.set(appSessionId, warned);
    }
    if (warned.has(spawnId)) return;
    warned.add(spawnId);
    console.warn(
      `[children] dropping rows for an unadmitted agent (spawn ${spawnId}); the first was a ${normalized.transcript?.kind ?? 'provider'} row`,
    );
  }

  private terminalScope(appSessionId: string): Set<string> {
    const existing = this.terminalSources.get(appSessionId);
    if (existing) return existing;
    const created = new Set<string>();
    this.terminalSources.set(appSessionId, created);
    return created;
  }
}

function scoped(
  event: TranscriptEvent,
  childSessionId: string | undefined,
  owned: ChildTranscriptScope | undefined,
): TranscriptEvent {
  if (owned) return { ...event, sourceSessionId: owned.childSessionId, role: owned.role };
  if (childSessionId) return { ...event, sourceSessionId: childSessionId };
  return event;
}

function isPostTerminalGeneration(transcript: TranscriptEvent | undefined): boolean {
  return Boolean(
    transcript && !transcript.isError && POST_TERMINAL_GENERATION_KINDS.has(transcript.kind),
  );
}

function hasSideEffects(sideEffects: NormalizedSideEffects): boolean {
  return Boolean(
    sideEffects.features ??
    sideEffects.progress ??
    sideEffects.missionState ??
    sideEffects.missionChild ??
    sideEffects.childSession,
  );
}

function normalizedSideEffects(normalized: NormalizedEvent): NormalizedSideEffects {
  let childSession = normalized.childSession;
  // Admission and the UI must share the exact accepted spawn event identity.
  const spawnId =
    normalized.transcript?.kind === 'tool_call' ? normalized.transcript.id : undefined;
  if (childSession && spawnId && !childSession.toolUseId) {
    childSession = { ...childSession, toolUseId: spawnId };
  }
  return {
    ...(normalized.features ? { features: normalized.features } : {}),
    ...(normalized.progress ? { progress: normalized.progress } : {}),
    ...(normalized.missionState ? { missionState: normalized.missionState } : {}),
    ...(normalized.missionChild ? { missionChild: normalized.missionChild } : {}),
    ...(childSession ? { childSession } : {}),
  };
}
