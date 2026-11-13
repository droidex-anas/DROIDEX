import { Check, Download, RefreshCw, Spinner } from '@droidex/icons';
import { PROVIDER_LABELS } from '../../features/providers/providerIdentity';
import type { InstallChannel, ProviderKind } from '../../types/bridge';
import { ActivityStatusGlyph } from '../ActivityStatusGlyph';
import { ToolPanel } from '../transcript/primitives';
import { Button } from '../ui/Button';
import type { InstallOption } from './agents';
import { CommandLine } from './CommandLine';
import { Segmented } from './Segmented';
import type { InstallRun } from './useAgentSetup';

// The panel shows the newest lines, the way a terminal would.
const VISIBLE_LOG_LINES = 7;

export function InstallChoice({
  agent,
  options,
  picked,
  locked,
  onPick,
  onInstall,
  onRecheck,
  onSkip,
}: {
  agent: ProviderKind;
  options: readonly InstallOption[];
  picked: InstallOption | null;
  /** Another install is running; one at a time. */
  locked: boolean;
  onPick: (channel: InstallChannel) => void;
  onInstall: (channel: InstallChannel) => void;
  onRecheck: () => void;
  onSkip: () => void;
}) {
  const label = PROVIDER_LABELS[agent];
  if (!picked) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-body text-secondary">
          DROIDEX installs {label} with Homebrew or npm, and this Mac has neither yet. Install one,
          then check again.
        </p>
        <div className="flex h-8 items-center gap-2">
          <Button variant="secondary" icon={RefreshCw} onClick={onRecheck}>
            Check again
          </Button>
          <span className="flex-1" />
          <Button variant="ghost" onClick={onSkip}>
            Skip for now
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-body text-secondary">
        {label} isn&apos;t on this Mac yet. Pick an installer and DROIDEX runs it for you.
      </p>
      <Segmented
        label={`Install ${label} with`}
        value={picked.channel}
        options={options.map((option) => ({ value: option.channel, label: option.label }))}
        onChange={onPick}
      />
      <CommandLine command={picked.command} />
      <div className="flex h-8 items-center gap-2">
        <Button
          variant="primary"
          icon={Download}
          data-primary
          disabled={locked}
          onClick={() => {
            onInstall(picked.channel);
          }}
        >
          Install {label}
        </Button>
        <span className="flex-1" />
        <Button variant="ghost" onClick={onSkip}>
          Skip for now
        </Button>
      </div>
    </div>
  );
}

function RunMark({ outcome }: { outcome: InstallRun['outcome'] }) {
  if (outcome === 'running') {
    return <Spinner className="size-icon-sm shrink-0 animate-spin text-muted" aria-hidden="true" />;
  }
  if (outcome === 'failed') return <ActivityStatusGlyph status="failed" decorative />;
  return <Check className="ob-pop size-icon-sm shrink-0 text-success" aria-hidden="true" />;
}

const RUN_TITLES: Record<InstallRun['outcome'], string> = {
  running: 'Running',
  succeeded: 'Ran',
  failed: 'Failed',
};

/** A running or finished install: its command, its newest output, and what comes next. */
export function InstallLog({
  agent,
  run,
  command,
  onRetry,
  onRecheck,
  onSkip,
}: {
  agent: ProviderKind;
  run: InstallRun;
  command: string;
  onRetry: () => void;
  onRecheck: () => void;
  onSkip: () => void;
}) {
  const label = PROVIDER_LABELS[agent];
  const first = Math.max(0, run.log.length - VISIBLE_LOG_LINES);
  return (
    <div className="flex flex-col gap-3">
      <ToolPanel className="ob-inset h-40">
        <div className="flex h-full flex-col px-3.5 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span key={run.outcome} className="ob-pop flex shrink-0">
              <RunMark outcome={run.outcome} />
            </span>
            <span className="flex min-w-0 items-baseline gap-2">
              <span
                className={`text-body-strong ${run.outcome === 'running' ? 'shimmer-text' : 'text-secondary'}`}
              >
                {RUN_TITLES[run.outcome]}
              </span>
              <span className="truncate font-mono text-code-sm text-muted">{command}</span>
            </span>
          </div>
          <div className="mt-2.5 flex min-h-0 flex-1 flex-col justify-end gap-1 overflow-hidden pl-6 font-mono text-code-sm text-muted">
            {run.log.slice(first).map((line, index) => (
              <div key={first + index} className="droid-rise truncate">
                {line}
              </div>
            ))}
          </div>
        </div>
      </ToolPanel>
      {run.outcome === 'running' && (
        <p className="flex h-8 items-center text-caption text-muted">
          Usually done in under a minute. Sign-in comes next.
        </p>
      )}
      {run.outcome === 'succeeded' && (
        <div className="flex h-8 items-center gap-2">
          <span className="shimmer-text min-w-0 flex-1 truncate text-body">
            Looking for {label} on this Mac
          </span>
          <Button variant="ghost" icon={RefreshCw} onClick={onRecheck}>
            Check again
          </Button>
        </div>
      )}
      {run.outcome === 'failed' && (
        <div className="flex flex-col gap-2">
          <p className="text-caption text-danger">
            The installer stopped before it finished. Its output above says why.
          </p>
          <div className="flex h-8 items-center gap-2">
            <Button variant="primary" data-primary onClick={onRetry}>
              Try again
            </Button>
            <span className="flex-1" />
            <Button variant="ghost" onClick={onSkip}>
              Skip for now
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
