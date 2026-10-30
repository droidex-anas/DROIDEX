import { useEffect, useMemo, useRef } from 'react';
import { shallowEqual, useStoreDispatch, useStoreSelector } from '../../hooks/useStore';
import { useChildStreamSnapshots } from '../../hooks/useChildStreamSnapshots';
import { useSessionLive } from '../../hooks/useSessionLive';
import { isWorkingAgent, spawnedChildSessions } from '../../lib/childSessions';
import { loadChildHistory, watchChildHistory } from '../../lib/commands';
import { transcriptRehydrationLimit } from '../../lib/transcriptStoreMemory';
import type { TranscriptEvent } from '../../types/bridge';
import type { UtilityTab } from '../../lib/utilityPanel';
import { AgentPaneBody } from './AgentPaneBody';

const EMPTY_TRANSCRIPT: TranscriptEvent[] = [];
const AGENT_HISTORY_PAGE_EVENTS = 240;

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
      connection: current.connection,
      session,
      transcript: session ? current.transcripts[session.appSessionId] : undefined,
      childSessions: session ? current.childSessions[session.appSessionId] : undefined,
      childHistory: session ? current.childHistory[session.appSessionId] : undefined,
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
  const agentsWorking = childSessions.some((child) => isWorkingAgent(child, working));
  const snapshots = useChildStreamSnapshots(childSessions, transcript, session?.interruptReason);
  const openAgent = childSessions.find((child) => child.childSessionId === tab.agentId);
  const parentAppSessionId = session?.appSessionId;
  const childSessionId = openAgent?.childSessionId;
  const history = childSessionId ? state.childHistory?.[childSessionId] : undefined;
  const transcriptAvailable = openAgent?.transcriptAvailable;
  // Covers effect replay until the store records the request as loading.
  const requestedHistory = useRef<{
    parentAppSessionId: string;
    childSessionId: string;
  } | null>(null);
  useEffect(() => {
    if (
      !parentAppSessionId ||
      !childSessionId ||
      !transcriptAvailable ||
      history?.isLoaded ||
      history?.status === 'failed' ||
      history?.status === 'loading'
    ) {
      requestedHistory.current = null;
      return;
    }
    if (
      requestedHistory.current?.parentAppSessionId === parentAppSessionId &&
      requestedHistory.current.childSessionId === childSessionId
    )
      return;
    requestedHistory.current = { parentAppSessionId, childSessionId };
    dispatch({ type: 'CHILD_HISTORY_LOADING', parentAppSessionId, childSessionId });
    loadChildHistory(
      parentAppSessionId,
      childSessionId,
      undefined,
      transcriptRehydrationLimit(history),
    );
  }, [parentAppSessionId, childSessionId, transcriptAvailable, history, dispatch]);

  useEffect(() => {
    if (
      state.connection !== 'connected' ||
      !parentAppSessionId ||
      !childSessionId ||
      !transcriptAvailable
    )
      return;
    const requestId = crypto.randomUUID();
    if (
      !watchChildHistory(requestId, {
        parentAppSessionId,
        childSessionId,
        limit: AGENT_HISTORY_PAGE_EVENTS,
      })
    )
      return;
    return () => {
      watchChildHistory(requestId, null);
    };
  }, [state.connection, parentAppSessionId, childSessionId, transcriptAvailable]);

  const retryHistory = () => {
    if (!parentAppSessionId || !childSessionId) return;
    dispatch({ type: 'CHILD_HISTORY_LOADING', parentAppSessionId, childSessionId });
    loadChildHistory(parentAppSessionId, childSessionId);
  };

  const loadEarlier = () => {
    if (!parentAppSessionId || !childSessionId || !history?.olderCursor || history.isLoadingOlder)
      return;
    dispatch({ type: 'CHILD_HISTORY_LOADING_OLDER', parentAppSessionId, childSessionId });
    loadChildHistory(
      parentAppSessionId,
      childSessionId,
      history.olderCursor,
      AGENT_HISTORY_PAGE_EVENTS,
    );
  };

  const showAgent = (agentId: string | null) => {
    dispatch({ type: 'UPDATE_UTILITY_TAB', tabId: tab.id, agentId });
  };

  if (childSessions.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-body text-muted">
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
        history={history}
        onRetryHistory={retryHistory}
        onLoadEarlier={loadEarlier}
        live={working || agentsWorking}
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
