export type UtilityTool = 'review' | 'terminal' | 'browser' | 'files' | 'agents' | 'threads';

export interface UtilityTab {
  id: string;
  tool: UtilityTool;
  label: string;
  terminalId?: string;
  cwd?: string;
  filePath?: string;
  // The agents pane: the agent it is showing, absent while it shows the list.
  agentId?: string;
  // The threads pane: the thread it is showing, absent while it shows the list.
  threadId?: string;
}

export interface UtilityPanelState {
  open: boolean;
  tabs: UtilityTab[];
  activeTabId: string | null;
}

export const CLOSED_UTILITY_PANEL: UtilityPanelState = {
  open: false,
  tabs: [],
  activeTabId: null,
};

const SINGLETON_TOOLS = new Set<UtilityTool>(['review', 'browser', 'files', 'agents', 'threads']);

// The tools whose pane can take the whole content row.
export function isExpandableTool(tool: UtilityTool | undefined): boolean {
  return tool === 'browser' || tool === 'agents' || tool === 'threads';
}

export function utilityPanelForSession(
  panels: Record<string, UtilityPanelState>,
  appSessionId: string | null | undefined,
): UtilityPanelState {
  if (!appSessionId) return CLOSED_UTILITY_PANEL;
  return appSessionId in panels ? panels[appSessionId] : CLOSED_UTILITY_PANEL;
}

export function openUtilityTool(
  panel: UtilityPanelState | undefined,
  tool: UtilityTool,
  createId: () => string,
  details: Partial<
    Pick<UtilityTab, 'terminalId' | 'cwd' | 'filePath' | 'agentId' | 'threadId'>
  > = {},
): UtilityPanelState {
  const current = panel ?? CLOSED_UTILITY_PANEL;
  const existing = SINGLETON_TOOLS.has(tool)
    ? current.tabs.find((tab) => tab.tool === tool)
    : undefined;
  if (existing) {
    // Opening another agent or thread points the one pane at it.
    const retarget =
      (details.agentId !== undefined && details.agentId !== existing.agentId) ||
      (details.threadId !== undefined && details.threadId !== existing.threadId);
    if (!retarget && current.open && current.activeTabId === existing.id) return current;
    return {
      ...current,
      open: true,
      activeTabId: existing.id,
      ...(retarget
        ? {
            tabs: current.tabs.map((tab) =>
              tab.id === existing.id
                ? {
                    ...tab,
                    ...(details.agentId === undefined ? {} : { agentId: details.agentId }),
                    ...(details.threadId === undefined ? {} : { threadId: details.threadId }),
                  }
                : tab,
            ),
          }
        : {}),
    };
  }
  const tab: UtilityTab = {
    id: createId(),
    tool,
    label: utilityToolLabel(tool, current.tabs),
    ...details,
  };
  return {
    open: true,
    tabs: [...current.tabs, tab],
    activeTabId: tab.id,
  };
}

export function closeUtilityTab(
  panel: UtilityPanelState | undefined,
  tabId: string,
): UtilityPanelState {
  const current = panel ?? CLOSED_UTILITY_PANEL;
  const index = current.tabs.findIndex((tab) => tab.id === tabId);
  if (index < 0) return current;
  const tabs = current.tabs.filter((tab) => tab.id !== tabId);
  if (current.activeTabId !== tabId) return { ...current, tabs };
  const fallback = tabs.length > 0 ? tabs[Math.min(index, tabs.length - 1)] : null;
  return {
    open: tabs.length > 0 && current.open,
    tabs,
    activeTabId: fallback?.id ?? null,
  };
}

export function activateUtilityTab(
  panel: UtilityPanelState | undefined,
  tabId: string,
): UtilityPanelState {
  const current = panel ?? CLOSED_UTILITY_PANEL;
  if (!current.tabs.some((tab) => tab.id === tabId)) return current;
  if (current.open && current.activeTabId === tabId) return current;
  return { ...current, open: true, activeTabId: tabId };
}

export function updateUtilityTab(
  panel: UtilityPanelState | undefined,
  tabId: string,
  details: Partial<Pick<UtilityTab, 'terminalId' | 'cwd' | 'filePath' | 'label'>> & {
    // null returns the agents pane to its list.
    agentId?: string | null;
    // null returns the threads pane to its list.
    threadId?: string | null;
  },
): UtilityPanelState {
  const current = panel ?? CLOSED_UTILITY_PANEL;
  const index = current.tabs.findIndex((tab) => tab.id === tabId);
  if (index < 0) return current;
  const tabs = [...current.tabs];
  const { agentId, threadId, ...rest } = details;
  const nextDetails = Object.fromEntries(
    Object.entries(rest as Record<string, unknown>).filter(([, value]) => value !== undefined),
  ) as Partial<UtilityTab>;
  const next = { ...tabs[index], ...nextDetails };
  if (agentId === null) delete next.agentId;
  else if (agentId !== undefined) next.agentId = agentId;
  if (threadId === null) delete next.threadId;
  else if (threadId !== undefined) next.threadId = threadId;
  tabs[index] = next;
  return { ...current, tabs };
}

