import { useEffect, useState } from 'react';

import { bridge } from '../lib/bridge';
import { requestDroidProxyStatus } from '../lib/commands';
import { toast } from '../lib/toast';
import type { DroidProxyProviderKey, DroidProxyStatus } from '../types/bridge';

// Live DroidProxy state for the settings page: status snapshots on mount and
// after every mutation, plus toasts for login and apply outcomes.
export function useDroidProxy(): {
  status: DroidProxyStatus | null;
  loggingIn: DroidProxyProviderKey | null;
} {
  const [status, setStatus] = useState<DroidProxyStatus | null>(null);
  const [loggingIn, setLoggingIn] = useState<DroidProxyProviderKey | null>(null);

  useEffect(() => {
    const unsubscribe = bridge.subscribe((event) => {
      if (event.type === 'droidproxy.report') {
        setStatus(event.status);
        // A remount mid-login restores waiting/Cancel from the sidecar, which
        // owns the login lifecycle. Clearing stays with login.done.
        if (event.status.loginInProgress) setLoggingIn(event.status.loginInProgress);
        return;
      }
      if (event.type === 'droidproxy.login.started') {
        setLoggingIn(event.provider);
        toast.info('Complete the sign-in in your browser; DROIDEX will detect it.');
        return;
      }
      if (event.type === 'droidproxy.login.done') {
        setLoggingIn(null);
        if (event.ok) {
          toast.success('Subscription connected.');
        } else if (!event.cancelled) {
          toast.error(event.message ?? 'Sign-in did not complete.');
        }
        return;
      }
      if (event.type === 'droidproxy.factoryModels.applied') {
        if (event.ok) {
          toast.success(
            event.removed > 0
              ? `Applied ${String(event.applied)} DroidProxy models (replaced ${String(event.removed)}).`
              : `Applied ${String(event.applied)} DroidProxy models.`,
          );
        } else {
          toast.error(event.message ?? 'Could not update Factory settings.');
        }
      }
    });
    requestDroidProxyStatus();
    return unsubscribe;
  }, []);

  return { status, loggingIn };
}
