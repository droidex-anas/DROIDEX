import type {
  ChildSessionSummary,
  ModelInfo,
  ProviderKind,
  TranscriptEvent,
} from '../../types/bridge';
import { useReducedMotion } from 'framer-motion';
import { findChildSessionForTarget } from '../../lib/childSessions';
import type { ChildStreamSnapshot } from '../../lib/childSessionStream';
import type { ToolActivitySettings } from '../../lib/toolActivity';
import { PaneTransition } from '../../features/projects/PaneTransition';
import { AgentPaneDetail } from './AgentPaneDetail';
import { AgentPaneList } from './AgentPaneList';
import { useAgentWave } from './useAgentWave';

/* The Subagents tab. One level deep: the session's agents, and the agent the
   user picked. Never a tab per agent — the tab strip stays two entries wide.

   Going in and coming back is a lateral move: PaneTransition slides the two
   views past each other in the direction the back arrow implies. */

export function AgentPaneBody({
  childSessions,
  models,
  snapshots,
  transcript,
  provider,
  live,
  toolActivity,
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
  toolActivity: ToolActivitySettings;
  openAgentId: string | null;
  onOpenAgent: (childSessionId: string) => void;
  onBack: () => void;
  expanded: boolean;
  onToggleExpanded: () => void;
}) {
  const reduceMotion = useReducedMotion() === true;
  const wave = useAgentWave({ sessions: childSessions, models, live, snapshots });
  const open = wave.rows.find((row) => row.key === openAgentId);

  return (
    <PaneTransition open={Boolean(open)} reduceMotion={reduceMotion} viewKey={open?.key}>
      {open ? (
        <AgentPaneDetail
          row={open}
          models={models}
          transcript={transcript}
          live={live}
          toolActivity={toolActivity}
          onBack={onBack}
          onOpenNested={(target) => {
            const nested = findChildSessionForTarget(childSessions, target);
            if (nested) onOpenAgent(nested.childSessionId);
          }}
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
    </PaneTransition>
  );
}
