import { useEffect, useState } from 'react';
import type { ChildSessionSummary, ModelInfo } from '../../types/bridge';
import type { ChildSessionActivity, ChildSessionTarget } from '../../lib/childSessions';
import type { ChildStreamSnapshot } from '../../lib/childSessionStream';
import {
  agentWaveProgress,
  agentWaveTimeMs,
  buildAgentRows,
  countAgentStatuses,
  isSettledAgentStatus,
  type AgentRow,
  type AgentStatusCounts,
} from './agentMonitorModel';
import { useDocumentVisible } from '../../hooks/useDocumentVisible';

export interface AgentWave {
  rows: AgentRow[];
  counts: AgentStatusCounts;
  // Row key → elapsed, frozen at the moment the row settled.
  elapsedMs: ReadonlyMap<string, number>;
  progress: number;
  timeMs?: number;
  // Something in this wave is still expected to report back.
  inFlight: boolean;
  // The clock the row timers were read against, so callers that render "x ago"
  // resolve it against the same instant the elapsed values used.
  now: number;
}

// Everything the monitor card and its docked line show about one wave. Both
// surfaces derive it from the same rows, so they can never disagree about how
// many agents are running or how long the wave has taken.
export function useAgentWave(input: {
  sessions: readonly ChildSessionSummary[];
  models: readonly ModelInfo[];
  live: boolean;
  activity?: (target: ChildSessionTarget) => ChildSessionActivity | undefined;
  snapshots?: ReadonlyMap<string, ChildStreamSnapshot>;
}): AgentWave {
  const rows = buildAgentRows(input.sessions, input.models, input.activity, input.snapshots);
  const counts = countAgentStatuses(rows);
  // An agent awaiting approval has run and will again: the wave is still open
  // and its clock still counts.
  const hasConfirmedRunning = counts.running + counts.paused > 0;
  const now = useNow(input.live && hasConfirmedRunning);
  const elapsedMs = useAgentRowElapsed(rows, now, input.live);
  const inFlight =
    input.live && counts.running + counts.paused + counts.pending + counts.queued > 0;
  const started = rows.map((row) => row.startedAt).filter((at): at is number => at != null);
  const lastSettledAt = rows.reduce<number | undefined>((last, row) => {
    const elapsed = elapsedMs.get(row.key);
    if (row.startedAt == null || elapsed == null) return last;
    const settledAt = row.startedAt + elapsed;
    return last == null || settledAt > last ? settledAt : last;
  }, undefined);
  const timeMs = agentWaveTimeMs({
    firstStartedAt: started.length > 0 ? Math.min(...started) : undefined,
    lastSettledAt,
    inFlight,
    hasConfirmedRunning,
    now,
  });
  return {
    rows,
    counts,
    elapsedMs,
    progress: agentWaveProgress(counts, rows.length),
    ...(timeMs !== undefined ? { timeMs } : {}),
    inFlight,
    now,
  };
}

// One second tick, and only while something is actually running in a visible
// window: a settled wave must never keep the app rendering once a second.
function useNow(active: boolean): number {
  const visible = useDocumentVisible();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active || !visible) return;
    setNow(Date.now());
    const id = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(id);
    };
  }, [active, visible]);
  return now;
}

// A row that stops running freezes at the moment it settled, so reopening the
// transcript later shows what the agent took, not how long ago it ran. A row
// never observed running has no honest duration to report at all.
function useAgentRowElapsed(
  rows: readonly AgentRow[],
  now: number,
  live: boolean,
): ReadonlyMap<string, number> {
  const [observed, setObserved] = useState<ReadonlyMap<string, number | undefined>>(
    () => new Map(),
  );
  useEffect(() => {
    setObserved((previous) => {
      let next: Map<string, number | undefined> | undefined;
      for (const row of rows) {
        const ticking =
          live && !row.queued && !isSettledAgentStatus(row.status) && row.status !== 'pending';
        if (ticking) {
          if (!previous.has(row.key)) (next ??= new Map(previous)).set(row.key, undefined);
        } else if (
          previous.has(row.key) &&
          previous.get(row.key) == null &&
          row.startedAt != null
        ) {
          (next ??= new Map(previous)).set(row.key, Math.max(0, Date.now() - row.startedAt));
        }
      }
      return next ?? previous;
    });
  }, [rows, live]);

  const elapsed = new Map<string, number>();
  for (const row of rows) {
    if (row.startedAt == null || row.queued || row.status === 'pending') continue;
    if (isSettledAgentStatus(row.status) || !live) {
      const frozen = observed.get(row.key);
      if (observed.has(row.key)) elapsed.set(row.key, frozen ?? Math.max(0, now - row.startedAt));
      continue;
    }
    if (row.status === 'running' || row.status === 'paused')
      elapsed.set(row.key, Math.max(0, now - row.startedAt));
  }
  return elapsed;
}
