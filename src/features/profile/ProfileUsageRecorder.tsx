import { useEffect } from 'react';
import { useStoreApi } from '../../hooks/useStore';
import type { ProfileUsageRecord } from './profileShare';

export function ProfileUsageRecorder() {
  const store = useStoreApi();
  useEffect(() => {
    const api = window.droidControl;
    if (!api) return;
    const observed = new Map<string, string>();
    let previous = store.getState().sessions;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const lifecycle = new AbortController();
    let writing = false;

    const record = async () => {
      timer = undefined;
      if (writing) return;
      const records: ProfileUsageRecord[] = [];
      const signatures = new Map<string, string>();
      const sessions = store.getState().sessions;
      for (const session of Object.values(sessions)) {
        const tokens = Math.max(0, Math.round(session.tokensIn + session.tokensOut));
        const signature = `${String(tokens)}:${session.modelId ?? ''}`;
        if (observed.get(session.appSessionId) === signature) continue;
        records.push({
          id: session.appSessionId,
          provider: session.provider,
          modelId: session.modelId,
          tokens,
          createdAt: session.createdAt,
        });
        signatures.set(session.appSessionId, signature);
      }
      if (records.length === 0) return;
      writing = true;
      try {
        await api.recordProfileUsage(records);
        for (const [id, signature] of signatures) observed.set(id, signature);
      } catch (error) {
        console.error(
          '[profile] Could not save local usage:',
          error instanceof Error ? error.message : 'Unknown error',
        );
      } finally {
        writing = false;
        if (!lifecycle.signal.aborted && store.getState().sessions !== sessions) schedule();
      }
    };
    const schedule = () => {
      if (!timer && !writing) timer = setTimeout(() => void record(), 5_000);
    };
    const unsubscribe = store.subscribe(() => {
      const sessions = store.getState().sessions;
      if (sessions === previous) return;
      previous = sessions;
      schedule();
    });
    void record();
    return () => {
      lifecycle.abort();
      unsubscribe();
      clearTimeout(timer);
    };
  }, [store]);
  return null;
}
