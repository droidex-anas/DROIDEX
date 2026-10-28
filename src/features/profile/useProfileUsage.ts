import { useEffect, useState } from 'react';
import type { ProfileUsageSnapshot } from './profileShare';

const USAGE_POLL_MS = 5000;

function errorMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : 'Could not read local usage.';
}

/** The local usage ledger, kept live while the profile is open. */
export function useProfileUsage() {
  const [usage, setUsage] = useState<ProfileUsageSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // The sidecar does not push ledger changes to the renderer, so poll for the
  // whole time the profile is mounted: indexing progress and new chats both
  // show up without a manual refresh.
  useEffect(() => {
    const desktop = window.droidex;
    if (!desktop) {
      setLoading(false);
      setError('Local usage is available in the desktop app.');
      return;
    }
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let firstRead = true;
    const read = async () => {
      try {
        const snapshot = await desktop.getProfileUsage();
        if (active) {
          setUsage(snapshot);
          setError('');
        }
      } catch (cause) {
        // Later failures are usually transient; a manual refresh surfaces persistent ones.
        if (active && firstRead) setError(errorMessage(cause));
      }
      if (!active) return;
      if (firstRead) setLoading(false);
      firstRead = false;
      timer = setTimeout(() => void read(), USAGE_POLL_MS);
    };
    void read();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const refresh = async () => {
    setLoading(true);
    setError('');
    try {
      if (!window.droidex) throw new Error('Local usage is available in the desktop app.');
      setUsage(await window.droidex.getProfileUsage());
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  };

  return { usage, loading, error, refresh };
}
