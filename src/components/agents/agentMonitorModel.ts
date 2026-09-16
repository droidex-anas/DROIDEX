import type { ChildSessionSummary, ChildStatus, ModelInfo } from '../../types/bridge';
import {
  childSessionKey,
  childSessionLabel,
  orderedChildSessions,
  type ChildSessionActivity,
  type ChildSessionTarget,
} from '../../lib/childSessions';
import {
  childStreamPhaseLabel,
  childStreamSnapshot,
  type ChildStreamSnapshot,
} from '../../lib/childSessionStream';
import { providerOf, type Provider } from '../ModelIcon';

/* The row model behind the agent monitor card, its docked line, and the agent
   pane. Every harness reaches these surfaces through ChildSessionSummary, so
   nothing here may branch on a provider. */

export interface AgentRow {
  // The child's own identity. A workflow phase and a delegated role can share
  // one spawn tool-use id, so the spawn link cannot key a row.
  key: string;
  child: ChildSessionSummary;
  status: ChildStatus;
  queued: boolean;
  startedAt?: number;
  snapshot: ChildStreamSnapshot;
  target?: ChildSessionTarget;
  provider: Provider;
  // The model doing the work names the row; the agent's own name leads its
  // description, which is where a delegated child's role belongs.
  name: string;
  agentName: string;
  description: string;
  phase?: string;
}

export type AgentStatusCounts = Record<ChildStatus, number> & { queued: number };

// Live states first, then the two terminal ones. A failed agent never merges
// into Done: the wave stopped working on it, but it did not deliver.
export const AGENT_STATUS_ORDER: readonly ChildStatus[] = [
  'running',
  'paused',
  'pending',
  'failed',
  'completed',
];

export const AGENT_STATUS_LABEL: Record<ChildStatus | 'queued', string> = {
  running: 'Running',
  paused: 'Awaiting approval',
  pending: 'Awaiting status',
  failed: 'Failed',
  completed: 'Done',
  queued: 'Queued',
};

// Terminal: the agent stopped and nothing more will arrive for it, so its timer
// freezes and the wave counts it as accounted for.
export function isSettledAgentStatus(status: ChildStatus): boolean {
  return status === 'completed' || status === 'failed';
}

export function buildAgentRows(
  sessions: readonly ChildSessionSummary[],
  models: readonly ModelInfo[],
  activity?: (target: ChildSessionTarget) => ChildSessionActivity | undefined,
  snapshots?: ReadonlyMap<string, ChildStreamSnapshot>,
): AgentRow[] {
  return orderedChildSessions(sessions).map((child, index) => {
    const target = agentRowTarget(child);
    const resolved = target ? activity?.(target) : undefined;
    const snapshot = snapshots?.get(childSessionKey(child)) ?? childStreamSnapshot(child, resolved);
    const model = models.find((entry) => entry.id === child.modelId);
    const agentName = childSessionLabel(child, index);
    const name = model?.displayName ?? (child.modelId || agentName);
    return {
      key: child.childSessionId,
      child,
      // State-only: the sidecar's child status is the authority. The spawning
      // tool's result says the launch was accepted, never that the agent is done.
      status: child.status,
      queued: Boolean(child.queued),
      startedAt: child.startedAt ?? resolved?.startedAt,
      snapshot,
      provider: providerOf(model, child.modelId),
      name,
      agentName,
      description: agentRowDescription(child, snapshot, agentName === name ? '' : agentName),
      ...(target !== undefined ? { target } : {}),
      ...(child.phase !== undefined ? { phase: child.phase } : {}),
    };
  });
}

function agentRowTarget(child: ChildSessionSummary): ChildSessionTarget | undefined {
  if (child.spawnLink?.kind !== 'tool-use') return undefined;
  return {
    toolUseId: child.spawnLink.id,
    ...(child.label !== undefined ? { label: child.label } : {}),
  };
}

// What the agent is doing, led by the agent's own name so a delegated child
// reads "reviewer · checking the sidecar diff". The live step wins; before any
// activity arrives the task it was given stands in. Neither repeats the status
// pill beside it.
function agentRowDescription(
  child: ChildSessionSummary,
  snapshot: ChildStreamSnapshot,
  lead: string,
): string {
  const phaseLabel = childStreamPhaseLabel(snapshot.phase, snapshot.fidelity);
  const step = snapshot.step === phaseLabel ? '' : snapshot.step;
  const body = step || firstLine(child.prompt);
  return [lead, body].filter(Boolean).join(' · ');
}

function firstLine(text: string | undefined): string {
  return text?.trim().split('\n')[0] ?? '';
}

export function countAgentStatuses(rows: readonly AgentRow[]): AgentStatusCounts {
  const counts: AgentStatusCounts = {
    pending: 0,
    running: 0,
    paused: 0,
    completed: 0,
    failed: 0,
    queued: 0,
  };
  for (const row of rows) {
    if (row.queued) counts.queued += 1;
    else counts[row.status] += 1;
  }
  return counts;
}

// Progress is what the wave has accounted for, not what it delivered: a failed
// agent is no longer pending, so the bar must not stall on it.
export function agentWaveProgress(counts: AgentStatusCounts, total: number): number {
  return total > 0 ? (counts.completed + counts.failed) / total : 0;
}

// The workflow a wave belongs to names the card; a plain wave is just "Agents".
export function agentMonitorTitle(rows: readonly AgentRow[]): string {
  return rows.find((row) => row.child.group)?.child.group ?? 'Agents';
}

