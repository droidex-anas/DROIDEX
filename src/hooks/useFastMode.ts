import { useCallback } from 'react';
import { useStoreDispatch, useStoreSelector } from './useStore';
import { updateSessionSettings } from '../lib/commands';

/**
 * A chat's fast mode and the one way to change it: a live session takes a
 * settings update (echoed at once so the control does not lag the click), an
 * unsent draft keeps the choice in the store until `session.create` carries it.
 */
export default function useFastMode(appSessionId: string | undefined): {
  fastMode: boolean;
  setFastMode: (next: boolean) => void;
} {
  const dispatch = useStoreDispatch();
  const fastMode = useStoreSelector((current) => {
    const session = appSessionId ? current.sessions[appSessionId] : undefined;
    return session ? (session.fastMode ?? false) : current.draftFastMode;
  });
  const setFastMode = useCallback(
    (next: boolean) => {
      if (appSessionId) {
        dispatch({ type: 'SESSION_SETTINGS_CHANGED', appSessionId, settings: { fastMode: next } });
        updateSessionSettings({ appSessionId, fastMode: next });
        return;
      }
      dispatch({ type: 'SET_DRAFT_FAST_MODE', fastMode: next });
    },
    [appSessionId, dispatch],
  );
  return { fastMode, setFastMode };
}
