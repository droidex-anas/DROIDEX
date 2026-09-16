import { useId, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import type { ChildSessionSummary, ModelInfo, ProviderKind } from '../../types/bridge';
import { agentDisclosureMotion, AgentRowList, foldedAgentRows } from '../agents/AgentRowList';
import { inlineCardMotion } from '../inlineCardMotion';
import { AgentSummaryLine } from '../agents/AgentSummaryLine';
import { agentMonitorTitle } from '../agents/agentMonitorModel';
import { useAgentWave } from '../agents/useAgentWave';

/* The monitor's collapsed line, docked under the plan steps while the wave
   runs. Clicking expands the same rows in place; Esc collapses it. It leaves
   with the wave — the transcript card keeps the final state. */

export function AgentDockLine({
  sessions,
  models,
  provider,
  expanded,
  onExpandedChange,
  onOpen,
}: {
  sessions: readonly ChildSessionSummary[];
  models: readonly ModelInfo[];
  provider?: ProviderKind;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onOpen?: (child: ChildSessionSummary) => void;
}) {
  const [showAllRows, setShowAllRows] = useState(false);
  const reduceMotion = useReducedMotion() === true;
  const bodyId = useId();
  const morphId = useId();
  const wave = useAgentWave({ sessions, models, live: true });
  const visibleRows = foldedAgentRows(wave.rows, showAllRows);

  return (
    <motion.div
      key="agent-dock-line"
      {...inlineCardMotion(reduceMotion)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onExpandedChange(false);
      }}
      data-testid="agent-dock-line"
      className="relative z-0 mx-[3%] -mb-3 min-w-0 overflow-hidden rounded-t-2xl border border-droid-border bg-droid-surface pb-4"
    >
      <button
        type="button"
        onClick={() => {
          onExpandedChange(!expanded);
        }}
        aria-expanded={expanded}
        aria-controls={bodyId}
        className="block w-full text-left transition-colors hover:bg-droid-active/40"
      >
        <span className="flex items-center gap-2 px-4 py-2">
          <span className="shrink-0 text-[12px] font-medium text-droid-text-secondary">
            {agentMonitorTitle(wave.rows)}
          </span>
          <AgentSummaryLine
            wave={wave}
            showCounts={!expanded}
            className="min-w-0 flex-1"
            {...(reduceMotion ? {} : { morphId })}
          />
        </span>
      </button>
      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.div
            key="rows"
            id={bodyId}
            {...agentDisclosureMotion(reduceMotion)}
            className="max-h-[min(40vh,320px)] overflow-y-auto"
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
    </motion.div>
  );
}
