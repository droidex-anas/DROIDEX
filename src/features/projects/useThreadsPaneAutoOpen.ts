import { useEffect, useRef } from 'react';
import { shallowEqual, useStoreDispatch, useStoreSelector } from '../../hooks/useStore';
import { projectForSession } from '../../lib/projectThreads';

/* The Threads panel earns its place the moment a chat has threads to show, so
   it opens itself then — once per chat. Closing it is the user's decision and
   is never undone here, and an empty bench never takes the space. */

export function useThreadsPaneAutoOpen(): void {
  const dispatch = useStoreDispatch();
  const state = useStoreSelector(
    (current) => ({
      appSessionId: current.activeAppSessionId,
      threadCount:
        projectForSession(current.projects, current.activeAppSessionId)?.threads.length ?? 0,
    }),
    shallowEqual,
  );
  const opened = useRef<Set<string>>(new Set());

  useEffect(() => {
    const { appSessionId, threadCount } = state;
    // One thread is the project's own chat; a second is work worth showing.
    if (!appSessionId || threadCount < 2) return;
    if (opened.current.has(appSessionId)) return;
    opened.current.add(appSessionId);
    dispatch({ type: 'OPEN_UTILITY_TOOL', tool: 'threads' });
  }, [state, dispatch]);
}
