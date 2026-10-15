import { RefreshCw } from '@droidex/icons';

import type { OnboardingController } from '../../../hooks/useOnboarding';
import { Button } from '../../ui/Button';
import { Panel, StatusDot, StepLabel, StepTitle } from '../kit';

export function SystemStep({
  controller,
  onNext,
}: {
  controller: OnboardingController;
  onNext: () => void;
}) {
  const { env, refreshEnv } = controller;

  const cli = env?.cli;
  const auth = env?.auth;
  const rows = [
    {
      label: 'Droid CLI',
      status: !env ? 'pending' : cli?.present ? 'ok' : 'missing',
      detail: cli?.present
        ? `${cli.version ?? 'installed'} · ${cli.path}`
        : 'Not found — the next step installs it',
    },
    {
      label: 'Factory account',
      status: !env ? 'pending' : auth?.loginPresent || auth?.apiKeyConfigured ? 'ok' : 'missing',
      detail:
        auth?.loginPresent || auth?.apiKeyConfigured
          ? 'Signed in'
          : 'Sign in later in this setup, or from Settings',
    },
    {
      label: 'Node.js',
      status: !env ? 'pending' : env.node.present ? 'ok' : 'missing',
      detail: env?.node.present
        ? (env.node.version ?? 'installed')
        : 'Not found — only needed for the npm install channel',
    },
  ] as const;

  const ready = Boolean(cli?.present);

  return (
    <div className="mx-auto w-full max-w-lg">
      <StepLabel>System check</StepLabel>
      <StepTitle
        title="A quick look under the hood."
        sub="DROIDEX checked the essentials on this machine. Anything missing can be fixed in the next steps."
      />

      <Panel className="mb-7 py-1">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center gap-3.5 px-4 py-2.5">
            <StatusDot status={row.status} />
            <div className="min-w-0 flex-1">
              <div className="text-body text-primary">{row.label}</div>
              <div className="mt-0.5 truncate font-mono text-code-sm text-muted">{row.detail}</div>
            </div>
          </div>
        ))}
      </Panel>

      <div className="flex gap-2">
        {!ready && (
          <Button
            size="lg"
            icon={RefreshCw}
            onClick={() => {
              refreshEnv();
            }}
            className="flex-1"
          >
            Re-scan
          </Button>
        )}
        <Button variant="primary" size="lg" onClick={onNext} className="flex-1">
          Continue
        </Button>
      </div>
    </div>
  );
}
