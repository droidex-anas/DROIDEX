import { useEffect, useRef, useState } from 'react';
import { getRepoStatus } from '../lib/desktop';
import type { RepoStatus } from '../lib/repoEnvironment';
import { stable } from '../lib/stable';
import { useDocumentVisible } from './useDocumentVisible';

function isCurrentRepoStatusRequest(requestId: number, latestRequestId: number): boolean {
  return requestId === latestRequestId;
}

export function useRepoStatus(cwd: string): RepoStatus | null | undefined {
  const visible = useDocumentVisible();
  const [status, setStatus] = useState<RepoStatus | null | undefined>(undefined);
  const statusCwdRef = useRef<string | null>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    const refresh = () => {
      // A full untracked-files scan on a large repo can outlive the cadence;
      // skip the tick rather than stacking another scan behind it.
      if (inFlight) return;
      inFlight = true;
      const requestId = ++requestRef.current;
      void getRepoStatus(cwd)
        .then((next) => {
          if (!cancelled && isCurrentRepoStatusRequest(requestId, requestRef.current))
            setStatus((previous) => stable(previous, next));
        })
        .finally(() => {
          inFlight = false;
        });
    };

    if (statusCwdRef.current !== cwd) {
      statusCwdRef.current = cwd;
      setStatus(undefined);
    }
    if (!cwd) {
      requestRef.current += 1;
      setStatus(null);
      return;
    }
    if (!visible) return;
    refresh();
    const interval = window.setInterval(refresh, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [cwd, visible]);

  return status;
}
