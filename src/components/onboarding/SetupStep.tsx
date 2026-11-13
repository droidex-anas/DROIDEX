import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, RefreshCw, Spinner } from '@droidex/icons';
import { PROVIDER_LABELS } from '../../features/providers/providerIdentity';
import type { InstallChannel, ProviderKind } from '../../types/bridge';
import { ActivityStatusGlyph } from '../ActivityStatusGlyph';
import { Expand } from '../transcript/primitives';
import { Button } from '../ui/Button';
import { AgentTile } from './AgentTile';
import {
  installOptionFor,
  installOptions,
  joinNames,
  type AgentStatus,
  type AgentStatuses,
} from './agents';
import { InstallChoice, InstallLog } from './InstallPanel';
import { ReadyBody, SignIn } from './SignInPanel';
import { StepHeader } from './StepHeader';
import { recheckAgents, type InstallRun, type InstallRuns } from './useAgentSetup';

function runLine(run: InstallRun, installer: string, skippedNote: string): ReactNode {
  if (run.outcome === 'running') {
    return <span className="shimmer-text">Installing with {installer}</span>;
  }
  if (run.outcome === 'failed') return `${skippedNote}Install didn't finish`;
  return 'Installed · looking for it';
}

function AgentPanel({
  agent,
  status,
  run,
  open,
  skipped,
  installing,
  availableChannels,
  pickedChannel,
  onToggle,
  onPick,
  onInstall,
  onClearRun,
  onSkip,
  saveApiKey,
}: {
  agent: ProviderKind;
  status: AgentStatus;
  run: InstallRun | null;
  open: boolean;
  skipped: boolean;
  /** The agent whose install is running, if any. */
  installing: ProviderKind | null;
  availableChannels: readonly InstallChannel[];
  pickedChannel: InstallChannel | undefined;
  onToggle: () => void;
  onPick: (channel: InstallChannel) => void;
  onInstall: (channel: InstallChannel) => void;
  onClearRun: () => void;
  onSkip: () => void;
  saveApiKey: (key: string) => Promise<void>;
}) {
  const label = PROVIDER_LABELS[agent];
  const skippedNote = skipped ? 'Skipped · ' : '';
  const busy = <Spinner className="size-icon-sm animate-spin" aria-hidden="true" />;
  let glyphKey: string = status.state;
  let glyph: ReactNode;
  let line: ReactNode;
  let body: ReactNode;

  if (run && (run.outcome === 'running' || status.state === 'missing')) {
    const runOption = installOptions(agent, [run.channel]).at(0);
    glyphKey = run.outcome;
    glyph = run.outcome === 'failed' ? <ActivityStatusGlyph status="failed" decorative /> : busy;
    line = runLine(run, runOption?.label ?? 'the installer', skippedNote);
    body = (
      <InstallLog
        agent={agent}
        run={run}
        command={runOption?.command ?? ''}
        onRetry={onClearRun}
        onRecheck={recheckAgents}
        onSkip={onSkip}
      />
    );
  } else if (status.state === 'checking') {
    glyph = busy;
    line = <span className="shimmer-text">Checking this Mac</span>;
    body = <p className="shimmer-text text-body">Looking for {label} on this Mac</p>;
  } else if (status.state === 'missing') {
    const options = installOptions(agent, availableChannels);
    glyph = <ActivityStatusGlyph status="ready" decorative />;
    line = `${skippedNote}Not installed`;
    body = (
      <InstallChoice
        agent={agent}
        options={options}
        picked={installOptionFor(options, pickedChannel)}
        locked={installing !== null}
        onPick={onPick}
        onInstall={onInstall}
        onRecheck={recheckAgents}
        onSkip={onSkip}
      />
    );
  } else if (status.state === 'unavailable') {
    glyph = <ActivityStatusGlyph status="interrupted" decorative />;
    line = status.reason;
    body = (
      <div className="flex flex-col gap-3">
        <p className="text-body text-secondary">{status.reason}</p>
        <div className="flex h-8 items-center">
          <Button variant="secondary" icon={RefreshCw} onClick={recheckAgents}>
            Check again
          </Button>
        </div>
      </div>
    );
  } else if (status.state === 'signin') {
    glyph = <ActivityStatusGlyph status="approval" decorative />;
    line = `${skippedNote}${status.install.version ?? 'Installed'} · needs sign-in`;
    body = <SignIn agent={agent} status={status} saveApiKey={saveApiKey} onSkip={onSkip} />;
  } else {
    glyph = <ActivityStatusGlyph status="settled" decorative />;
    line = ['Ready', status.install.version, status.account].filter(Boolean).join(' · ');
    body = <ReadyBody status={status} />;
  }

  return (
    <div className="ob-panel" data-open={open || undefined}>
      <button
        type="button"
        className="ob-panel-head"
        aria-expanded={open}
        disabled={installing !== null && installing !== agent}
        onClick={onToggle}
      >
        <AgentTile agent={agent} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-body-strong text-primary">{label}</span>
          <span className="truncate text-caption text-muted">{line}</span>
        </span>
        <span key={glyphKey} className="ob-pop flex w-4 shrink-0 justify-center text-muted">
          {glyph}
        </span>
        <ChevronDown className="ob-caret size-icon-sm" aria-hidden="true" />
      </button>
      <Expand open={open}>
        <div className="px-3.5 pb-3.5 pt-0.5">{body}</div>
      </Expand>
    </div>
  );
}