interface AgentPhaseSection {
  phase?: string;
  rows: AgentRow[];
}

// Workflow rows group under their phase, in the order the phases first appear.
// A wave with no phases stays one unlabelled section.
function agentPhaseSections(rows: readonly AgentRow[]): AgentPhaseSection[] {
  if (!rows.some((row) => row.phase)) return [{ rows: [...rows] }];
  const sections: AgentPhaseSection[] = [];
  for (const row of rows) {
    const last = sections.at(-1);
    if (last && last.phase === row.phase) last.rows.push(row);
    else sections.push({ ...(row.phase !== undefined ? { phase: row.phase } : {}), rows: [row] });
  }
  return sections;
}

export interface AgentListSection {
  key: string;
  label: string;
  rows: AgentRow[];
}

// One structure per run, never a third: a workflow groups by the phases it
// named, and everything else — a plain wave, a delegation — splits into what is
// working and what has finished.
export function agentListSections(rows: readonly AgentRow[]): AgentListSection[] {
  if (rows.some((row) => row.phase)) {
    return agentPhaseSections(rows).map((section) => ({
      key: section.phase ?? 'agents',
      label: section.phase ?? 'Agents',
      rows: section.rows,
    }));
  }
  const active = rows.filter((row) => !isSettledAgentStatus(row.status));
  const done = rows.filter((row) => isSettledAgentStatus(row.status));
  return [
    ...(active.length > 0 ? [{ key: 'active', label: 'Active', rows: active }] : []),
    ...(done.length > 0 ? [{ key: 'done', label: 'Done', rows: done }] : []),
  ];
}

// A turn spawns its agents together, so the docked line groups them by start
// time: a quiet stretch means the next spawn belongs to a later run. Only the
// newest run is docked, and only while something in it is still unsettled — the
// transcript keeps every run, including this one once it settles.
const AGENT_RUN_GAP_MS = 15_000;

export function currentAgentRun(
  children: readonly ChildSessionSummary[],
): readonly ChildSessionSummary[] {
  const ordered = [...children].sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
  let start = ordered.length - 1;
  while (start > 0) {
    const gap = (ordered[start].startedAt ?? 0) - (ordered[start - 1].startedAt ?? 0);
    if (gap > AGENT_RUN_GAP_MS) break;
    start -= 1;
  }
  const run = ordered.slice(Math.max(0, start));
  return run.some((child) => !isSettledAgentStatus(child.status)) ? run : [];
}

// Elapsed for the wave: it only starts once one agent is confirmed running, and
// it freezes at the last settlement instead of counting past the run.
export function agentWaveTimeMs(input: {
  firstStartedAt: number | undefined;
  lastSettledAt: number | undefined;
  inFlight: boolean;
  hasConfirmedRunning: boolean;
  now: number;
}): number | undefined {
  if (input.firstStartedAt == null || (input.inFlight && !input.hasConfirmedRunning)) {
    return undefined;
  }
  if (input.inFlight) return Math.max(0, input.now - input.firstStartedAt);
  if (input.lastSettledAt == null) return undefined;
  return Math.max(0, input.lastSettledAt - input.firstStartedAt);
}

// The quiet line on the right of the header strip.
export function agentMonitorMeta(input: {
  counts: AgentStatusCounts;
  total: number;
  inFlight: boolean;
}): string {
  const { counts, total } = input;
  const plural = total === 1 ? 'agent' : 'agents';
  if (counts.failed > 0 && counts.completed + counts.failed === total) {
    return `${String(counts.failed)} of ${String(total)} ${plural} failed`;
  }
  if (counts.completed === total) return `All ${String(total)} ${plural} finished`;
  if (input.inFlight && counts.running === 0 && counts.queued > 0) {
    return `${String(counts.queued)} ${counts.queued === 1 ? 'agent' : 'agents'} queued`;
  }
  if (input.inFlight && counts.running === 0 && counts.pending > 0) {
    return `Awaiting status for ${String(counts.pending)} ${counts.pending === 1 ? 'agent' : 'agents'}`;
  }
  return `${String(counts.completed)} of ${String(total)} ${plural} finished`;
}

// Agent lifecycle as the transcript tells it: one quiet sentence for the whole
// wave rather than a row per agent. Derived from the children's own statuses —
// there is no lifecycle event on the wire to render instead.
const LIFECYCLE_NAME_LIMIT = 3;

function foldAgentNames(names: readonly string[]): string {
  const shown = names.slice(0, LIFECYCLE_NAME_LIMIT);
  const rest = names.length - shown.length;
  if (rest > 0) return `${shown.join(', ')} and ${String(rest)} more`;
  if (shown.length <= 1) return shown[0] ?? '';
  return `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
}

export interface AgentLifecycleLines {
  started?: string;
  finished?: string;
}

export function agentLifecycleLines(rows: readonly AgentRow[]): AgentLifecycleLines {
  if (rows.length === 0) return {};
  const started = rows.filter((row) => !row.queued && row.status !== 'pending');
  const settled = rows.filter((row) => isSettledAgentStatus(row.status));
  const group = rows.find((row) => row.child.group)?.child.group;
  return {
    ...(started.length > 0
      ? { started: `${foldAgentNames(started.map((row) => row.agentName))} started working` }
      : {}),
    ...(settled.length === rows.length
      ? { finished: `${group ?? foldAgentNames(rows.map((row) => row.agentName))} finished` }
      : {}),
  };
}
