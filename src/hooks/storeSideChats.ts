import { deleteChat } from '../lib/chatMetadata';
import {
  currentSideChat,
  sideChatPanel,
  updateSideChatPanel,
  type SideChatHarness,
  type SideChatPlacement,
  type SideChatView,
} from '../lib/sideChats';
import { removeUtilityTool, utilityPanelForSession } from '../lib/utilityPanel';
import type { SideChatDefaultPlacement } from './persistedUiPreferences';
import { reduceUtilityPanels } from './storeUtilityPanels';
import type { AppState } from './useStore';

export type SideChatAction =
  // Shows a view of a session's side chats and brings their surface forward.
  | { type: 'SHOW_SIDE_CHAT'; sourceAppSessionId: string; view: SideChatView }
  | { type: 'PLACE_SIDE_CHATS'; sourceAppSessionId: string; placement: SideChatPlacement }
  // Takes the side chat off screen; a side chat it names is deleted for good.
  | { type: 'CLOSE_SIDE_CHAT'; sourceAppSessionId: string; appSessionId?: string }
  | { type: 'CHOOSE_SIDE_CHAT_HARNESS'; sourceAppSessionId: string; harness: SideChatHarness }
  | { type: 'ATTACH_SIDE_CHAT_REPLY'; sourceAppSessionId: string; reply: string }
  | { type: 'DETACH_SIDE_CHAT_REPLIES'; sourceAppSessionId: string; replies: readonly string[] }
  | { type: 'SET_SIDE_CHAT_DEFAULT_PLACEMENT'; placement: SideChatDefaultPlacement };

export function reduceSideChats(state: AppState, action: SideChatAction): AppState {
  switch (action.type) {
    case 'SHOW_SIDE_CHAT': {
      const { sourceAppSessionId } = action;
      const next: AppState = {
        ...state,
        sideChats: updateSideChatPanel(state.sideChats, sourceAppSessionId, { view: action.view }),
      };
      return placeSideChats(
        next,
        sourceAppSessionId,
        sideChatPlacementToShow(state, sourceAppSessionId),
      );
    }

    case 'PLACE_SIDE_CHATS':
      return placeSideChats(state, action.sourceAppSessionId, action.placement);

    // A closed side chat rests docked with no tab, which is off screen; the
    // next `/side` opens it where Settings says.
    case 'CLOSE_SIDE_CHAT': {
      const { sourceAppSessionId, appSessionId } = action;
      const chatMetadata = appSessionId
        ? deleteChat(state.chatMetadata, appSessionId, Date.now())
        : null;
      return {
        ...state,
        chatMetadata: chatMetadata ?? state.chatMetadata,
        sideChats: updateSideChatPanel(state.sideChats, sourceAppSessionId, {
          view: { kind: 'current' },
          placement: 'docked',
        }),
        utilityPanels: {
          ...state.utilityPanels,
          [sourceAppSessionId]: removeUtilityTool(state.utilityPanels[sourceAppSessionId], 'side'),
        },
      };
    }

    case 'SET_SIDE_CHAT_DEFAULT_PLACEMENT':
      return {
        ...state,
        sideChatDefaultPlacement: action.placement,
      };

    case 'CHOOSE_SIDE_CHAT_HARNESS':
      return {
        ...state,
        sideChats: updateSideChatPanel(state.sideChats, action.sourceAppSessionId, {
          harness: action.harness,
        }),
      };

    case 'ATTACH_SIDE_CHAT_REPLY': {
      const { attachedReplies = [] } = sideChatPanel(state.sideChats, action.sourceAppSessionId);
      if (attachedReplies.includes(action.reply)) return state;
      return {
        ...state,
        sideChats: updateSideChatPanel(state.sideChats, action.sourceAppSessionId, {
          attachedReplies: [...attachedReplies, action.reply],
        }),
      };
    }

    case 'DETACH_SIDE_CHAT_REPLIES': {
      const attachedReplies = state.sideChats[action.sourceAppSessionId]?.attachedReplies;
      if (!attachedReplies) return state;
      // Only the sent replies go; one attached while the prompt was in flight stays.
      const remaining = attachedReplies.filter((reply) => !action.replies.includes(reply));
      return {
        ...state,
        sideChats: updateSideChatPanel(state.sideChats, action.sourceAppSessionId, {
          attachedReplies: remaining.length > 0 ? remaining : undefined,
        }),
      };
    }
  }
}

// Docking moves the side chats into the utility pane; floating or minimizing
// takes them out of it, so they are never shown twice.
function placeSideChats(
  state: AppState,
  sourceAppSessionId: string,
  placement: SideChatPlacement,
): AppState {
  const next: AppState = {
    ...state,
    sideChats: updateSideChatPanel(state.sideChats, sourceAppSessionId, { placement }),
  };
  if (placement === 'docked') {
    if (sourceAppSessionId !== state.activeAppSessionId) return next;
    return reduceUtilityPanels(next, { type: 'OPEN_UTILITY_TOOL', tool: 'side' });
  }
  return {
    ...next,
    utilityPanels: {
      ...state.utilityPanels,
      [sourceAppSessionId]: removeUtilityTool(state.utilityPanels[sourceAppSessionId], 'side'),
    },
  };
}

// A minimized side chat floats again and one on screen or still open stays put.
// Only a side chat that is not open yet, docked with no tab and no chat behind
// it, opens where Settings says.
function sideChatPlacementToShow(state: AppState, sourceAppSessionId: string): SideChatPlacement {
  const { placement } = sideChatPanel(state.sideChats, sourceAppSessionId);
  if (placement !== 'docked') return 'floating';
  const hasTab = utilityPanelForSession(state.utilityPanels, sourceAppSessionId).tabs.some(
    (tab) => tab.tool === 'side',
  );
  if (hasTab || currentSideChat(state.sessions, state.chatMetadata, sourceAppSessionId)) {
    return 'docked';
  }
  return state.sideChatDefaultPlacement;
}
