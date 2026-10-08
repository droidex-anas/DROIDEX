import type {
  LiveChildIdentity,
  LiveProcessIdentity,
  LiveRuntimeJournal,
  LiveSessionIdentity,
} from './liveRuntimeJournal.js';
import type { InterruptedSessionRecord, SessionPhase, SessionSummary } from './protocol.js';
import { DEFAULT_PROVIDER } from './providers/providerKind.js';
import { errMsg } from './errors.js';
import type { SessionLifecycle } from './SessionLifecycle.js';
import { adoptedSessionFacts, retirableSessions } from './sessionRuntimeRetirement.js';

export const TURN_INTERRUPTED = 'The agent runtime restarted and this turn did not continue.';
const SESSION_UNAVAILABLE = 'This session could not reconnect. Reopen it to continue.';
const CHILD_INTERRUPTED = 'The agent runtime restarted and this child agent did not continue.';

export interface SessionAdoptionDependencies {
  journal: LiveRuntimeJournal;
  registry: {
    liveSessionsSnapshot(): readonly { summary: SessionSummary }[];
    getCanonicalSummary(id: string): SessionSummary | undefined;
    getLive(id: string): { summary: SessionSummary } | undefined;
    // The owner of a live session's summary: patches what it says now, then
    // stores and publishes it.
    updateSummary(
      id: string,
      patch: Pick<SessionSummary, 'streaming' | 'phase' | 'interruptReason'>,
      options: { touchActivity: false },
    ): unknown;
  };
  lifecycle: Pick<SessionLifecycle, 'resume'>;
  liveChildren: () => readonly LiveChildIdentity[];
  recordedProcesses: () => LiveProcessIdentity[];
  // Kills whatever the previous run left running, matched by start time so a
  // recycled pid is never signalled.
  reapProcesses: (entries: readonly LiveProcessIdentity[]) => Promise<void>;
  // Stores and publishes the summary of a session that has no live runtime.
  persistSummaries: (summaries: SessionSummary[]) => void | Promise<void>;
  appendStatus: (appSessionId: string, text: string) => void;
  sessionRuntimeIdleMs: number;
  now: () => number;
}

export interface SessionAdoptionResult {
  interrupted: InterruptedSessionRecord[];
}

export class SessionAdoption {
  private started: Promise<SessionAdoptionResult> | null = null;
  private readonly interrupted: InterruptedSessionRecord[] = [];

  constructor(private readonly dependencies: SessionAdoptionDependencies) {}

  records(): readonly InterruptedSessionRecord[] {
    return this.interrupted;
  }

  adopt(): Promise<SessionAdoptionResult> {
    this.started ??= this.adoptOnce();
    return this.started;
  }

  persistLiveSet(): void {
    const sessions: LiveSessionIdentity[] = this.dependencies.registry
      .liveSessionsSnapshot()
      .flatMap((live) => {
        const providerSessionId = live.summary.providerSessionId;
        if (!providerSessionId) return [];
        return [
          {
            appSessionId: live.summary.appSessionId,
            providerSessionId,
            phase: live.summary.phase,
            streaming: live.summary.streaming === true,
            lastActiveAt: live.summary.updatedAt,
          },
        ];
      });
    this.dependencies.journal.write({
      sessions,
      children: [...this.dependencies.liveChildren()],
      processes: this.dependencies.recordedProcesses(),
    });
  }

  private async adoptOnce(): Promise<SessionAdoptionResult> {
    const d = this.dependencies;
    const identities = d.journal.read();
    // Before anything is resurrected: a session that comes back must not
    // inherit a dev server from the run that died holding the port.
    await d.reapProcesses(identities.processes);
    // Retirement owns the idle budget and count cap, so boot never spawns
    // runtimes the first sweep would immediately release.
    const facts = identities.sessions.map((session) =>
      adoptedSessionFacts({
        appSessionId: session.appSessionId,
        phase: session.phase,
        streaming: session.streaming,
        lastActiveAt: session.lastActiveAt,
        hasUnsettledChildren: identities.children.some(
          (child) =>
            child.parentAppSessionId === session.appSessionId &&
            (child.status === 'running' || child.status === 'pending'),
        ),
      }),
    );
    for (const session of identities.sessions) {
      if (retirableSessions(facts, d.now(), d.sessionRuntimeIdleMs).includes(session.appSessionId))
        continue;
      await this.adoptSession(session);
    }
    for (const child of identities.children) this.markChildInterrupted(child);
    this.persistLiveSet();
    return { interrupted: [...this.interrupted] };
  }

