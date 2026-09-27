import { useCallback } from 'react';
import { useStoreApi, useStoreDispatch, type AppState } from '../../hooks/useStore';
import { forkSession, newClientRef } from '../../lib/commands';
import { sessionIsLive } from '../../lib/sessions';
import {
  MAX_RUNNING_SIDE_CHATS,
  isSideChatOf,
  sideChatPanel,
  sideChatSettings,
  sideChatTitle,
} from '../../lib/sideChats';
import { toast } from '../../lib/toast';

// Side chats of a session that are running or still being made.
export function runningSideChatCount(state: AppState, sourceAppSessionId: string): number {
  const running = Object.values(state.sessions).filter(
    (session) => isSideChatOf(session, sourceAppSessionId) && sessionIsLive(session),
  ).length;
  const starting = Object.values(state.pendingForks).filter(
    (fork) => fork?.kind === 'side' && fork.sourceAppSessionId === sourceAppSessionId,
  ).length;
  return running + starting;
}

// Branches a side chat off a session with its first question, on the harness
// the side-chat composer picked. The panel shows it starting until the sidecar
// answers. Returns whether the request went out, so a composer knows to clear.
export function useStartSideChat(): (sourceAppSessionId: string, prompt: string) => boolean {
  const dispatch = useStoreDispatch();
  const store = useStoreApi();
  return useCallback(
    (sourceAppSessionId: string, prompt: string) => {
      const state = store.getState();
      const question = prompt.trim();
      if (!Object.hasOwn(state.sessions, sourceAppSessionId) || !question) return false;
      const source = state.sessions[sourceAppSessionId];
      if (runningSideChatCount(state, sourceAppSessionId) >= MAX_RUNNING_SIDE_CHATS) {
        toast.error(
          `${String(MAX_RUNNING_SIDE_CHATS)} side chats are already running. Wait for one to finish.`,
        );
        return false;
      }
      const { harness } = sideChatPanel(state.sideChats, sourceAppSessionId);
      const settings = sideChatSettings(source, harness, state.harnessModels);
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
