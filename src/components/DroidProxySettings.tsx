import { useId, useState } from 'react';
import { ChevronDown, LoaderCircle } from 'lucide-react';

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
  const { status, loggingIn, install, installError, pendingAccountId, updateAccount } =
    useDroidProxy();

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
              appInstalled={status.appInstalled}
              pendingAccountId={pendingAccountId}
              updateAccount={updateAccount}
            />
          );
        })}
      </div>

      <p className="text-[11px] leading-relaxed text-droid-text-muted">
        Connecting signs you in with the provider in your browser; DROIDEX displays account
        metadata, never tokens or keys. Applying writes proxy models into Factory settings with a
        timestamped backup first. Copilot model picks and Meta contributor mode live in the
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
  appInstalled,
  pendingAccountId,
  updateAccount,
}: {
  row: DroidProxyProviderState;
  loggingIn: boolean;
  loginBusy: boolean;
  loginUnavailable: boolean;
  appInstalled: boolean;
  pendingAccountId: string | null;
  updateAccount: (provider: DroidProxyProviderKey, id: string, enabled: boolean) => void;
}) {
  const label = PROVIDER_LABELS[row.provider];
  const [expanded, setExpanded] = useState(row.accounts.length > 0);
  const accountListId = useId();
  const heading = (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] text-droid-text">
        <ModelIcon provider={PROVIDER_ICONS[row.provider]} size={15} />
        <span>{label}</span>
        {row.accounts.length > 0 && (
          <span className="text-[11px] text-droid-text-muted">
            {row.accounts.length} {row.accounts.length === 1 ? 'account' : 'accounts'}
          </span>
        )}
      </div>
      {!row.enabled && (
        <p className="mt-0.5 text-[11px] text-droid-text-muted">Disabled in the DroidProxy app</p>
      )}
    </div>
  );
  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        {row.accounts.length > 0 ? (
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={accountListId}
            onClick={() => {
              setExpanded((current) => !current);
            }}
            className="group flex min-w-0 items-center gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-droid-accent/60"
          >
            {heading}
            <ChevronDown
              aria-hidden="true"
              className={`h-3.5 w-3.5 shrink-0 text-droid-text-muted transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${expanded ? 'rotate-180' : ''}`}
            />
          </button>
        ) : (
          heading
        )}
        <ProviderAction
          row={row}
          loggingIn={loggingIn}
          loginBusy={loginBusy}
          loginUnavailable={loginUnavailable}
          appInstalled={appInstalled}
        />
      </div>
      {row.accounts.length === 0 ? (
        <p className="mt-1 text-[11px] text-droid-text-muted">Not connected</p>
      ) : (
        <div
          id={accountListId}
          aria-hidden={!expanded}
          inert={!expanded}
          className={`grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
        >
          <div className="min-h-0 overflow-hidden">
            <AccountList
              row={row}
              pendingAccountId={pendingAccountId}
              updateAccount={updateAccount}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function AccountList({
  row,
  pendingAccountId,
  updateAccount,
}: {
  row: DroidProxyProviderState;
  pendingAccountId: string | null;
  updateAccount: (provider: DroidProxyProviderKey, id: string, enabled: boolean) => void;
}) {
  const enabledCount = row.accounts.filter((account) => !account.disabled).length;
  return (
    <div className="mt-2 space-y-0.5">
      {row.accounts.map((account, index) => (
        <DroidProxyAccountRow
          key={account.id ?? `${account.email ?? account.login ?? 'account'}-${String(index)}`}
          account={account}
          provider={row.provider}
          enabledCount={enabledCount}
          pendingAccountId={pendingAccountId}
          updateAccount={updateAccount}
        />
      ))}
    </div>
  );
}

function DroidProxyAccountRow({
  account,
  provider,
  enabledCount,
  pendingAccountId,
  updateAccount,
}: {
  account: DroidProxyProviderState['accounts'][number];
  provider: DroidProxyProviderKey;
  enabledCount: number;
  pendingAccountId: string | null;
  updateAccount: (provider: DroidProxyProviderKey, id: string, enabled: boolean) => void;
}) {
  const label = account.email ?? account.login ?? 'Connected account';
  const lastEnabled = !account.disabled && enabledCount <= 1;
  const pending = pendingAccountId === account.id;
  const action = account.disabled ? 'Enable' : 'Disable';
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 transition-colors duration-200 ease-out hover:bg-droid-elevated/60 motion-reduce:transition-none">
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 shrink-0 rounded-full transition-colors duration-200 motion-reduce:transition-none ${account.disabled ? 'bg-droid-text-muted/50' : 'bg-droid-orange'}`}
      />
      <span
        className={`min-w-0 flex-1 truncate text-[11px] transition-colors duration-200 motion-reduce:transition-none ${account.disabled ? 'text-droid-text-muted line-through' : 'text-droid-text-secondary'}`}
        title={label}
      >
        {label}
      </span>
      {account.expired && Date.parse(account.expired) < Date.now() && (
        <span className="shrink-0 text-[10px] text-droid-red">Expired</span>
      )}
      {account.id && (
        <button
          type="button"
          onClick={() => {
            if (account.id) updateAccount(provider, account.id, account.disabled);
          }}
          disabled={pendingAccountId !== null || lastEnabled}
          aria-label={`${action} ${label}`}
          title={lastEnabled ? 'Keep at least one account enabled' : undefined}
          className="inline-flex min-h-8 shrink-0 items-center rounded-md px-2 text-[11px] font-medium text-droid-orange transition-colors duration-200 ease-out hover:bg-droid-orange/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-droid-accent/60 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none"
        >
          {pending ? (
            <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 motion-safe:animate-spin" />
          ) : (
            action
          )}
        </button>
      )}
    </div>
  );
}

function ProviderAction({
  row,
  loggingIn,
  loginBusy,
  loginUnavailable,
  appInstalled,
}: {
  row: DroidProxyProviderState;
  loggingIn: boolean;
  loginBusy: boolean;
  loginUnavailable: boolean;
  appInstalled: boolean;
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
    return (
      <button
        onClick={() => {
          launchDroidProxy();
        }}
        disabled={loginBusy || !appInstalled}
        className={BUTTON_CLASS}
        title="Open DroidProxy's connection flow"
      >
        {row.accounts.length > 0 ? 'Manage in app' : 'Open to connect'}
      </button>
    );
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
