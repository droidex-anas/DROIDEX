import type {
  ChildSessionSummary,
  ModelInfo,
  ProviderKind,
  TranscriptEvent,
} from '../../types/bridge';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import type { ChildStreamSnapshot } from '../../lib/childSessionStream';
import { INLINE_CARD_DURATION_S, INLINE_CARD_EASE } from '../inlineCardMotion';
import { AgentPaneDetail } from './AgentPaneDetail';
import { AgentPaneList } from './AgentPaneList';
import { useAgentWave } from './useAgentWave';

/* The Subagents tab. One level deep: the session's agents, and the agent the
   user picked. Never a tab per agent — the tab strip stays two entries wide.

   Going in and coming back is a lateral move, so the two views slide past each
   other in the direction the back arrow implies. Reduced motion keeps the swap
   but drops the travel. */

export function AgentPaneBody({
  childSessions,
  models,
  snapshots,
  transcript,
  provider,
  live,
  openAgentId,
  onOpenAgent,
  onBack,
  expanded,
  onToggleExpanded,
}: {
  childSessions: readonly ChildSessionSummary[];
  models: readonly ModelInfo[];
  snapshots: ReadonlyMap<string, ChildStreamSnapshot>;
  transcript: readonly TranscriptEvent[];
  provider?: ProviderKind;
  live: boolean;
  openAgentId: string | null;
  onOpenAgent: (childSessionId: string) => void;
  onBack: () => void;
  expanded: boolean;
  onToggleExpanded: () => void;
}) {
  const reduceMotion = useReducedMotion() === true;
  const wave = useAgentWave({ sessions: childSessions, models, live, snapshots });
  const open = wave.rows.find((row) => row.key === openAgentId);
  const travel = reduceMotion ? 0 : 12;

  return (
    <AnimatePresence initial={false} mode="wait">
      <motion.div
        key={open ? `detail:${open.key}` : 'list'}
        initial={{ opacity: 0, x: open ? travel : -travel }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: open ? -travel : travel }}
        transition={{
          duration: reduceMotion ? 0 : INLINE_CARD_DURATION_S,
          ...(reduceMotion ? {} : { ease: INLINE_CARD_EASE }),
        }}
        className="flex min-h-0 flex-1 flex-col"
      >
        {open ? (
          <AgentPaneDetail
            row={open}
            models={models}
            transcript={transcript}
            live={live}
            onBack={onBack}
            expanded={expanded}
            onToggleExpanded={onToggleExpanded}
            {...(provider !== undefined ? { provider } : {})}
          />
        ) : (
          <AgentPaneList
            rows={wave.rows}
            elapsedMs={wave.elapsedMs}
            now={wave.now}
            onOpenAgent={onOpenAgent}
            expanded={expanded}
            onToggleExpanded={onToggleExpanded}
          />
        )}
      </motion.div>
    </AnimatePresence>
  );
}
