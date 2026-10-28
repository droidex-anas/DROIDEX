import { useEffect, useRef, useState } from 'react';
import type { RemoteState } from '../../../packages/remote/src/desktop';

export function useRemoteAccess() {
  const [state, setState] = useState<RemoteState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const revision = useRef(0);
  useEffect(() => {
    const api = window.droidex;
    if (!api) {
      setError('Open the desktop app to set up Remote.');
      return;
    }
    let active = true;
    const requestRevision = revision.current;
    const unsubscribe = api.onRemoteState((next) => {
      revision.current++;
      if (active) setState(next);
    });
    void api
      .getRemoteState()
      .then((next) => {
        if (active && revision.current === requestRevision) setState(next);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not load Remote.');
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  async function run(action: () => Promise<RemoteState>): Promise<boolean> {
    setBusy(true);
    setError('');
    const requestRevision = revision.current;
    try {
      const next = await action();
      if (revision.current === requestRevision) setState(next);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Remote action failed.');
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { state, error, busy, run, setError };
}
