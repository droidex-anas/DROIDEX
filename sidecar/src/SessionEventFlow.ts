import type { DroidStreamEvent } from '@factory/droid-sdk';

import { normalizeNotification, normalizeStreamEvent, type NormalizedEvent } from './normalize.js';
import type { ChildSpawnLink, SessionRole, TranscriptEvent } from './protocol.js';
import { hotPathMetrics } from './telemetry/hotPathMetrics.js';
import { CanvasToolPresentation } from './canvas/canvasToolPresentation.js';
import { appendCanvasToolBinding } from './canvas/canvasToolBindings.js';

export type NormalizedSideEffects = Omit<
  NormalizedEvent,
  'transcript' | 'done' | 'tokens' | 'childOwner' | 'toolProvenance'
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
  private readonly canvasBySession = new Map<string, CanvasToolPresentation>();
  private readonly unboundToolDeltas = new Map<string, Map<string, TranscriptEvent[]>>();
  private readonly ordinaryToolIds = new Map<string, Set<string>>();
  private readonly terminalSources = new Map<string, Set<string>>();
  // Spawns already reported as unadmitted. Every delta of an unresolved or
  // ambient agent reaches the drop, and one line per row is a flood, not a
  // diagnostic.
  private readonly warnedSpawns = new Map<string, Set<string>>();

  constructor(private readonly dependencies: SessionEventFlowDependencies) {}

  beginTurn(appSessionId: string, sourceProviderSessionId: string): void {
    this.terminalSources.get(appSessionId)?.delete(sourceProviderSessionId);
    if (appSessionId === sourceProviderSessionId) {
      this.clearToolState(appSessionId, 'primary');
      this.canvasBySession.get(appSessionId)?.clearBindings('primary');
    } else {
      this.clearToolState(appSessionId, sourceProviderSessionId);
      this.canvasBySession.get(appSessionId)?.clearBindings(sourceProviderSessionId);
    }
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
    this.canvasBySession.delete(appSessionId);
    this.unboundToolDeltas.delete(appSessionId);
    this.ordinaryToolIds.delete(appSessionId);
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
      this.clearToolState(
        appSessionId,
        role === 'primary' ? 'primary' : (childSessionId ?? sourceProviderSessionId),
      );
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
    if (transcript)
      this.appendProjected(appSessionId, transcript, normalized, childSessionId, owned);
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

  private canvasFor(appSessionId: string): CanvasToolPresentation {
    const existing = this.canvasBySession.get(appSessionId);
    if (existing) return existing;
    const projector = new CanvasToolPresentation([], (binding) => {
      appendCanvasToolBinding(appSessionId, binding);
    });
    this.canvasBySession.set(appSessionId, projector);
    return projector;
  }

  private appendProjected(
    appSessionId: string,
    transcript: TranscriptEvent,
    normalized: NormalizedEvent,
    childSessionId: string | undefined,
    owned: ChildTranscriptScope | undefined,
  ): void {
    const canvas = this.canvasFor(appSessionId);
    const event = scoped(transcript, childSessionId, owned);
    const toolUseId = event.kind === 'tool_call' ? event.toolUseId : undefined;
    const key = toolUseId ? toolCorrelationKey(event) : undefined;
    if (
      key &&
      !event.toolName &&
      !canvas.hasBinding(event) &&
      !this.ordinaryToolIds.get(appSessionId)?.has(key)
    ) {
      let pending = this.unboundToolDeltas.get(appSessionId);
      if (!pending) {
        pending = new Map();
        this.unboundToolDeltas.set(appSessionId, pending);
      }
      const deltas = pending.get(key) ?? [];
      // An unnamed call is held until its server is known. The named call
      // carries the full input, so only a bounded set of partials is needed.
      if (deltas.length < 32) deltas.push(event);
      pending.set(key, deltas);
      return;
    }
    if (key && event.toolName) {
      const pending = this.unboundToolDeltas.get(appSessionId)?.get(key);
      if (!normalized.toolProvenance) this.ordinaryToolIdsFor(appSessionId).add(key);
      if (pending) {
        for (const delta of pending)
          this.dependencies.appendTranscript(canvas.project(delta, normalized.toolProvenance));
        this.unboundToolDeltas.get(appSessionId)?.delete(key);
      }
    }
    this.dependencies.appendTranscript(canvas.project(event, normalized.toolProvenance));
    if (event.kind === 'tool_result' && event.toolUseId)
      this.ordinaryToolIds.get(appSessionId)?.delete(toolCorrelationKey(event));
  }

  private ordinaryToolIdsFor(appSessionId: string): Set<string> {
    const existing = this.ordinaryToolIds.get(appSessionId);
    if (existing) return existing;
    const ids = new Set<string>();
    this.ordinaryToolIds.set(appSessionId, ids);
    return ids;
  }

  private clearToolState(appSessionId: string, sourceSessionId: string): void {
    const prefix = `${sourceSessionId}\0`;
    const pending = this.unboundToolDeltas.get(appSessionId);
    if (pending) {
      for (const key of pending.keys()) {
        if (key.startsWith(prefix)) pending.delete(key);
      }
    }
    const ordinary = this.ordinaryToolIds.get(appSessionId);
    if (ordinary) {
      for (const key of ordinary) {
        if (key.startsWith(prefix)) ordinary.delete(key);
      }
    }
  }
}

function toolCorrelationKey(event: TranscriptEvent): string {
  const sourceSessionId = event.role === 'primary' ? 'primary' : event.sourceSessionId;
  return `${sourceSessionId}\0${event.toolUseId ?? ''}`;
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
