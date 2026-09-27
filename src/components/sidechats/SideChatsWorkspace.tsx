import { ExternalLink } from '@droidex/icons';
import { useStoreDispatch } from '../../hooks/useStore';
import { AgentPaneExpand } from '../agents/AgentPaneExpand';
import { SideChatHeaderButton } from './SideChatHeader';
import { SideChatPane } from './SideChatPane';

/* Side chats docked in the utility pane. They can pop out into a window over
   the chat, or take the whole content row like an open agent. */

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
  return (
    <div data-testid="side-chats-workspace" className="flex h-full min-h-0 flex-col">
      <SideChatPane
        sourceAppSessionId={sourceAppSessionId}
        wide={expanded}
        controls={
          <>
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
