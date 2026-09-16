import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

/* Where the context panel is pointed. Rows in the transcript and above the
   composer open an agent there, and the panel itself renders it, so the three
   share this one owner. View state only: the provider is keyed by the active
   session, so switching sessions returns the panel to Context. */

export type AgentPaneTab = 'context' | 'subagents';

interface AgentPaneValue {
  tab: AgentPaneTab;
  // Which agent the Subagents tab is showing; null is its list.
  openAgentId: string | null;
  showTab: (tab: AgentPaneTab) => void;
  openAgent: (childSessionId: string) => void;
  closeAgent: () => void;
}

const AgentPaneContext = createContext<AgentPaneValue | null>(null);

export function AgentPaneProvider({ children }: { children: ReactNode }) {
  const [tab, setTab] = useState<AgentPaneTab>('context');
  const [openAgentId, setOpenAgentId] = useState<string | null>(null);

  const showTab = useCallback((next: AgentPaneTab) => {
    setTab(next);
  }, []);
  const openAgent = useCallback((childSessionId: string) => {
    setTab('subagents');
    setOpenAgentId(childSessionId);
  }, []);
  const closeAgent = useCallback(() => {
    setOpenAgentId(null);
  }, []);

  const value = useMemo<AgentPaneValue>(
    () => ({ tab, openAgentId, showTab, openAgent, closeAgent }),
    [tab, openAgentId, showTab, openAgent, closeAgent],
  );
  return <AgentPaneContext.Provider value={value}>{children}</AgentPaneContext.Provider>;
}

export function useAgentPane(): AgentPaneValue {
  const value = useContext(AgentPaneContext);
  if (!value) throw new Error('useAgentPane requires AgentPaneProvider');
  return value;
}
