import { PROVIDER_LABELS } from '../features/providers/providerIdentity';
import { useHarnessClis } from '../hooks/useHarnessClis';
import { updateHarnessCli } from '../lib/commands';
import type { HarnessCliState, HarnessInstallSource } from '../types/bridge';
import { SettingRow } from './settingsKit';
import { Switch } from './Switch';

const SOURCE_LABELS: Record<HarnessInstallSource, string> = {
  homebrew: 'Homebrew',
  npm: 'npm',
  native: 'Native installer',
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

  return (
    <div className="rounded-xl border border-droid-border bg-droid-surface divide-y divide-droid-border mb-8">
      {clis === null ? (
        <SettingRow label="Claude Code and Codex" description="Detecting installed CLIs…">
          <span />
        </SettingRow>
      ) : (
        clis.map((cli) => <HarnessCliRow key={cli.provider} cli={cli} />)
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

function HarnessCliRow({ cli }: { cli: HarnessCliState }) {
  const label = PROVIDER_LABELS[cli.provider];
  if (!cli.installed) {
    return (
      <SettingRow label={label} description="Not detected on this machine.">
        <span className="text-[12px] font-mono text-droid-text-muted">missing</span>
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
            <span className="block truncate text-droid-red" title={cli.updateError}>
              Update failed: {cli.updateError}
            </span>
          )}
        </>
      }
    >
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-[12px] font-mono text-droid-text-muted">
          {cli.version ?? 'installed'}
        </span>
        <button
          onClick={() => {
            updateHarnessCli(cli.provider);
          }}
          disabled={cli.updating}
          className="px-2.5 h-7 rounded-md bg-droid-elevated border border-droid-border text-[12px] text-droid-text hover:border-droid-border-hover transition-colors disabled:opacity-40"
        >
          {cli.updating ? 'Updating…' : 'Update'}
        </button>
      </div>
    </SettingRow>
  );
}
