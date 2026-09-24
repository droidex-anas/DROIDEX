import { useId, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import type { ChildSessionSummary, ModelInfo, ProviderKind } from '../../types/bridge';
import type { ChildSessionActivity, ChildSessionTarget } from '../../lib/childSessions';
import type { ChildStreamSnapshot } from '../../lib/childSessionStream';
import { AgentSummaryLine } from './AgentSummaryLine';
import { agentDisclosureMotion, AgentRowList, foldedAgentRows } from './AgentRowList';
import { AgentLifecycleLine } from './AgentLifecycleLine';
import { agentLifecycleLines, agentMonitorMeta, agentMonitorTitle } from './agentMonitorModel';
import { useAgentWave } from './useAgentWave';

/* The agent monitor: one card for a turn's agents, whichever harness ran them.
   Collapsed it is a header strip over a summary line; expanding glides the
   summary's count pills into the rows they stand for and staggers the rows in
   behind them. A quiet lifecycle line brackets the card — what started, and
   what finished — derived from the children's statuses, because the wire
   carries no lifecycle event to render instead. MessageFeed only renders the
   card when the caller passes its data, so Mission Control keeps its per-spawn
   lines. */

export interface AgentMonitorData {
  sessions: ChildSessionSummary[];
  models: ModelInfo[];
  snapshots?: ReadonlyMap<string, ChildStreamSnapshot>;
  // The session's harness, which names its own top reasoning level.
  provider?: ProviderKind;
}

export function AgentMonitorCard({
  sessions,
  models,
  snapshots,
  provider,
  live = false,
  onOpen,
  activity,
}: AgentMonitorData & {
  // True only while this wave's turn is still streaming. It gates every ticking
  // clock: once the turn ends (or the user stops it) the card must stop counting
  // instead of accruing time forever against a run nobody is watching.
  live?: boolean;
  onOpen?: (child: ChildSessionSummary) => void;
  activity?: (target: ChildSessionTarget) => ChildSessionActivity | undefined;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showAllRows, setShowAllRows] = useState(false);
  const reduceMotion = useReducedMotion() === true;
  const bodyId = useId();
  const morphId = useId();
  const wave = useAgentWave({
    sessions,
    models,
    live,
    ...(activity !== undefined ? { activity } : {}),
    ...(snapshots !== undefined ? { snapshots } : {}),
  });

  if (wave.rows.length === 0) return null;

  // A running wave is open: the card exists to show what the agents are doing.
  const showRows = expanded || wave.inFlight;
  const visibleRows = foldedAgentRows(wave.rows, showAllRows);
  const lifecycle = agentLifecycleLines(wave.rows);

  return (
    <div className="space-y-2">
      {lifecycle.started ? <AgentLifecycleLine rows={wave.rows} text={lifecycle.started} /> : null}
      <div
        data-testid="agent-monitor-card"
        onKeyDown={(event) => {
          if (event.key === 'Escape') setExpanded(false);
        }}
        className="w-full overflow-hidden rounded-[20px] border border-droid-border bg-droid-surface shadow-droid transition-colors hover:border-droid-border-hover"
      >
        <button
          type="button"
          onClick={() => {
            setExpanded((value) => !value);
          }}
          aria-expanded={showRows}
          aria-controls={bodyId}
          className="block w-full text-left"
        >
          <span className="flex items-center justify-between gap-3 bg-droid-elevated/50 px-4 py-2.5">
            <span className="truncate text-[13px] font-medium text-droid-text-secondary">
              {agentMonitorTitle(wave.rows)}
            </span>
            <span className="shrink-0 truncate text-[12px] text-droid-text-muted">
              {agentMonitorMeta({
                counts: wave.counts,
                total: wave.rows.length,
                inFlight: wave.inFlight,
              })}
            </span>
          </span>
          <AgentSummaryLine
            wave={wave}
            showCounts={!showRows}
            className="px-4 pb-3 pt-2.5"
            {...(reduceMotion ? {} : { morphId })}
          />
        </button>
        <AnimatePresence initial={false}>
          {showRows ? (
            <motion.div
              key="rows"
              id={bodyId}
              {...agentDisclosureMotion(reduceMotion)}
              className="overflow-hidden"
            >
              <AgentRowList
                rows={visibleRows}
                elapsedMs={wave.elapsedMs}
                reduceMotion={reduceMotion}
                foldedCount={wave.rows.length - visibleRows.length}
                onShowAll={() => {
                  setShowAllRows(true);
                }}
                {...(provider !== undefined ? { provider } : {})}
                {...(reduceMotion ? {} : { morphId })}
                {...(onOpen !== undefined ? { onOpen } : {})}
              />
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
      {lifecycle.finished ? (
        <AgentLifecycleLine rows={wave.rows} text={lifecycle.finished} />
      ) : null}
    </div>
  );
}