export function SetupStep({
  chosen,
  statuses,
  runs,
  installing,
  skipped,
  open,
  availableChannels,
  onOpen,
  onInstall,
  onClearRun,
  onSkip,
  saveApiKey,
}: {
  chosen: readonly ProviderKind[];
  statuses: AgentStatuses;
  runs: InstallRuns;
  installing: ProviderKind | null;
  skipped: readonly ProviderKind[];
  open: ProviderKind | null;
  availableChannels: readonly InstallChannel[];
  onOpen: (agent: ProviderKind) => void;
  onInstall: (agent: ProviderKind, channel: InstallChannel) => void;
  onClearRun: (agent: ProviderKind) => void;
  onSkip: (agent: ProviderKind) => void;
  saveApiKey: (key: string) => Promise<void>;
}) {
  const [picked, setPicked] = useState<Partial<Record<ProviderKind, InstallChannel>>>({});

  // Sign-ins happen in Terminal, so coming back to the window is the moment
  // to look again.
  useEffect(() => {
    const onFocus = () => {
      recheckAgents();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  const ready = chosen.filter((agent) => statuses[agent].state === 'ready');
  const sub =
    ready.length === chosen.length
      ? `${joinNames(chosen)} ${chosen.length === 1 ? 'is' : 'are'} ready to go.`
      : `${String(ready.length)} of ${String(chosen.length)} ready. Each agent keeps its own sign-in, and anything you skip waits in Settings.`;

  return (
    <div className="flex flex-col">
      <StepHeader title="Get your agents ready" sub={sub} />
      <div className="droid-rise mt-7 flex flex-col gap-1" style={{ animationDelay: '100ms' }}>
        {chosen.map((agent) => (
          <AgentPanel
            key={agent}
            agent={agent}
            status={statuses[agent]}
            run={runs[agent]}
            open={open === agent}
            skipped={skipped.includes(agent)}
            installing={installing}
            availableChannels={availableChannels}
            pickedChannel={picked[agent]}
            onToggle={() => {
              onOpen(agent);
            }}
            onPick={(channel) => {
              setPicked((current) => ({ ...current, [agent]: channel }));
            }}
            onInstall={(channel) => {
              onInstall(agent, channel);
            }}
            onClearRun={() => {
              onClearRun(agent);
            }}
            onSkip={() => {
              onSkip(agent);
            }}
            saveApiKey={saveApiKey}
          />
        ))}
      </div>
    </div>
  );
}
