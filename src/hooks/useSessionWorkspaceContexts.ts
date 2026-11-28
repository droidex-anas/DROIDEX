import { useMemo } from 'react';
import {
  sessionWorkspaceContext,
  type SessionWorkspaceContext,
  type WorkspaceScope,
} from '../lib/workspaces';

// Stable object identity matters because every sidebar row memoizes on its
// context prop; recompute only when the workspace scopes themselves change.
export function useSessionWorkspaceContexts(
  workspaceScopes: readonly WorkspaceScope[],
): (cwd: string) => SessionWorkspaceContext {
  return useMemo(() => {
    const cache = new Map<string, SessionWorkspaceContext>();
    return (cwd: string) => {
      const cached = cache.get(cwd);
      if (cached) return cached;
      const context = sessionWorkspaceContext(cwd, workspaceScopes);
      cache.set(cwd, context);
      return context;
    };
  }, [workspaceScopes]);
}
