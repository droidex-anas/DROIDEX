import { useCallback, useEffect } from 'react';
import { listSessions } from '../lib/commands';
import type { WorkspaceScope } from '../lib/workspaces';
import { useStoreDispatch, useStoreSelector } from './useStore';

// Single owner of the sidebar's `sessions.list` request. The sidecar bounds how
// many pre-existing Droid sessions a freshly opened folder contributes, so the
// folders the user asked to see the rest of belong to the same request rather
// than a second, later list that would race this one.
export function useWorkspaceSessionList(
  scopes: readonly WorkspaceScope[],
  enabled: boolean,
): (executionCwds: readonly string[]) => void {
  const dispatch = useStoreDispatch();
  const revealEarlierCwds = useStoreSelector((current) => current.revealEarlierCwds);

  useEffect(() => {
    if (!enabled) return;
    const workspaceCwds = [...new Set(scopes.flatMap((scope) => scope.executionCwds))];
    listSessions({ workspaceCwds, includePlainChats: true, revealEarlierCwds });
  }, [enabled, scopes, revealEarlierCwds]);

  return useCallback(
    (executionCwds: readonly string[]) => {
      dispatch({ type: 'REVEAL_EARLIER_SESSIONS', executionCwds });
    },
    [dispatch],
  );
}
