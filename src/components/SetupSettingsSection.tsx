import { useEffect, useState } from 'react';
import { useOnboarding } from '../hooks/useOnboarding';
import { useStoreSelector } from '../hooks/useStore';
import { getAppVersion, type AppUpdateInfo } from '../lib/onboarding';
import { refreshAppUpdate, requestAppUpdate } from '../lib/appUpdate';
import { hasActiveSessionWork } from '../lib/sessions';
import { Switch } from './Switch';
import { HarnessCliSettings } from './HarnessCliSettings';
import { GroupLabel, SectionTitle, SettingRow } from './settingsKit';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';

export function SetupSettingsSection({ onClose }: { onClose: () => void }) {
  const onboard = useOnboarding();
  const { env, onboarding, installing } = onboard;
  const [appVersion, setAppVersion] = useState('');
  const [update, setUpdate] = useState<AppUpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const hasActiveWork = useStoreSelector(hasActiveSessionWork);

  useEffect(() => {
    void getAppVersion().then(setAppVersion);
  }, []);

  const cliAuto = onboarding?.cliAutoUpdate ?? true;
  const appAuto = onboarding?.appAutoUpdate ?? true;
  const signedIn = Boolean(env?.auth.loginPresent) || Boolean(env?.auth.apiKeyConfigured);

  const runCheck = async () => {
    setChecking(true);
    // Publish to the shared store so a found update also lights up the sidebar
    // pill, while keeping the full result locally for the up-to-date/error text.
    const info = await refreshAppUpdate({ interactive: true, automaticChecks: appAuto });
    setUpdate(info);
    setChecking(false);
  };

  // Sparkle owns its asynchronous result window. electron-updater returns the
  // manifest version directly, including an empty value when its fetch fails.
  const updateStatus = !update
    ? `Installed v${appVersion}`
    : update.installMode === 'sparkle'
      ? 'Update window opened'
      : update.updateAvailable
        ? `${update.latest} available`
        : update.latest
          ? 'Up to date'
          : "Couldn't check for updates";

  return (
    <div className="max-w-2xl mx-auto">
      <SectionTitle
        title="Setup & updates"
        sub="Manage the Droid, Claude Code, and Codex CLIs, your sign-in, and app updates."
      />

      <GroupLabel>Droid CLI</GroupLabel>
      <div className="rounded-xl bg-surface shadow-lg mb-8">
        <SettingRow
          label="CLI status"
          description={env?.cli.present ? env.cli.path : 'Not detected on this machine.'}
        >
          <div className="flex items-center gap-2">
            <span className="text-body tabular-nums text-muted">
              {env?.cli.present ? (env.cli.version ?? 'installed') : 'missing'}
            </span>
            <Button
              size="sm"
              onClick={() => {
                onboard.update(onboarding?.installChannel);
              }}
              disabled={!!installing || !env?.cli.present}
            >
              {installing === 'update' ? 'Updating…' : 'Update'}
            </Button>
          </div>
        </SettingRow>
        <SettingRow label="Keep the CLI up to date" description="Updates silently on launch.">
          <Switch
            label="Keep the CLI up to date"
            checked={cliAuto}
            onChange={(v) => void onboard.patch({ cliAutoUpdate: v })}
          />
        </SettingRow>
        <SettingRow
          label="Sign-in"
          description={
            signedIn
              ? 'Connected to Factory.'
              : env?.cli.present
                ? 'Sign in so models can run.'
                : 'Install the Droid CLI before signing in.'
          }
        >
          {signedIn ? (
            <Badge tone="success">Signed in</Badge>
          ) : (
            <Button
              size="sm"
              onClick={onboard.refreshEnv}
              disabled={!env?.cli.present}
              title={env?.cli.present ? undefined : 'The Droid CLI must be installed first.'}
            >
              Refresh status
            </Button>
          )}
        </SettingRow>
      </div>

      <GroupLabel>Claude Code and Codex</GroupLabel>
      <HarnessCliSettings
        autoUpdate={onboarding?.harnessCliAutoUpdate ?? true}
        onAutoUpdateChange={(enabled) => void onboard.patch({ harnessCliAutoUpdate: enabled })}
      />

      <GroupLabel>DROIDEX app</GroupLabel>
      <div className="rounded-xl bg-surface shadow-lg mb-8">
        <SettingRow label="Current version" description={updateStatus}>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => {
                void runCheck();
              }}
              disabled={checking}
            >
              {checking ? 'Checking…' : 'Check for updates'}
            </Button>
            {update?.updateAvailable && update.installMode !== 'sparkle' && (
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  void requestAppUpdate(update, hasActiveWork);
                }}
              >
                Download update…
              </Button>
            )}
          </div>
        </SettingRow>
        <SettingRow
          label="Check for DROIDEX updates"
          description="Checks automatically. Installation always requires your approval."
        >
          <Switch
            label="Check for DROIDEX updates"
            checked={appAuto}
            onChange={(v) => void onboard.patch({ appAutoUpdate: v })}
          />
        </SettingRow>
      </div>

      <GroupLabel>Onboarding</GroupLabel>
      <div className="rounded-xl bg-surface shadow-lg">
        <SettingRow label="Run setup again" description="Re-open the first-run setup tour.">
          <Button
            size="sm"
            onClick={() => {
              window.dispatchEvent(new CustomEvent('droid:open-onboarding'));
              onClose();
            }}
          >
            Run setup
          </Button>
        </SettingRow>
      </div>
    </div>
  );
}
