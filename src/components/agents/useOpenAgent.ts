import { useCallback } from 'react';
import { useStoreDispatch } from '../../hooks/useStore';

/* Every agent row, wherever it sits, opens the agent in the utility panel's
   agents pane: the pane opens if it is closed and points at that agent. */
export function useOpenAgent(): (childSessionId: string) => void {
  const dispatch = useStoreDispatch();
  return useCallback(
    (childSessionId: string) => {
      dispatch({ type: 'OPEN_UTILITY_TOOL', tool: 'agents', agentId: childSessionId });
    },
    [dispatch],
  );
}
