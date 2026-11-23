import { useCallback, useEffect, useRef, useState } from 'react';
import type { DroidexApi } from '../../lib/desktopContract';
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
  const reads = useRef({ started: 0, applied: 0 });

  // The poll and a manual refresh can be in flight together, and either may
  // answer first, so a reply never replaces one from a newer read.
  const readUsage = useCallback(async (desktop: DroidexApi) => {
    const read = ++reads.current.started;
    const snapshot = await desktop.getProfileUsage();
    if (read < reads.current.applied) return;
    reads.current.applied = read;
    setUsage(snapshot);
    setError('');
  }, []);

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
    const poll = async () => {
      try {
        await readUsage(desktop);
      } catch (cause) {
        // Later failures are usually transient; a manual refresh surfaces persistent ones.
        if (active && firstRead) setError(errorMessage(cause));
      }
      if (!active) return;
      if (firstRead) setLoading(false);
      firstRead = false;
      timer = setTimeout(() => void poll(), USAGE_POLL_MS);
    };
    void poll();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [readUsage]);

  const refresh = async () => {
    setLoading(true);
    setError('');
    try {
      if (!window.droidex) throw new Error('Local usage is available in the desktop app.');
      await readUsage(window.droidex);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  };

  return { usage, loading, error, refresh };
}
