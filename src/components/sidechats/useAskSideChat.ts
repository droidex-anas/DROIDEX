import { useCallback } from 'react';
import { useStoreApi, useStoreDispatch, type AppState } from '../../hooks/useStore';
import { forkSession, newClientRef, sendToSession } from '../../lib/commands';
import { isChatHidden } from '../../lib/chatMetadata';
import { sessionIsLive } from '../../lib/sessions';
import {
  MAX_RUNNING_SIDE_CHATS,
  currentSideChat,
  isSideChatOf,
  sideChatPanel,
  sideChatSettings,
  sideChatTitle,
} from '../../lib/sideChats';
import { toast } from '../../lib/toast';

export function isSideChatStarting(state: AppState, sourceAppSessionId: string): boolean {
  return Object.values(state.pendingForks).some(
    (fork) => fork?.kind === 'side' && fork.sourceAppSessionId === sourceAppSessionId,
  );
}

// Side chats of a session that are running or still being made. A closed one
// is deleted and its runtime is closing, so it no longer takes a slot.
export function runningSideChatCount(state: AppState, sourceAppSessionId: string): number {
  const running = Object.values(state.sessions).filter(
    (session) =>
      isSideChatOf(session, sourceAppSessionId) &&
      sessionIsLive(session) &&
      !isChatHidden(state.chatMetadata[session.appSessionId]),
  ).length;
  return running + (isSideChatStarting(state, sourceAppSessionId) ? 1 : 0);
}

// Asks the session's side chat a question: a follow-up in the one it has, or
// the first message of a new one branched on the harness the side-chat
// composer picked. Returns whether the question went out, so a composer knows
// to clear.
export function useAskSideChat(): (sourceAppSessionId: string, prompt: string) => boolean {
  const dispatch = useStoreDispatch();
  const store = useStoreApi();
  return useCallback(
    (sourceAppSessionId: string, prompt: string) => {
      const state = store.getState();
      const question = prompt.trim();
      if (!Object.hasOwn(state.sessions, sourceAppSessionId) || !question) return false;
      const source = state.sessions[sourceAppSessionId];
      const current = currentSideChat(state.sessions, state.chatMetadata, sourceAppSessionId);
      const showCurrent = () => {
        dispatch({ type: 'SHOW_SIDE_CHAT', sourceAppSessionId, view: { kind: 'current' } });
      };
      const panel = sideChatPanel(state.sideChats, sourceAppSessionId);
      // Asking again before the first side chat arrives would fork a second one.
      if (isSideChatStarting(state, sourceAppSessionId)) {
        dispatch({ type: 'SHOW_SIDE_CHAT', sourceAppSessionId, view: panel.view });
        toast.info('The side chat is still starting. Ask again when it opens.');
        return false;
      }
      if (current && sessionIsLive(current)) {
        showCurrent();
        toast.info('The side chat is still answering. Ask again when it finishes.');
        return false;
      }
      if (runningSideChatCount(state, sourceAppSessionId) >= MAX_RUNNING_SIDE_CHATS) {
        toast.error(
          `${String(MAX_RUNNING_SIDE_CHATS)} side chats are already running. Wait for one to finish.`,
        );
        return false;
      }
      if (current) {
        if (!sendToSideChat(dispatch, current.appSessionId, question)) return false;
        showCurrent();
        return true;
      }
      const settings = sideChatSettings(source, panel.harness, state.harnessModels);
      const clientRef = newClientRef();
      try {
        forkSession({
          clientRef,
          appSessionId: sourceAppSessionId,
          lineage: 'side',
          title: sideChatTitle(question),
          prompt: question,
          ...settings,
        });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Could not start a side chat.');
        return false;
      }
      dispatch({
        type: 'FORK_REQUESTED',
        clientRef,
        fork: { kind: 'side', sourceAppSessionId, prompt: question },
      });
      dispatch({
        type: 'SHOW_SIDE_CHAT',
        sourceAppSessionId,
        view: { kind: 'starting', clientRef, prompt: question },
      });
      return true;
    },
    [dispatch, store],
  );
}

// The backend never echoes a sent prompt, so the side chat shows it right away.
export function sendToSideChat(
  dispatch: ReturnType<typeof useStoreDispatch>,
  appSessionId: string,
  text: string,
): boolean {
  const message = text.trim();
  try {
    sendToSession(appSessionId, message);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Could not send to this side chat.');
    return false;
  }
  dispatch({
    type: 'SESSION_TRANSCRIPT',
    event: {
      id: `local-${String(Date.now())}`,
      appSessionId,
      sourceSessionId: 'user',
      role: 'primary',
      ts: Date.now(),
      kind: 'text',
      text: message,
      author: 'user',
    },
  });
  return true;
}
