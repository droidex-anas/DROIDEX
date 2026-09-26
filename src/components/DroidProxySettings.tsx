import {
  applyDroidProxyFactoryModels,
  cancelDroidProxyInstall,
  cancelDroidProxyLogin,
  installDroidProxy,
  launchDroidProxy,
  requestDroidProxyStatus,
  startDroidProxyLogin,
} from '../lib/commands';
import { openExternal } from '../lib/onboarding';
import { useDroidProxy, type DroidProxyInstallState } from '../hooks/useDroidProxy';
import type {
  DroidProxyInstallPhase,
  DroidProxyProviderKey,
  DroidProxyProviderState,
  DroidProxyStatus,
} from '../types/bridge';
import { ModelIcon, type Provider } from './ModelIcon';
import { GroupLabel, SectionTitle, SettingRow } from './settingsKit';

const DROIDPROXY_RELEASES_URL =
  'https://github.com/anand-92/droidproxy/releases/latest/download/DroidProxy-arm64.zip';

const PROVIDER_LABELS: Record<DroidProxyProviderKey, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  antigravity: 'Gemini (Antigravity)',
  kimi: 'Kimi',
  junie: 'Junie',
  grok: 'Grok',
  copilot: 'GitHub Copilot',
  meta: 'Meta Muse',
};

const PROVIDER_ICONS: Record<DroidProxyProviderKey, Provider> = {
  claude: 'claude',
  codex: 'openai',
  antigravity: 'google',
  kimi: 'kimi',
  junie: 'junie',
  grok: 'xai',
  copilot: 'copilot',
  meta: 'meta',
};

const PROVIDER_ORDER: readonly DroidProxyProviderKey[] = [
  'claude',
  'codex',
  'antigravity',
  'kimi',
  'junie',
  'grok',
  'copilot',
  'meta',
];

const BUTTON_CLASS =
  'px-2.5 h-7 rounded-md bg-droid-elevated text-[12px] text-droid-text hover:bg-droid-active transition-colors disabled:opacity-40';

const INSTALL_PHASE_LABELS: Record<DroidProxyInstallPhase, string> = {
  downloading: 'Downloading',
  verifying: 'Verifying',
  installing: 'Installing',
  launching: 'Launching',
  applying: 'Applying models',
};

