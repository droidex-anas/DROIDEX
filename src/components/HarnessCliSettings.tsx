import { PROVIDER_LABELS, PROVIDER_MARKS } from '../features/providers/providerIdentity';
import { useHarnessClis } from '../hooks/useHarnessClis';
import { useStoreSelector } from '../hooks/useStore';
import { updateHarnessCli } from '../lib/commands';
import type {
  HarnessCliProvider,
  HarnessCliState,
  HarnessInstallSource,
  ProviderStatus,
} from '../types/bridge';
import { ModelIcon } from './ModelIcon';
import { SettingRow } from './settingsKit';
import { Switch } from './Switch';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';

const SOURCE_LABELS: Record<HarnessInstallSource, string> = {
  homebrew: 'Homebrew',
  npm: 'npm',
  native: 'Native installer',
  chatgpt: 'Bundled with ChatGPT, which updates it',
};

/**
 * Claude Code and Codex as installed on this machine. Each updates through
 * whichever installer owns its binary, detected from where the binary lives.
 */
export function HarnessCliSettings({
  autoUpdate,
  onAutoUpdateChange,
}: {
  autoUpdate: boolean;
  onAutoUpdateChange: (enabled: boolean) => void;
}) {
  const clis = useHarnessClis();
  const statuses = useStoreSelector((state) => state.providerStatuses);

  return (
    <div className="rounded-xl bg-surface shadow-lg mb-8">
      {clis === null ? (
        <SettingRow label="Claude Code and Codex" description="Detecting installed CLIs…">
          <span />
        </SettingRow>
      ) : (
        clis.map((cli) => (
          <HarnessCliRow
            key={cli.provider}
            cli={cli}
            status={statuses.find((entry) => entry.provider === cli.provider)}
          />
        ))
      )}
      <SettingRow
        label="Keep Claude Code and Codex up to date"
        description="Updates installed CLIs on launch."
      >
        <Switch
          label="Keep Claude Code and Codex up to date"
          checked={autoUpdate}
          onChange={onAutoUpdateChange}
        />
      </SettingRow>
    </div>
  );
}

function HarnessCliRow({ cli, status }: { cli: HarnessCliState; status?: ProviderStatus }) {
  const label = (
    <span className="inline-flex items-center gap-2">
      <ModelIcon provider={PROVIDER_MARKS[cli.provider]} size={15} />
      {PROVIDER_LABELS[cli.provider]}
    </span>
  );
  if (!cli.installed) {
    return (
      <SettingRow label={label} description="Not detected on this machine.">
        <span className="font-mono text-code text-muted">missing</span>
      </SettingRow>
    );
  }

  return (
    <SettingRow
      label={label}
      description={
        <>
          <span className="block truncate" title={cli.path}>
            {SOURCE_LABELS[cli.source]} · {cli.path}
          </span>
          {cli.updateError && (
            <span className="block truncate text-danger" title={cli.updateError}>
              Update failed: {cli.updateError}
            </span>
          )}
        </>
      }
    >
      <div className="flex shrink-0 items-center gap-2">
        <span className="font-mono text-code text-muted">{cli.version ?? 'installed'}</span>
        {status?.readiness === 'ready' && <SignInBadge provider={cli.provider} status={status} />}
        {cli.source !== 'chatgpt' && (
          <Button
            size="sm"
            onClick={() => {
              updateHarnessCli(cli.provider);
            }}
            disabled={cli.updating}
          >
            {cli.updating ? 'Updating…' : 'Update'}
          </Button>
        )}
      </div>
    </SettingRow>
  );
}

const SIGN_IN_COMMANDS: Record<HarnessCliProvider, string> = {
  claude: 'claude',
  codex: 'codex login',
};

// Sign-in is informational: a CLI without one can still run through a gateway
// or key its own config names, so chats on it stay available either way.
function SignInBadge({
  provider,
  status,
}: {
  provider: HarnessCliProvider;
  status: ProviderStatus;
}) {
  if (status.accountLabel) {
    return (
      <Badge tone="success" title={status.accountLabel}>
        Signed in
      </Badge>
    );
  }
  return (
    <Badge title={`Run \`${SIGN_IN_COMMANDS[provider]}\` in a terminal to sign in.`}>
      Not signed in
    </Badge>
  );
}
