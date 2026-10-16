import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, Download, RefreshCw, Spinner } from '@droidex/icons';

import type { OnboardingController } from '../../../hooks/useOnboarding';
import type { InstallChannel } from '../../../types/bridge';
import { Button } from '../../ui/Button';
import { Row } from '../../ui/Row';
import { Panel, StepLabel, StepTitle } from '../kit';

const CHANNEL_LABEL: Record<InstallChannel, string> = {
  script: 'Official installer',
  brew: 'Homebrew',
  npm: 'npm',
};

// eslint-disable-next-line react-refresh/only-export-components
export function selectInstallChannel(
  channels: InstallChannel[],
  selected: InstallChannel | null,
): InstallChannel | null {
  return selected && channels.includes(selected) ? selected : (channels[0] ?? null);
}

export function InstallStep({
  controller,
  onNext,
  onBack,
}: {
  controller: OnboardingController;
  onNext: () => void;
  onBack: () => void;
}) {
  const { env, installLog, installing, lastResult, install, refreshEnv } = controller;
  const channels = useMemo(() => env?.availableChannels ?? [], [env?.availableChannels]);
  const [channel, setChannel] = useState<InstallChannel | null>(() =>
    selectInstallChannel(channels, null),
  );
  useEffect(() => {
    const nextChannel = selectInstallChannel(channels, channel);
    if (nextChannel !== channel) setChannel(nextChannel);
  }, [channels, channel]);

  const installed = Boolean(env?.cli.present);
  const detectedCli = env?.cli;
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [installLog]);

  if (installed) {
    return (
      <div className="mx-auto w-full max-w-lg">
        <StepLabel>Droid CLI</StepLabel>
        <StepTitle
          title="The CLI is ready."
          sub={`Detected ${detectedCli?.version ? `v${detectedCli.version}` : 'an installation'} at ${detectedCli?.path ?? 'droid'}.`}
        />
        <Button variant="primary" size="lg" onClick={onNext} className="w-full">
          Continue
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-lg">
      <StepLabel>Droid CLI</StepLabel>
      <StepTitle
        title="Install the engine."
        sub="Droid agents run on the Factory CLI. Pick how you'd like to install it — DROIDEX handles the rest."
      />

      {channels.length === 0 && (
        <Panel className="mb-4 px-4 py-3 text-body text-secondary">
          <p className="mb-1 text-warning">No supported package manager found.</p>
          Install Homebrew, npm, or curl, then re-scan. You can also skip this for now and finish
          setup later.
        </Panel>
      )}
      {channels.length > 0 && (
        <div role="radiogroup" aria-label="Droid CLI installation method" className="mb-4">
          <Panel className="p-2">
            {channels.map((c) => (
              <Row
                key={c}
                role="radio"
                aria-checked={channel === c}
                active={channel === c}
                disabled={!!installing}
                onClick={() => {
                  setChannel(c);
                }}
                icon={<RadioMark checked={channel === c} />}
                label={CHANNEL_LABEL[c]}
                trailing={channel === c && <Check className="size-icon-md text-accent" />}
              />
            ))}
          </Panel>
        </div>
      )}

      {(Boolean(installing) || installLog.length > 0) && (
        <div
          ref={logRef}
          className="mb-4 max-h-40 overflow-auto rounded-lg bg-surface p-3 font-mono text-code text-muted"
        >
          {installLog.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap break-words">
              {line}
            </div>
          ))}
          {installing && (
            <div className="flex items-center gap-1.5 text-secondary">
              <Spinner className="size-3 motion-safe:animate-spin-slow" /> working…
            </div>
          )}
        </div>
      )}

      {lastResult && !lastResult.ok && (
        <p className="mb-3 text-body text-danger">
          Installation didn&apos;t finish. Review the log and try again.
        </p>
      )}

      {installing ? (
        <Button variant="primary" size="lg" icon={Download} loading disabled className="w-full">
          Installing…
        </Button>
      ) : channels.length === 0 ? (
        <Button
          variant="primary"
          size="lg"
          icon={RefreshCw}
          onClick={() => {
            refreshEnv();
          }}
          className="w-full"
        >
          Re-scan
        </Button>
      ) : (
        <Button
          variant="primary"
          size="lg"
          icon={Download}
          onClick={() => {
            if (channel) install(channel);
          }}
          disabled={!channel}
          className="w-full"
        >
          Install with {channel ? CHANNEL_LABEL[channel] : 'package manager'}
        </Button>
      )}

      {!installing && (
        <div className="mt-2 flex items-center gap-2">
          <Button variant="ghost" size="lg" icon={ArrowLeft} onClick={onBack}>
            Back
          </Button>
          <Button size="lg" onClick={onNext} className="flex-1">
            Skip for now
          </Button>
        </div>
      )}
    </div>
  );
}

function RadioMark({ checked }: { checked: boolean }) {
  return (
    <span
      className={`flex size-3.5 items-center justify-center rounded-full ${checked ? 'bg-accent' : 'bg-active'}`}
    >
      {checked && <span className="size-1.5 rounded-full bg-bg" />}
    </span>
  );
}
