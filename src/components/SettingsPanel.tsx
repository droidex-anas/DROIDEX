import { RemoteSettings } from './RemoteSettings';
import { RemoteBrowserSettings } from './RemoteBrowserSettings';
import { ProfileSettings } from './ProfileSettings';
import { useRemoteAccess } from '../features/remote/useRemoteAccess';
import { shallowEqual, useStoreDispatch, useStoreSelector } from '../hooks/useStore';
import type { SideChatDefaultPlacement } from '../hooks/persistedUiPreferences';
import { ChevronLeft, Search, X } from '@droidex/icons';
import { useEffect, useState } from 'react';
import AutonomySelector from './AutonomySelector';
import { useOnboarding } from '../hooks/useOnboarding';
import { Switch } from './Switch';
import { getAppVersion, type AppUpdateInfo } from '../lib/onboarding';
import { refreshAppUpdate, requestAppUpdate } from '../lib/appUpdate';
import { isRemoteClient } from '../lib/desktop';
import { hasActiveSessionWork } from '../lib/sessions';
import { GeneralSettingsSection } from './GeneralSettingsSection';
import { AppearanceSection } from './AppearanceSettings';
import { DiagnosticsSettings } from './DiagnosticsSettings';
import { DroidProxySettings } from './DroidProxySettings';
import { KeyboardShortcutsSettings } from './KeyboardShortcutsSettings';
import { McpServersSettings } from './McpServersSettings';
import { NotificationsSettings } from './NotificationsSettings';
import { WorktreesSettings } from './WorktreesSettings';
import { Dropdown, GroupLabel, SectionTitle, SettingRow } from './settingsKit';
import { HarnessCliSettings } from './HarnessCliSettings';
import { HarnessModelSettings } from './HarnessModelSettings';
import { ArchivedChatsSettings } from './ArchivedChatsSettings';
import {
  bestTabForQuery,
  NO_HIDDEN_TABS,
  searchSettings,
  tabMatchesQuery,
  type SettingsSearchHit,
} from '../lib/settingsSearch';
import { ToolActivitySettings } from './ToolActivitySettings';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { Input } from './ui/Field';
import { Row } from './ui/Row';

interface NavItem {
  label: string;
}
const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: 'Personal',
    items: [
      { label: 'General' },
      { label: 'Setup & updates' },
      { label: 'Profile' },
      { label: 'Remote' },
      { label: 'Appearance' },
      { label: 'Notifications' },
      { label: 'Configuration' },
      { label: 'Personalization' },
      { label: 'Keyboard shortcuts' },
      { label: 'Usage & billing' },
      { label: 'Privacy & diagnostics' },
    ],
  },
  {
    group: 'Integrations',
    items: [
      { label: 'Snapshots' },
      { label: 'MCP servers' },
      { label: 'Browser' },
      { label: 'DroidProxy' },
    ],
  },
  {
    group: 'Coding',
    items: [
      { label: 'Hooks' },
      { label: 'Connections' },
      { label: 'Git' },
      { label: 'Environments' },
      { label: 'Worktrees' },
    ],
  },
  {
    group: 'Archived',
    items: [{ label: 'Archived chats' }],
  },
];
// The public profile is published with the laptop's Remote identity, which a
// paired browser cannot use.
const LAPTOP_ONLY_TABS: ReadonlySet<string> = new Set(['Profile']);

