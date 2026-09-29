import { ChevronDown, ExternalLink } from '@droidex/icons';
import { useStoreDispatch, useStoreSelector } from '../../hooks/useStore';
import { utilityPanelForSession } from '../../lib/utilityPanel';
import { AgentPaneExpand } from '../agents/AgentPaneExpand';
import { SideChatHeaderButton } from './SideChatHeader';
import { SideChatPane } from './SideChatPane';

/* The side chat docked in the utility pane. It can pop out into a window over
   the chat, take the whole content row like an open agent, or be minimized to
   the pill above the composer, which docks it again. */

export function SideChatsWorkspace({
  sourceAppSessionId,
  expanded,
  onToggleExpanded,
}: {
  sourceAppSessionId: string;
  expanded: boolean;
  onToggleExpanded: () => void;
}) {
  const dispatch = useStoreDispatch();
  const sideTabId = useStoreSelector(
    (current) =>
      utilityPanelForSession(current.utilityPanels, sourceAppSessionId).tabs.find(
        (tab) => tab.tool === 'side',
      )?.id,
  );
  return (
    <div data-testid="side-chats-workspace" className="flex h-full min-h-0 flex-col">
      <SideChatPane
        key={sourceAppSessionId}
        sourceAppSessionId={sourceAppSessionId}
        wide={expanded}
        controls={
          <>
            <SideChatHeaderButton
              label="Minimize"
              disabled={!sideTabId}
              onClick={() => {
                if (!sideTabId) return;
                if (expanded) onToggleExpanded();
                dispatch({
                  type: 'CLOSE_UTILITY_TAB',
                  tabId: sideTabId,
                  appSessionId: sourceAppSessionId,
                });
              }}
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </SideChatHeaderButton>
            <SideChatHeaderButton
              label="Pop out"
              onClick={() => {
                if (expanded) onToggleExpanded();
                dispatch({ type: 'PLACE_SIDE_CHATS', sourceAppSessionId, placement: 'floating' });
              }}
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </SideChatHeaderButton>
            <AgentPaneExpand expanded={expanded} onToggle={onToggleExpanded} />
          </>
        }
      />
    </div>
  );
}
