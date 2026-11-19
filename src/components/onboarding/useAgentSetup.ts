import { useCallback, useEffect, useMemo, useState } from 'react';
import { useHarnessClis } from '../../hooks/useHarnessClis';
import type { OnboardingController } from '../../hooks/useOnboarding';
import { useStoreSelector } from '../../hooks/useStore';
import { bridge } from '../../lib/bridge';
import {
  checkHarnessClis,
  detectEnv,
  installHarnessCli,
  refreshProviders,
} from '../../lib/commands';
import type { HarnessCliProvider, InstallChannel, ProviderKind } from '../../types/bridge';
import { droidStatus, harnessStatus, type AgentStatuses } from './agents';

/** One install setup started, with its output so far. */
export interface InstallRun {
  channel: InstallChannel;
  log: readonly string[];
  outcome: 'running' | 'failed' | 'succeeded';
}

export type InstallRuns = Record<ProviderKind, InstallRun | null>;

const LOG_LIMIT = 400;

// Asks every source of agent readiness again: the Droid CLI and its sign-in,
// each provider's probe, and the Claude Code and Codex binaries.
export function recheckAgents(): void {
  detectEnv();
  refreshProviders();
  checkHarnessClis();
}

// The live state of each agent's CLI, and the installs setup runs for them.
// Droid installs through the onboarding controller, which App also watches;
// Claude Code and Codex install through the sidecar's harness installer.
export function useAgentSetup(controller: OnboardingController) {
  const { env, installing, installLog, lastResult, install: installDroid } = controller;
  const providerStatuses = useStoreSelector((state) => state.providerStatuses);
  const clis = useHarnessClis();
  const [droidChannel, setDroidChannel] = useState<InstallChannel | null>(null);
  const [harnessRuns, setHarnessRuns] = useState<Record<HarnessCliProvider, InstallRun | null>>({
    claude: null,
    codex: null,
  });

  useEffect(
    () =>
      bridge.subscribe((event) => {
        if (event.type === 'harness.cli.install.progress') {
          setHarnessRuns((runs) => {
            const run = runs[event.provider];
            if (!run) return runs;
            const log = [...run.log.slice(-LOG_LIMIT), event.line];
            return { ...runs, [event.provider]: { ...run, log } };
          });
        } else if (event.type === 'harness.cli.install.done') {
          setHarnessRuns((runs) => {
            const run = runs[event.provider];
            if (!run) return runs;
            const outcome = event.ok ? 'succeeded' : 'failed';
            return { ...runs, [event.provider]: { ...run, outcome } };
          });
        }
      }),
    [],
  );

  const statuses = useMemo<AgentStatuses>(() => {
    const harness = (provider: HarnessCliProvider) =>
      harnessStatus(
        providerStatuses.find((status) => status.provider === provider),
        clis?.find((cli) => cli.provider === provider),
      );
    return { droid: droidStatus(env), claude: harness('claude'), codex: harness('codex') };
  }, [env, providerStatuses, clis]);

  let droidRun: InstallRun | null = null;
  if (droidChannel !== null && installing === 'install') {
    droidRun = { channel: droidChannel, log: installLog, outcome: 'running' };
  } else if (droidChannel !== null && lastResult?.phase === 'install') {
    const outcome = lastResult.ok ? 'succeeded' : 'failed';
    droidRun = { channel: droidChannel, log: installLog, outcome };
  }
  const runs: InstallRuns = { droid: droidRun, ...harnessRuns };

  const install = useCallback(
    (agent: ProviderKind, channel: InstallChannel) => {
      if (agent === 'droid') {
        setDroidChannel(channel);
        installDroid(channel);
        return;
      }
      setHarnessRuns((runs) => ({ ...runs, [agent]: { channel, log: [], outcome: 'running' } }));
      installHarnessCli(agent, channel);
    },
    [installDroid],
  );

  // Puts a finished install away, so its agent offers the installers again.
  const clearRun = useCallback((agent: ProviderKind) => {
    if (agent === 'droid') {
      setDroidChannel(null);
      return;
    }
    setHarnessRuns((runs) => ({ ...runs, [agent]: null }));
  }, []);

  return { statuses, runs, install, clearRun };
}