function SetupSection({ onClose }: { onClose: () => void }) {
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

/* ── configuration content ── */
function ConfigurationSection() {
  const dispatch = useStoreDispatch();
  const defaultAutonomy = useStoreSelector((state) => state.defaultAutonomy);
  const sideChatPlacement = useStoreSelector((state) => state.sideChatDefaultPlacement);
  return (
    <div className="max-w-2xl mx-auto">
      <SectionTitle title="Configuration" />
      <GroupLabel>Default models</GroupLabel>
      <HarnessModelSettings />
      <GroupLabel>Transcript</GroupLabel>
      <ToolActivitySettings />
      <GroupLabel>Sessions</GroupLabel>
      <div className="rounded-xl bg-surface shadow-lg mb-8">
        <SettingRow
          label="Default autonomy"
          description="How much new sessions may do without asking. The composer can override it for a single session."
        >
          <AutonomySelector
            scope="settings"
            value={defaultAutonomy}
            placement="bottom-end"
            onSelect={(level) => {
              dispatch({ type: 'SET_DEFAULT_AUTONOMY', autonomy: level });
            }}
          />
        </SettingRow>
        <SettingRow
          label="Side chats open in"
          description="Where /btw and /side open a new side chat: the side pane beside the chat, or a popup window over it. Either can be moved once it is open."
        >
          <Dropdown
            ariaLabel="Side chats open in"
            value={sideChatPlacement}
            width="w-44"
            options={[
              { value: 'docked', label: 'Side pane' },
              { value: 'floating', label: 'Popup window' },
            ]}
            onChange={(placement) => {
              dispatch({
                type: 'SET_SIDE_CHAT_DEFAULT_PLACEMENT',
                placement: placement as SideChatDefaultPlacement,
              });
            }}
          />
        </SettingRow>
      </div>
    </div>
  );
}

function LaptopOnlySection({ title }: { title: string }) {
  return (
    <div className="max-w-2xl mx-auto">
      <SectionTitle title={title} />
      <p className="text-body text-secondary">
        Open DROIDEX on your laptop to change {title} settings.
      </p>
    </div>
  );
}

function PlaceholderSection({ title }: { title: string }) {
  return (
    <div className="max-w-2xl mx-auto">
      <SectionTitle title={title} />
      <div className="rounded-xl bg-surface p-10 text-center">
        <p className="text-body text-secondary">{title} settings are coming soon.</p>
      </div>
    </div>
  );
}

/** Soft jump list above the active section while a search is active. */
function SettingsSearchResults({
  hits,
  activeTab,
  onOpen,
}: {
  hits: SettingsSearchHit[];
  activeTab: string;
  onOpen: (hit: SettingsSearchHit) => void;
}) {
  return (
    <div className="mx-auto mb-8 max-w-2xl">
      <div className="mb-2 px-3 text-caption text-muted">
        {hits.length === 1 ? '1 match' : `${String(hits.length)} matches`}
      </div>
      <div className="flex flex-col">
        {hits.map((hit) => {
          const onActiveTab = hit.tab === activeTab;
          return (
            <button
              key={`${hit.tab}::${hit.label}`}
              type="button"
              onClick={() => {
                onOpen(hit);
              }}
              className={`group flex w-full select-none items-center justify-between gap-3 rounded-md px-3 py-2 text-left transition-colors duration-150 ease-out ${
                onActiveTab ? 'bg-active' : 'hover:bg-elevated'
              }`}
            >
              <div className="min-w-0">
                <div className="truncate text-body-strong text-primary">{hit.label}</div>
                <div className="mt-0.5 truncate text-caption text-muted">{hit.tab}</div>
              </div>
              <span
                className={`shrink-0 text-caption transition-opacity ${
                  onActiveTab ? 'text-muted' : 'text-muted/0 group-hover:text-muted'
                }`}
              >
                {onActiveTab ? 'Here' : 'Open'}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── main full-page settings ── */
export default function SettingsPanel() {
  const dispatch = useStoreDispatch();
  const { mcpCwd } = useStoreSelector((state) => {
    const activeSession = state.activeAppSessionId
      ? state.sessions[state.activeAppSessionId]
      : undefined;
    return {
      mcpCwd: activeSession?.cwd ?? state.workspaceCwds[0],
    };
  }, shallowEqual);
  const request = useStoreSelector((state) => state.settingsRequest);
  const [active, setActive] = useState<string>(request?.tab ?? 'General');
  const [query, setQuery] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dispatch({ type: 'TOGGLE_SETTINGS' });
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [dispatch]);

  const close = () => {
    dispatch({ type: 'TOGGLE_SETTINGS' });
  };
  const q = query.trim();
  const remote = isRemoteClient();
  const hiddenTabs = remote ? LAPTOP_ONLY_TABS : NO_HIDDEN_TABS;
  const showsTab = (label: string) => !hiddenTabs.has(label);
  const hits = searchSettings(q, hiddenTabs);

  // Content-aware search: typing "play sound" jumps to Notifications so the
  // matching controls are on screen (nav filter alone only matched tab titles).
  const changeQuery = (next: string) => {
    setQuery(next);
    const bestTab = bestTabForQuery(next, hiddenTabs);
    if (bestTab) setActive(bestTab);
  };
  let content: React.ReactNode;
  switch (showsTab(active) ? active : 'Laptop only') {
    case 'Laptop only':
      content = <LaptopOnlySection title={active} />;
      break;
    case 'Profile':
      content = <ProfileSection />;
      break;
    case 'Remote':
      content = remote ? (
        <RemoteBrowserSettings />
      ) : (
        <RemoteSettings claimUsername={request?.step === 'claim-username'} />
      );
      break;
    case 'Appearance':
      content = <AppearanceSection />;
      break;
    case 'General':
      content = <GeneralSettingsSection />;
      break;
    case 'Setup & updates':
      content = <SetupSection onClose={close} />;
      break;
    case 'Worktrees':
      content = <WorktreesSettings />;
      break;
    case 'Configuration':
      content = <ConfigurationSection />;
      break;
    case 'Notifications':
      content = <NotificationsSettings highlightQuery={q} />;
      break;
    case 'Privacy & diagnostics':
      content = <DiagnosticsSettings />;
      break;
    case 'MCP servers':
      content = <McpServersSettings cwd={mcpCwd} />;
      break;
    case 'DroidProxy':
      content = <DroidProxySettings />;
      break;
    case 'Keyboard shortcuts':
      content = <KeyboardShortcutsSettings />;
      break;
    case 'Archived chats':
      content = <ArchivedChatsSettings />;
      break;
    default:
      content = <PlaceholderSection title={active} />;
  }

  const openHit = (hit: SettingsSearchHit) => {
    setActive(hit.tab);
  };

  return (
    <>
      {/* Left nav */}
      <aside className="w-60 shrink-0 flex flex-col bg-surface/40">
        {/* Traffic-light clearance */}
        <div data-electron-drag-region className="h-9 shrink-0" />
        <button
          onClick={close}
          className="flex h-10 shrink-0 select-none items-center gap-1.5 px-4 text-label text-secondary transition-colors hover:text-primary"
        >
          <ChevronLeft aria-hidden="true" className="size-icon-md" /> Back to app
        </button>
        <div className="px-2 pb-3">
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 size-icon-sm -translate-y-1/2 text-muted"
            />
            <Input
              aria-label="Search settings"
              value={query}
              onChange={(e) => {
                changeQuery(e.target.value);
              }}
              placeholder="Search settings…"
              className="pl-8 pr-9"
            />
            {q ? (
              <span className="absolute inset-y-0 right-1 flex items-center">
                <Button
                  variant="ghost"
                  size="sm"
                  icon={X}
                  aria-label="Clear search"
                  onClick={() => {
                    setQuery('');
                  }}
                />
              </span>
            ) : null}
          </div>
        </div>
        <nav className="flex-1 space-y-4 overflow-y-auto px-2 pb-3">
          {NAV.map(({ group, items }) => {
            const filtered = items.filter(
              (it) => showsTab(it.label) && tabMatchesQuery(it.label, q),
            );
            if (filtered.length === 0) return null;
            return (
              <div key={group}>
                <div className="mb-1 select-none px-3 text-label text-muted">{group}</div>
                <div className="flex flex-col">
                  {filtered.map(({ label }) => (
                    <Row
                      key={label}
                      label={label}
                      active={active === label}
                      aria-current={active === label ? 'page' : undefined}
                      onClick={() => {
                        setActive(label);
                      }}
                    />
                  ))}
                </div>
              </div>
            );
          })}
          {q && hits.length === 0 && (
            <div className="px-3 py-4 text-body text-muted">No matching settings.</div>
          )}
        </nav>
      </aside>

      {/* Content */}
      <div className="flex-1 overflow-y-auto [scrollbar-gutter:stable]">
        <div className="px-10 py-8">
          {q && hits.length > 0 && (
            <SettingsSearchResults hits={hits} activeTab={active} onOpen={openHit} />
          )}
          {content}
        </div>
      </div>
    </>
  );
}

function ProfileSection() {
  const { state, error } = useRemoteAccess();
  if (!state) return <p className="text-body text-muted">{error || 'Loading profile…'}</p>;
  return (
    <ProfileSettings
      publishingReady={Boolean(state.pairingUrl)}
      usernameLocked={state.authenticatorReady}
      profile={state.profile}
      webClientUrl={state.clientUrl.trim() || 'https://droidex.vercel.app'}
      onProfileChange={(profile) => {
        const api = window.droidex;
        if (!api) return Promise.reject(new Error('Open the desktop app to edit your profile.'));
        return api.configureRemote({ profile });
      }}
    />
  );
}