  private async adoptSession(identity: LiveSessionIdentity): Promise<void> {
    const historical = this.dependencies.registry.getCanonicalSummary(identity.appSessionId);
    // Settled turns retain their phase; only the journal's streaming flag means unfinished work.
    const wasActive = identity.streaming;
    try {
      const resumed = await this.dependencies.lifecycle.resume(identity.appSessionId);
      if (!resumed) {
        await this.markSessionInterrupted(identity, historical, wasActive, SESSION_UNAVAILABLE);
        return;
      }
      if (!wasActive) return;
      const reconnected = this.dependencies.registry.getLive(identity.appSessionId) !== undefined;
      await this.markSessionInterrupted(
        identity,
        historical,
        true,
        reconnected ? 'Send a message to resume.' : SESSION_UNAVAILABLE,
      );
    } catch (error) {
      await this.markSessionInterrupted(
        identity,
        historical,
        wasActive,
        `${SESSION_UNAVAILABLE} (${errMsg(error)})`,
      );
    }
  }

  private async markSessionInterrupted(
    identity: LiveSessionIdentity,
    historical: SessionSummary | undefined,
    wasActive: boolean,
    reason: string,
  ): Promise<void> {
    const prefix = wasActive ? TURN_INTERRUPTED : 'The agent runtime restarted.';
    const interruptReason = `${prefix} ${reason}`;
    const { registry } = this.dependencies;
    const live = registry.getLive(identity.appSessionId);
    if (live) {
      registry.updateSummary(
        identity.appSessionId,
        interruption(live.summary, wasActive, interruptReason),
        { touchActivity: false },
      );
    } else {
      const base = historical ?? syntheticSummary(identity);
      await this.dependencies.persistSummaries([
        { ...base, ...interruption(base, wasActive, interruptReason) },
      ]);
      // The chat was opened while this was stored, and speaks for itself now.
      if (registry.getLive(identity.appSessionId)) return;
    }
    this.interrupted.push({ appSessionId: identity.appSessionId, reason: interruptReason });
    this.dependencies.appendStatus(identity.appSessionId, interruptReason);
  }

  private markChildInterrupted(identity: LiveChildIdentity): void {
    if (identity.status !== 'running') return;
    this.interrupted.push({
      appSessionId: identity.parentAppSessionId,
      childSessionId: identity.childSessionId,
      reason: CHILD_INTERRUPTED,
    });
  }
}

function interruption(
  summary: SessionSummary,
  wasActive: boolean,
  reason: string,
): Pick<SessionSummary, 'streaming' | 'phase' | 'interruptReason'> {
  return {
    streaming: false,
    phase: wasActive ? interruptedPhase(summary.phase) : summary.phase,
    interruptReason: reason,
  };
}

function interruptedPhase(phase: SessionPhase): SessionPhase {
  if (phase === 'completed' || phase === 'failed' || phase === 'paused') return phase;
  return 'paused';
}

function syntheticSummary(identity: LiveSessionIdentity): SessionSummary {
  const now = Date.now();
  return {
    appSessionId: identity.appSessionId,
    providerSessionId: identity.providerSessionId,
    provider: DEFAULT_PROVIDER,
    sessionPurpose: 'chat',
    interactionMode: 'auto',
    role: 'primary',
    title: `Session ${identity.providerSessionId.slice(0, 8)}`,
    goal: '',
    cwd: '',
    autonomy: 'off',
    phase: 'paused',
    streaming: false,
    features: [],
    tokensIn: 0,
    tokensOut: 0,
    contextTokens: 0,
    createdAt: now,
    updatedAt: now,
  };
}