export function setUtilityPanelOpen(
  panel: UtilityPanelState | undefined,
  open: boolean,
): UtilityPanelState {
  const current = panel ?? CLOSED_UTILITY_PANEL;
  if (!open) return current.open ? { ...current, open: false } : current;
  return {
    ...current,
    open: true,
    activeTabId: current.activeTabId ?? current.tabs.at(0)?.id ?? null,
  };
}

export function removeUtilityTool(
  panel: UtilityPanelState | undefined,
  tool: UtilityTool,
): UtilityPanelState {
  const current = panel ?? CLOSED_UTILITY_PANEL;
  const tab = current.tabs.find((candidate) => candidate.tool === tool);
  return tab ? closeUtilityTab(current, tab.id) : current;
}

export function removeSessionPanel(
  panels: Record<string, UtilityPanelState>,
  appSessionId: string,
): Record<string, UtilityPanelState> {
  if (!(appSessionId in panels)) return panels;
  return Object.fromEntries(Object.entries(panels).filter(([id]) => id !== appSessionId));
}

export function sanitizeUtilityPanels(value: unknown): Record<string, UtilityPanelState> {
  if (!isRecord(value)) return {};
  const panels: Record<string, UtilityPanelState> = {};
  for (const [appSessionId, rawPanel] of Object.entries(value)) {
    if (!appSessionId || !isRecord(rawPanel) || !Array.isArray(rawPanel.tabs)) continue;
    const seenIds = new Set<string>();
    const singletonTools = new Set<UtilityTool>();
    const tabs: UtilityTab[] = [];
    for (const rawTab of rawPanel.tabs.slice(0, 16)) {
      if (!isRecord(rawTab)) continue;
      const id = typeof rawTab.id === 'string' ? rawTab.id : '';
      const tool = isUtilityTool(rawTab.tool) ? rawTab.tool : null;
      if (!id || !tool || seenIds.has(id)) continue;
      if (!isRestoredTool(tool)) continue;
      if (SINGLETON_TOOLS.has(tool) && singletonTools.has(tool)) continue;
      seenIds.add(id);
      singletonTools.add(tool);
      const tab: UtilityTab = {
        id,
        tool,
        label:
          typeof rawTab.label === 'string' && rawTab.label.trim()
            ? rawTab.label.slice(0, 80)
            : utilityToolLabel(tool, tabs),
      };
      if (typeof rawTab.terminalId === 'string') tab.terminalId = rawTab.terminalId;
      if (typeof rawTab.filePath === 'string') tab.filePath = rawTab.filePath;
      tabs.push(tab);
    }
    const activeTabId =
      typeof rawPanel.activeTabId === 'string' &&
      tabs.some((tab) => tab.id === rawPanel.activeTabId)
        ? rawPanel.activeTabId
        : (tabs[0]?.id ?? null);
    panels[appSessionId] = {
      open: rawPanel.open === true && tabs.length > 0,
      tabs,
      activeTabId,
    };
  }
  return panels;
}

export function persistUtilityPanels(
  panels: Record<string, UtilityPanelState>,
): Record<string, UtilityPanelState> {
  return Object.fromEntries(
    Object.entries(panels).map(([appSessionId, panel]) => {
      const tabs = panel.tabs.filter((tab) => isRestoredTool(tab.tool));
      const activeTabId = tabs.some((tab) => tab.id === panel.activeTabId)
        ? panel.activeTabId
        : (tabs[0]?.id ?? null);
      return [
        appSessionId,
        {
          open: panel.open && tabs.length > 0,
          tabs,
          activeTabId,
        },
      ];
    }),
  );
}

export function utilityTerminalCwds(
  panels: Record<string, UtilityPanelState>,
  sessionCwds: Record<string, string | undefined>,
): string[] {
  return Object.entries(panels)
    .flatMap(([appSessionId, panel]) =>
      panel.tabs
        .filter((tab) => tab.tool === 'terminal')
        .map((tab) => tab.cwd ?? sessionCwds[appSessionId]),
    )
    .filter((cwd): cwd is string => Boolean(cwd));
}

// A terminal is a live process and an agents pane follows live work: neither
// is something a restart can bring back, so neither is stored or restored.
function isRestoredTool(tool: UtilityTool): boolean {
  return tool !== 'terminal' && tool !== 'agents';
}

function utilityToolLabel(tool: UtilityTool, tabs: UtilityTab[]): string {
  if (tool === 'agents') return 'Subagents';
  if (tool === 'threads') return 'Threads';
  if (tool !== 'terminal') return tool[0].toUpperCase() + tool.slice(1);
  const count = tabs.filter((tab) => tab.tool === 'terminal').length;
  return count === 0 ? 'Terminal' : `Terminal ${String(count + 1)}`;
}

function isUtilityTool(value: unknown): value is UtilityTool {
  return (
    value === 'review' ||
    value === 'terminal' ||
    value === 'browser' ||
    value === 'files' ||
    value === 'threads'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