function installLabel(install: DroidProxyInstallState): string {
  const base = INSTALL_PHASE_LABELS[install.phase];
  if (install.phase !== 'downloading') return `${base}…`;
  if (install.totalBytes) {
    const percent = Math.round(((install.receivedBytes ?? 0) / install.totalBytes) * 100);
    return `${base}… ${String(percent)}%`;
  }
  if (install.receivedBytes) {
    const mb = install.receivedBytes / 1048576;
    return `${base}… ${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
  }
  return `${base}…`;
}

const INSTALL_UNAVAILABLE_COPY: Record<
  NonNullable<DroidProxyStatus['installUnavailable']>,
  string
> = {
  'unsupported-platform': 'DroidProxy is a macOS app, so it cannot be installed here.',
  'unsupported-arch':
    'DroidProxy ships Apple Silicon builds only, so it cannot be installed on this Mac.',
};

function appDescription(status: DroidProxyStatus, installError: string | null): string {
  if (status.appInstalled && installError)
    return `Installed, but setup did not finish: ${installError}`;
  if (status.appInstalled)
    return status.proxyRunning
      ? 'Installed and serving your subscriptions on localhost:8317.'
      : 'Installed. Launch it to serve your subscriptions.';
  if (status.installUnavailable) return INSTALL_UNAVAILABLE_COPY[status.installUnavailable];
  if (installError) return `Install failed: ${installError} Try again, or use manual download.`;
  return 'Not installed. One click installs and launches it; then connect below.';
}

function proxyDescription(status: { proxyRunning: boolean; backendRunning: boolean }): string {
  if (status.proxyRunning) return 'Running on localhost:8317.';
  if (status.backendRunning)
    return 'Backend is up but the proxy frontend is down. Relaunch DroidProxy.';
  return 'Not running. Launch DroidProxy to serve subscriptions.';
}

// Run coding-subscription models (Claude, Codex, Gemini, Kimi, …) inside Droid
// sessions through the DroidProxy app's local OAuth proxy.
export function DroidProxySettings() {
  const { status, loggingIn, install, installError } = useDroidProxy();

  if (!status) {
    return (
      <div>
        <SectionTitle
          title="DroidProxy"
          sub="Use subscription models in Droid sessions through a local proxy."
        />
        <div className="rounded-xl border border-droid-border bg-droid-surface divide-y divide-droid-border mb-8">
          <SettingRow label="DroidProxy" description="Detecting the app and its connections…">
            <span />
          </SettingRow>
        </div>
      </div>
    );
  }

  const connectedCount = status.providers.filter((row) => row.accounts.length > 0).length;
  const canCancelInstall = install?.phase === 'downloading' || install?.phase === 'verifying';
  let modelDescription: string;
  let modelActionLabel: string;
  if (status.factoryModelCount === 0) {
    modelDescription = 'No providers enabled. Remove previously applied proxy models from Droid.';
    modelActionLabel = 'Remove proxy models';
  } else if (status.factoryModelsInstalled) {
    modelDescription = `${String(status.factoryModelCount)} models applied. They show in the model picker with the DroidProxy mark.`;
    modelActionLabel = 'Re-apply';
  } else {
    modelDescription = `${String(status.factoryModelCount)} models ready. Droid sessions cannot see them until you apply.`;
    modelActionLabel = 'Apply';
  }

  return (
    <div>
      <SectionTitle
        title="DroidProxy"
        sub="Use subscription models in Droid sessions through a local proxy."
      />

      <div className="rounded-xl border border-droid-border bg-droid-surface divide-y divide-droid-border mb-8">
        <SettingRow label="DroidProxy app" description={appDescription(status, installError)}>
          {status.appInstalled ? (
            <button
              onClick={() => {
                launchDroidProxy();
              }}
              className={BUTTON_CLASS}
            >
              {status.proxyRunning ? 'Open app' : 'Launch'}
            </button>
          ) : install ? (
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-[12px] font-mono text-droid-text-muted">
                {installLabel(install)}
              </span>
              {canCancelInstall && (
                <button
                  onClick={() => {
                    cancelDroidProxyInstall();
                  }}
                  className={BUTTON_CLASS}
                >
                  Cancel
                </button>
              )}
            </div>
          ) : status.installUnavailable ? (
            <span />
          ) : (
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={() => {
                  void openExternal(DROIDPROXY_RELEASES_URL);
                }}
                className="text-[12px] text-droid-text-muted hover:text-droid-text transition-colors"
              >
                manual download
              </button>
              <button
                onClick={() => {
                  installDroidProxy();
                }}
                className={BUTTON_CLASS}
              >
                Install DroidProxy
              </button>
            </div>
          )}
        </SettingRow>
        <SettingRow label="Local proxy" description={proxyDescription(status)}>
          <div className="flex shrink-0 items-center gap-2">
            <span
              className={`text-[12px] font-mono ${status.proxyRunning ? 'text-droid-green' : 'text-droid-text-muted'}`}
            >
              {status.proxyRunning ? 'running' : 'stopped'}
            </span>
            <button
              onClick={() => {
                requestDroidProxyStatus();
              }}
              className={BUTTON_CLASS}
            >
              Refresh
            </button>
          </div>
        </SettingRow>
        <SettingRow label="Proxy models in Droid" description={modelDescription}>
          <button
            onClick={() => {
              applyDroidProxyFactoryModels();
            }}
            className={BUTTON_CLASS}
          >
            {modelActionLabel}
          </button>
        </SettingRow>
      </div>

      <GroupLabel>
        Subscriptions{connectedCount > 0 ? ` · ${String(connectedCount)} connected` : ''}
      </GroupLabel>
      <div className="rounded-xl border border-droid-border bg-droid-surface divide-y divide-droid-border mb-8">
        {PROVIDER_ORDER.map((provider) => {
          const row = status.providers.find((entry) => entry.provider === provider);
          if (!row) return null;
          return (
            <DroidProxyProviderRow
              key={provider}
              row={row}
              loggingIn={loggingIn === provider}
              loginBusy={loggingIn !== null && loggingIn !== provider}
              loginUnavailable={!status.loginBinaryAvailable}
            />
          );
        })}
      </div>

      <p className="text-[11px] leading-relaxed text-droid-text-muted">
        Connecting signs you in with the provider in your browser; DROIDEX only reads which accounts
        are connected, never tokens or keys. Applying writes proxy models into Factory settings with
        a timestamped backup first. Copilot model picks and Meta contributor mode live in the
        DroidProxy app itself.
      </p>
    </div>
  );
}

function DroidProxyProviderRow({
  row,
  loggingIn,
  loginBusy,
  loginUnavailable,
}: {
  row: DroidProxyProviderState;
  loggingIn: boolean;
  loginBusy: boolean;
  loginUnavailable: boolean;
}) {
  const label = PROVIDER_LABELS[row.provider];
  return (
    <SettingRow
      label={
        <span className="inline-flex items-center gap-2">
          <ModelIcon provider={PROVIDER_ICONS[row.provider]} size={15} />
          {label}
        </span>
      }
      description={<AccountDescription row={row} />}
    >
      <ProviderAction
        row={row}
        loggingIn={loggingIn}
        loginBusy={loginBusy}
        loginUnavailable={loginUnavailable}
      />
    </SettingRow>
  );
}

function AccountDescription({ row }: { row: DroidProxyProviderState }) {
  if (row.accounts.length === 0) {
    return <>{`Not connected.${row.enabled ? '' : ' Disabled in the DroidProxy app.'}`}</>;
  }
  return (
    <>
      {row.accounts.map((account, index) => (
        <span
          key={`${account.email ?? account.login ?? 'account'}-${String(index)}`}
          className="block truncate"
        >
          {account.email ?? account.login ?? 'Connected account'}
          {account.disabled ? ' · disabled' : null}
          {account.expired && Date.parse(account.expired) < Date.now() ? (
            <span className="text-droid-red"> · expired</span>
          ) : null}
        </span>
      ))}
      {!row.enabled && <span className="block truncate">Disabled in the DroidProxy app.</span>}
    </>
  );
}

function ProviderAction({
  row,
  loggingIn,
  loginBusy,
  loginUnavailable,
}: {
  row: DroidProxyProviderState;
  loggingIn: boolean;
  loginBusy: boolean;
  loginUnavailable: boolean;
}) {
  if (loggingIn) {
    return (
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-[12px] font-mono text-droid-text-muted">waiting…</span>
        <button
          onClick={() => {
            cancelDroidProxyLogin();
          }}
          className={BUTTON_CLASS}
        >
          Cancel
        </button>
      </div>
    );
  }
  if (!row.canLoginHere) {
    return <span className="text-[12px] text-droid-text-muted">Connect in the DroidProxy app</span>;
  }
  return (
    <button
      onClick={() => {
        startDroidProxyLogin(row.provider);
      }}
      disabled={loginBusy || loginUnavailable}
      title={loginUnavailable ? 'Install the DroidProxy app to connect here' : undefined}
      className={BUTTON_CLASS}
    >
      {row.accounts.length > 0 ? 'Add account' : 'Connect'}
    </button>
  );
}
