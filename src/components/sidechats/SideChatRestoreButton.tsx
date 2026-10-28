import { MessageBubble } from '@droidex/icons';
import { shallowEqual, useStoreDispatch, useStoreSelector } from '../../hooks/useStore';
import { sessionIsLive } from '../../lib/sessions';
import { currentSideChat, sideChatPanel } from '../../lib/sideChats';
import { utilityPanelForSession } from '../../lib/utilityPanel';
import { HoverTooltip } from '../HoverTooltip';
import { isSideChatStarting } from './useAskSideChat';

/* A minimized side chat rests on its own row at the top of the composer stack,
   so the cards docked above the prompt push it up instead of sitting under it.
   It comes back where it was: a minimized window floats again, a docked one
   reopens its tab. A side chat still starting counts, and a docked one is on
   screen only while its tab is the active one. Nothing shows while the side
   chat is on screen or when the session has none. */

export function SideChatRestoreButton({ sourceAppSessionId }: { sourceAppSessionId: string }) {
  const dispatch = useStoreDispatch();
  const { hidden, placement, starting, working } = useStoreSelector((current) => {
    const sideChat = currentSideChat(current.sessions, current.chatMetadata, sourceAppSessionId);
    const starting = isSideChatStarting(current, sourceAppSessionId);
    const { placement } = sideChatPanel(current.sideChats, sourceAppSessionId);
    const pane = utilityPanelForSession(current.utilityPanels, sourceAppSessionId);
    const dockedOnScreen =
      pane.open && pane.tabs.some((tab) => tab.id === pane.activeTabId && tab.tool === 'side');
    return {
      hidden:
        (sideChat !== undefined || starting) &&
        (placement === 'minimized' || (placement === 'docked' && !dockedOnScreen)),
      placement,
      starting,
      working: sideChat !== undefined && sessionIsLive(sideChat),
    };
  }, shallowEqual);
  if (!hidden) return null;
  let label = 'Show side chat';
  if (starting) label = 'Side chat is starting. Show it';
  else if (working) label = 'Side chat is answering. Show it';

  return (
    <div className="mb-2 flex justify-end px-1">
      <HoverTooltip label={label}>
        <button
          type="button"
          aria-label={label}
          onClick={() => {
            dispatch({
              type: 'PLACE_SIDE_CHATS',
              sourceAppSessionId,
              placement: placement === 'minimized' ? 'floating' : 'docked',
            });
          }}
          className="flex items-center gap-1.5 rounded-full bg-droid-raised px-2.5 py-1 text-[11px] font-medium text-droid-text-secondary shadow-droid-sm transition-colors hover:bg-droid-elevated hover:text-droid-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-droid-accent/60"
        >
          <MessageBubble className={`h-3.5 w-3.5 ${starting || working ? 'animate-pulse' : ''}`} />
          Side chat
        </button>
      </HoverTooltip>
    </div>
  );
}
