import {
  systemBootedAt,
  type LiveChildIdentity,
  type LiveProcessIdentity,
  type LiveRuntimeJournal,
  type LiveSessionIdentity,
} from './liveRuntimeJournal.js';
import type { InterruptedSessionRecord, SessionPhase, SessionSummary } from './protocol.js';
import { errMsg } from './errors.js';
import { isProcessAlive } from './processes/isProcessAlive.js';
import type { RegisteredSession } from './SessionRegistry.js';
import { adoptedSessionFacts, retirableSessions } from './sessionRuntimeRetirement.js';

// Boot time is derived from uptime, which drifts by a little between reads.
const SAME_BOOT_TOLERANCE_MS = 60_000;
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
  lifecycle: { resume(id: string): Promise<RegisteredSession | undefined> };
  historyReady: () => Promise<void>;
  isShutdownStarted: () => boolean;
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

  // Another sidecar on this profile that is still running owns the journal: its
  // sessions and processes are live, so this one must not reap, adopt or
  // overwrite them. Checked on every write, so the journal is taken over once
  // that sidecar exits.
  private journalIsForeign(owner = this.dependencies.journal.read().owner): boolean {
    return (
      owner !== undefined &&
      owner.pid !== process.pid &&
      Math.abs(owner.bootedAt - systemBootedAt()) < SAME_BOOT_TOLERANCE_MS &&
      isProcessAlive(owner.pid)
    );
  }

  persistLiveSet(): void {
    if (this.journalIsForeign()) return;
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
      owner: { pid: process.pid, bootedAt: systemBootedAt() },
      sessions,
      children: [...this.dependencies.liveChildren()],
      processes: this.dependencies.recordedProcesses(),
    });
  }

  private async adoptOnce(): Promise<SessionAdoptionResult> {
    const d = this.dependencies;
    const identities = d.journal.read();
    if (this.journalIsForeign(identities.owner)) {
      console.warn(
        `Another DROIDEX sidecar (pid ${String(identities.owner?.pid)}) is running on this profile; leaving its sessions alone.`,
      );
      return { interrupted: [] };
    }
    // Before anything is resurrected: a session that comes back must not
    // inherit a dev server from the run that died holding the port.
    await d.reapProcesses(identities.processes);
    if (d.isShutdownStarted()) return { interrupted: [] };
    await d.historyReady();
    if (d.isShutdownStarted()) return { interrupted: [] };
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
      if (d.isShutdownStarted()) return { interrupted: [...this.interrupted] };
    }
    for (const child of identities.children) this.markChildInterrupted(child);
    this.persistLiveSet();
    return { interrupted: [...this.interrupted] };
  }

  private async adoptSession(identity: LiveSessionIdentity): Promise<void> {
    if (this.dependencies.registry.getLive(identity.appSessionId)) return;
    const historical = this.dependencies.registry.getCanonicalSummary(identity.appSessionId);
    // Settled turns retain their phase; only the journal's streaming flag means unfinished work.
    const wasStreaming = identity.streaming;
    if (!historical) {
      await this.markSessionInterrupted(
        identity,
        undefined,
        wasStreaming,
        'Stored session metadata is unavailable. Restore its transcript or start a new chat.',
      );
      return;
    }
    try {
      const resumed = await this.dependencies.lifecycle.resume(identity.appSessionId);
      if (this.dependencies.isShutdownStarted()) return;
      if (!resumed) {
        if (this.dependencies.registry.getLive(identity.appSessionId)) return;
        await this.markSessionInterrupted(identity, historical, wasStreaming, SESSION_UNAVAILABLE);
        return;
      }
      if (!wasStreaming) return;
      if (this.dependencies.registry.getLive(identity.appSessionId) !== resumed) return;
      await this.markSessionInterrupted(
        identity,
        historical,
        true,
        'Send a message to resume.',
        resumed,
      );
    } catch (error) {
      if (this.dependencies.isShutdownStarted()) return;
      if (this.dependencies.registry.getLive(identity.appSessionId)) return;
      await this.markSessionInterrupted(
        identity,
        historical,
        wasStreaming,
        `${SESSION_UNAVAILABLE} (${errMsg(error)})`,
      );
    }
  }

  private async markSessionInterrupted(
    identity: LiveSessionIdentity,
    historical: SessionSummary | undefined,
    wasStreaming: boolean,
    reason: string,
    resumed?: RegisteredSession,
  ): Promise<void> {
    const prefix = wasStreaming ? TURN_INTERRUPTED : 'The agent runtime restarted.';
    const interruptReason = `${prefix} ${reason}`;
    const { registry } = this.dependencies;
    const live = registry.getLive(identity.appSessionId);
    if (live !== resumed) return;
    if (live) {
      registry.updateSummary(
        identity.appSessionId,
        interruption(live.summary, wasStreaming, interruptReason),
        { touchActivity: false },
      );
    } else if (historical) {
      const current = registry.getCanonicalSummary(identity.appSessionId);
      if (
        !current ||
        current.providerSessionId !== historical.providerSessionId ||
        current.provider !== historical.provider ||
        current.resumeId !== historical.resumeId
      )
        return;
      await this.dependencies.persistSummaries([
        { ...current, ...interruption(current, wasStreaming, interruptReason) },
      ]);
      if (this.dependencies.isShutdownStarted()) return;
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
  wasStreaming: boolean,
  reason: string,
): Pick<SessionSummary, 'streaming' | 'phase' | 'interruptReason'> {
  return {
    streaming: false,
    phase: wasStreaming ? interruptedPhase(summary.phase) : summary.phase,
    interruptReason: reason,
  };
}

function interruptedPhase(phase: SessionPhase): SessionPhase {
  if (phase === 'completed' || phase === 'failed' || phase === 'paused') return phase;
  return 'paused';
}
