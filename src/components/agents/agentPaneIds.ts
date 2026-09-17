import type { AgentPaneTab } from './AgentPane';

/* The ARIA pairing between the context panel's tabs and their bodies. One
   context panel exists at a time, so the ids can be plain. */

export function agentPaneTabProps(tab: AgentPaneTab) {
  return { id: `agent-pane-tab-${tab}`, 'aria-controls': `agent-pane-panel-${tab}` } as const;
}

export function agentPanePanelProps(tab: AgentPaneTab) {
  return {
    role: 'tabpanel',
    id: `agent-pane-panel-${tab}`,
    'aria-labelledby': `agent-pane-tab-${tab}`,
  } as const;
}
