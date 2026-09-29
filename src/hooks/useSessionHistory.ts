import { useEffect, useRef } from 'react';
import { shallowEqual, useStoreDispatch, useStoreSelector } from './useStore';
import { loadSessionHistory } from '../lib/commands';
import { transcriptRehydrationLimit } from '../lib/transcriptStoreMemory';

// Loads a shown session's stored transcript once, and again after memory
// pressure released it. Null shows nothing and loads nothing.
export function useSessionHistory(appSessionId: string | null): void {
  const dispatch = useStoreDispatch();
  const { loaded, restore } = useStoreSelector(
    (state) => ({
      loaded: appSessionId ? state.historyLoaded[appSessionId] : false,
      restore: appSessionId ? state.sessionRestore[appSessionId] : undefined,
    }),
    shallowEqual,
  );
  const requested = useRef(new Set<string>());

  useEffect(() => {
    if (!appSessionId) return;
    if (loaded || restore?.status === 'failed') {
      requested.current.delete(appSessionId);
      return;
    }
    if (restore?.status === 'loading' || requested.current.has(appSessionId)) return;
    requested.current.add(appSessionId);
    dispatch({ type: 'SESSION_RESTORE_START', appSessionId });
    loadSessionHistory(appSessionId, undefined, transcriptRehydrationLimit(restore));
  }, [appSessionId, loaded, restore, dispatch]);
}
