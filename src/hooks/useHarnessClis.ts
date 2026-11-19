import { useEffect, useRef, useState } from 'react';
import { PROVIDER_LABELS } from '../features/providers/providerIdentity';
import { bridge } from '../lib/bridge';
import { checkHarnessClis, updateHarnessCli } from '../lib/commands';
import { toast } from '../lib/toast';
import type { HarnessCliProvider, HarnessCliState } from '../types/bridge';

const HARNESS_CLI_PROVIDERS: readonly HarnessCliProvider[] = ['claude', 'codex'];

// The detected Claude Code and Codex binaries, re-checked on mount.
export function useHarnessClis(): HarnessCliState[] | null {
  const [clis, setClis] = useState<HarnessCliState[] | null>(null);

  useEffect(() => {
    const unsubscribe = bridge.subscribe((event) => {
      if (event.type === 'harness.cli.report') setClis(event.clis);
    });
    checkHarnessClis();
    return unsubscribe;
  }, []);

  return clis;
}

// Updates Claude Code and Codex once per launch when enabled, and announces
// the outcome of any update that changed something, wherever it was started.
export function useHarnessCliAutoUpdate(enabled: boolean): void {
  const launchHandled = useRef(false);

  useEffect(() => {
    if (!enabled || launchHandled.current) return;
    launchHandled.current = true;
    for (const provider of HARNESS_CLI_PROVIDERS) updateHarnessCli(provider);
  }, [enabled]);

  useEffect(
    () =>
      bridge.subscribe((event) => {
        if (event.type !== 'harness.cli.update.done') return;
        const label = PROVIDER_LABELS[event.provider];
        if (!event.ok) {
          toast.error(`Couldn't update ${label}. See Settings → Setup & updates.`);
          return;
        }
        if (event.version && event.version !== event.previousVersion) {
          toast.success(`${label} updated to ${event.version}.`);
        }
      }),
    [],
  );
}
