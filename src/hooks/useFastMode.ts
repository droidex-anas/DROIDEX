import { useCallback } from 'react';
import { useStoreDispatch, useStoreSelector } from './useStore';
import { updateSessionSettings } from '../lib/commands';

/**
 * A chat's fast mode and the one way to change it: a live session shows the
 * change at once and holds it until the sidecar settles the request, the way a
 * model change is held; an unsent draft keeps the choice in the store until
 * `session.create` carries it.
 */
export default function useFastMode(appSessionId: string | undefined): {
  fastMode: boolean;
  setFastMode: (next: boolean) => void;
} {
  const dispatch = useStoreDispatch();
  const fastMode = useStoreSelector((current) => {
    const session = appSessionId ? current.sessions[appSessionId] : undefined;
    if (!session) return current.draftFastMode;
    const pending = current.pendingModelUpdates[session.appSessionId]?.settings.fastMode;
    return pending ?? session.fastMode ?? false;
  });
  const setFastMode = useCallback(
    (next: boolean) => {
      if (appSessionId) {
        const requestId = crypto.randomUUID();
        dispatch({
          type: 'MODEL_UPDATE_REQUESTED',
          appSessionId,
          requestId,
          settings: { fastMode: next },
        });
        updateSessionSettings({ appSessionId, requestId, fastMode: next });
        return;
      }
      dispatch({ type: 'SET_DRAFT_FAST_MODE', fastMode: next });
    },
    [appSessionId, dispatch],
  );
  return { fastMode, setFastMode };
}
