import { useCallback } from 'react';
import { useStoreApi, useStoreDispatch, useStoreSelector } from './useStore';
import { forkSession, newClientRef } from '../lib/commands';
import { toast } from '../lib/toast';

// Copies a settled chat, whole or through the answer at `forkPointId`, into a
// new top-level chat that opens once the sidecar answers. Failures come back as
// `session.create_failed` and are toasted there.
export function useForkChat(): (appSessionId: string, title: string, forkPointId?: string) => void {
  const dispatch = useStoreDispatch();
  return useCallback(
    (appSessionId: string, title: string, forkPointId?: string) => {
      const clientRef = newClientRef();
      try {
        forkSession({
          clientRef,
          appSessionId,
          lineage: 'fork',
          title,
          ...(forkPointId ? { forkPointId } : {}),
        });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Could not fork this chat.');
        return;
      }
      dispatch({
        type: 'FORK_REQUESTED',
        clientRef,
        fork: { kind: 'fork', sourceAppSessionId: appSessionId },
      });
    },
    [dispatch],
  );
}

// Opens the chat a fork was copied from. A fork of a side chat opens that side
// chat beside its own source, since side chats never take over the chat.
export function useOpenForkSource(): (sourceAppSessionId: string) => void {
  const dispatch = useStoreDispatch();
  const store = useStoreApi();
  return useCallback(
    (sourceAppSessionId: string) => {
      const { sessions } = store.getState();
      const source = Object.hasOwn(sessions, sourceAppSessionId)
        ? sessions[sourceAppSessionId]
        : undefined;
      if (!source) {
        toast.error('The chat this was forked from no longer exists.');
        return;
      }
      if (source.lineage?.kind !== 'side') {
        dispatch({ type: 'SET_ACTIVE_SESSION', id: sourceAppSessionId });
        return;
      }
      const mainAppSessionId = source.lineage.sourceAppSessionId;
      dispatch({ type: 'SET_ACTIVE_SESSION', id: mainAppSessionId });
      dispatch({
        type: 'SHOW_SIDE_CHAT',
        sourceAppSessionId: mainAppSessionId,
        view: { kind: 'chat', appSessionId: sourceAppSessionId },
      });
    },
    [dispatch, store],
  );
}

export function useForkPending(appSessionId: string | undefined): boolean {
  return useStoreSelector((state) =>
    Object.values(state.pendingForks).some(
      (fork) => fork?.kind === 'fork' && fork.sourceAppSessionId === appSessionId,
    ),
  );
}
