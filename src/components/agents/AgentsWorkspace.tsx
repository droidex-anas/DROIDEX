import { useMemo } from 'react';
import { shallowEqual, useStoreDispatch, useStoreSelector } from '../../hooks/useStore';
import { useChildStreamSnapshots } from '../../hooks/useChildStreamSnapshots';
import { useSessionLive } from '../../hooks/useSessionLive';
import { childSessionIsLive, spawnedChildSessions } from '../../lib/childSessions';
import type { TranscriptEvent } from '../../types/bridge';
import type { UtilityTab } from '../../lib/utilityPanel';
import { AgentPaneBody } from './AgentPaneBody';

const EMPTY_TRANSCRIPT: TranscriptEvent[] = [];

/* The agents pane of the utility panel: the agent a row opened, with a way back
   to the session's other agents. The open agent rides on the pane's tab, so it
   belongs to the session and survives switching tools. An agent is read here and
   only here: its transcript never takes over the chat. */

export function AgentsWorkspace({
  tab,
  expanded,
  onToggleExpanded,
}: {
  tab: UtilityTab;
  expanded: boolean;
  onToggleExpanded: () => void;
}) {
  const dispatch = useStoreDispatch();
  const state = useStoreSelector((current) => {
    const session = current.activeAppSessionId
      ? current.sessions[current.activeAppSessionId]
      : undefined;
    return {
      session,
      transcript: session ? current.transcripts[session.appSessionId] : undefined,
      childSessions: session ? current.childSessions[session.appSessionId] : undefined,
      childRuntime: session ? current.childRuntime[session.appSessionId] : undefined,
      models: current.models,
      toolActivity: current.toolActivity,
    };
  }, shallowEqual);
  const { session } = state;
  const transcript = state.transcript ?? EMPTY_TRANSCRIPT;
  const working = useSessionLive(session?.appSessionId ?? null);

  // Derived from the spawn events the same way the transcript's card is, so the
  // pane lists a new agent at the moment the card does.
  const childSessions = useMemo(() => {
    if (!session) return [];
    return spawnedChildSessions(transcript, Object.values(state.childSessions ?? {}));
  }, [session, transcript, state.childSessions]);
  const childSessionsRunning = childSessions.some((child) =>
    childSessionIsLive(child, state.childRuntime?.[child.childSessionId]),
  );
  const snapshots = useChildStreamSnapshots(childSessions, transcript, session?.interruptReason);

  const showAgent = (agentId: string | null) => {
    dispatch({ type: 'UPDATE_UTILITY_TAB', tabId: tab.id, agentId });
  };

  if (childSessions.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-[12px] text-droid-text-muted">
        This chat has not started any agents.
      </div>
    );
  }

  return (
    <div data-testid="agents-workspace" className="flex h-full min-h-0 flex-col">
      <AgentPaneBody
        childSessions={childSessions}
        models={state.models}
        snapshots={snapshots}
        transcript={transcript}
        live={working || childSessionsRunning}
        toolActivity={state.toolActivity}
        openAgentId={tab.agentId ?? null}
        onOpenAgent={showAgent}
        onBack={() => {
          showAgent(null);
        }}
        expanded={expanded}
        onToggleExpanded={onToggleExpanded}
        {...(session ? { provider: session.provider } : {})}
      />
    </div>
  );
}
