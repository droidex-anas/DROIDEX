import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useStoreSelector } from '../../hooks/useStore';

/* Where the context panel is pointed. Rows in the transcript and above the
   composer open an agent there, and the panel itself renders it, so the three
   share this one owner. View state only: an agent belongs to the session that
   was showing, so a session switch returns the panel to Context. */

export type AgentPaneTab = 'context' | 'subagents';

interface AgentPaneValue {
  tab: AgentPaneTab;
  // Which agent the Subagents tab is showing; null is its list.
  openAgentId: string | null;
  showTab: (tab: AgentPaneTab) => void;
  openAgent: (childSessionId: string) => void;
  closeAgent: () => void;
}

interface AgentPaneState {
  tab: AgentPaneTab;
  openAgentId: string | null;
}

const CONTEXT_PANE: AgentPaneState = { tab: 'context', openAgentId: null };

const AgentPaneContext = createContext<AgentPaneValue | null>(null);

export function AgentPaneProvider({ children }: { children: ReactNode }) {
  const appSessionId = useStoreSelector((state) => state.activeAppSessionId);
  const [pane, setPane] = useState<AgentPaneState>(CONTEXT_PANE);
  const [paneSession, setPaneSession] = useState(appSessionId);
  if (paneSession !== appSessionId) {
    setPaneSession(appSessionId);
    setPane(CONTEXT_PANE);
  }

  const showTab = useCallback((tab: AgentPaneTab) => {
    setPane((current) => ({ ...current, tab }));
  }, []);
  const openAgent = useCallback((childSessionId: string) => {
    setPane({ tab: 'subagents', openAgentId: childSessionId });
  }, []);
  const closeAgent = useCallback(() => {
    setPane((current) => ({ ...current, openAgentId: null }));
  }, []);

  const value = useMemo<AgentPaneValue>(
    () => ({ ...pane, showTab, openAgent, closeAgent }),
    [pane, showTab, openAgent, closeAgent],
  );
  return <AgentPaneContext.Provider value={value}>{children}</AgentPaneContext.Provider>;
}

export function useAgentPane(): AgentPaneValue {
  const value = useContext(AgentPaneContext);
  if (!value) throw new Error('useAgentPane requires AgentPaneProvider');
  return value;
}
