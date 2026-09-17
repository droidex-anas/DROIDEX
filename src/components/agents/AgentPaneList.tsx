import { useState } from 'react';
import { LayoutGroup, motion, useReducedMotion } from 'framer-motion';
import { isPendingChildPlaceholder } from '../../lib/childSessions';
import { formatRelativeTime } from '../../lib/time';
import { formatDuration } from '../../lib/tools';
import { AgentAvatar } from '../AgentAvatar';
import { INLINE_CARD_DURATION_S, INLINE_CARD_EASE } from '../inlineCardMotion';
import { AgentPaneExpand } from './AgentPaneExpand';
import { agentListSections, isSettledAgentStatus, type AgentRow } from './agentMonitorModel';

/* The Subagents tab's list. A workflow groups its rows under its own phases;
   anything else splits into Active and Done. An active row carries what the
   agent is doing and its live timer; a finished one only says how long ago it
   stopped, because that is all anyone scans it for.

   A row keeps one shared layout identity across the groups, so an agent that
   finishes slides from Active to Done instead of blinking out of one list and
   into the other. */

const SECTION_VISIBLE_LIMIT = 10;

export function AgentPaneList({
  rows,
  elapsedMs,
  now,
  onOpenAgent,
  expanded,
  onToggleExpanded,
}: {
  rows: readonly AgentRow[];
  elapsedMs: ReadonlyMap<string, number>;
  now: number;
  onOpenAgent: (childSessionId: string) => void;
  expanded: boolean;
  onToggleExpanded: () => void;
}) {
  const [expandedSections, setExpandedSections] = useState<ReadonlySet<string>>(() => new Set());
  const reduceMotion = useReducedMotion() === true;
  const sections = agentListSections(rows);

  return (
    <div
      data-testid="agent-pane-list"
      className="relative min-h-0 flex-1 overflow-y-auto px-2 pb-3"
    >
      {/* Shares the first group's label row, so the list spends no row on it. */}
      <div className="absolute right-2 top-3 z-10">
        <AgentPaneExpand expanded={expanded} onToggle={onToggleExpanded} />
      </div>
      <LayoutGroup>
        {sections.map((section) => {
          const showAll = expandedSections.has(section.key);
          const visible = showAll ? section.rows : section.rows.slice(0, SECTION_VISIBLE_LIMIT);
          const hidden = section.rows.length - visible.length;
          return (
            <div key={section.key}>
              {section.label ? (
                <motion.div
                  layout={!reduceMotion}
                  className="px-3 pb-1.5 pt-5 text-[13px] font-medium text-droid-text-muted"
                >
                  {section.label} · {section.rows.length}
                </motion.div>
              ) : null}
              {section.rows.length === 0 ? (
                <div className="px-3 py-2 text-[13px] text-droid-text-muted">
                  No active subagents
                </div>
              ) : null}
              {visible.map((row) => (
                <AgentListRow
                  key={row.key}
                  row={row}
                  reduceMotion={reduceMotion}
                  trailing={
                    isSettledAgentStatus(row.status)
                      ? finishedAgo(row, elapsedMs, now)
                      : elapsedLabel(row, elapsedMs)
                  }
                  {...(isSettledAgentStatus(row.status) ? {} : { detail: activeDetail(row) })}
                  onOpen={onOpenAgent}
                />
              ))}
              {hidden > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    setExpandedSections((current) => new Set(current).add(section.key));
                  }}
                  className="w-full rounded-xl px-3 py-2 text-left text-[13px] text-droid-text-muted transition-colors hover:text-droid-text-secondary"
                >
                  Show {hidden} more
                </button>
              ) : null}
            </div>
          );
        })}
      </LayoutGroup>
    </div>
  );
}

function AgentListRow({
  row,
  detail,
  trailing,
  reduceMotion,
  onOpen,
}: {
  row: AgentRow;
  detail?: string;
  trailing: string;
  reduceMotion: boolean;
  onOpen: (childSessionId: string) => void;
}) {
  const running = row.status === 'running' && !row.queued;
  return (
    <motion.button
      type="button"
      layout={!reduceMotion}
      layoutId={reduceMotion ? undefined : `agent-list:${row.key}`}
      transition={{ duration: INLINE_CARD_DURATION_S, ease: INLINE_CARD_EASE }}
      data-testid="agent-pane-row"
      data-child-session-id={row.child.childSessionId}
      disabled={isPendingChildPlaceholder(row.child)}
      onClick={() => {
        onOpen(row.child.childSessionId);
      }}
      title={row.agentName}
      className="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-droid-elevated/50 disabled:cursor-default disabled:hover:bg-transparent"
    >
      {/* One harness runs every agent of a chat, so its mark would say nothing
          here: each agent carries its own creature, the one the context panel
          already gives it. */}
      <AgentAvatar seed={row.key} size={20} working={running} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[14px] font-medium leading-5 text-droid-text">
          {row.agentName}
        </span>
        {detail ? (
          <span
            className={`truncate text-[12px] leading-4 ${
              running ? 'shimmer-text font-medium' : 'text-droid-text-muted'
            }`}
          >
            {detail}
          </span>
        ) : null}
      </span>
      <span className="shrink-0 text-[12px] tabular-nums text-droid-text-muted">{trailing}</span>
    </motion.button>
  );
}

// What the agent is doing: its live step, or the plain state when it has none.
function activeDetail(row: AgentRow): string {
  if (row.queued) return 'Queued';
  if (row.status === 'paused') return 'Awaiting approval';
  if (row.status === 'pending') return 'Awaiting status';
  return row.snapshot.step || 'Working';
}

function elapsedLabel(row: AgentRow, elapsedMs: ReadonlyMap<string, number>): string {
  const ms = elapsedMs.get(row.key);
  return ms != null ? formatDuration(ms) : '';
}

// When the agent ran. Exact for an agent this window saw finish; otherwise its
// start stands in, which at the scale this reads at ("18h ago") is the same answer.
function finishedAgo(row: AgentRow, elapsedMs: ReadonlyMap<string, number>, now: number): string {
  if (row.startedAt == null) return '';
  const relative = formatRelativeTime(row.startedAt + (elapsedMs.get(row.key) ?? 0), now);
  return relative === 'now' ? 'just now' : `${relative} ago`;
}
