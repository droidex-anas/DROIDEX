import { RemoteSettings } from './RemoteSettings';
import { RemoteBrowserSettings } from './RemoteBrowserSettings';
import { ProfileSettings } from './ProfileSettings';
import { useRemoteAccess } from '../features/remote/useRemoteAccess';
import { shallowEqual, useStoreDispatch, useStoreSelector } from '../hooks/useStore';
import type { SideChatDefaultPlacement } from '../hooks/persistedUiPreferences';
import { ChevronLeft, Search, X } from '@droidex/icons';
import { useEffect, useState } from 'react';
import AutonomySelector from './AutonomySelector';
import { isRemoteClient } from '../lib/desktop';
import { GeneralSettingsSection } from './GeneralSettingsSection';
import { SetupSettingsSection } from './SetupSettingsSection';
import { AppearanceSection } from './AppearanceSettings';
import { DiagnosticsSettings } from './DiagnosticsSettings';
import { DroidProxySettings } from './DroidProxySettings';
import { KeyboardShortcutsSettings } from './KeyboardShortcutsSettings';
import { McpServersSettings } from './McpServersSettings';
import { NotificationsSettings } from './NotificationsSettings';
import { WorktreesSettings } from './WorktreesSettings';
import { Dropdown, GroupLabel, SectionTitle, SettingRow } from './settingsKit';
import { HarnessModelSettings } from './HarnessModelSettings';
import { ArchivedChatsSettings } from './ArchivedChatsSettings';
import {
  bestTabForQuery,
  NO_HIDDEN_TABS,
  searchSettings,
  tabMatchesQuery,
  type SettingsSearchHit,
  type SettingsTab,
} from '../lib/settingsSearch';
import { ToolActivitySettings } from './ToolActivitySettings';
import { Button } from './ui/Button';
import { Input } from './ui/Field';
import { Row } from './ui/Row';

interface NavItem {
  label: SettingsTab;
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
      { label: 'Keyboard shortcuts' },
      { label: 'Privacy & diagnostics' },
    ],
  },
  {
    group: 'Integrations',
    items: [{ label: 'MCP servers' }, { label: 'DroidProxy' }],
  },
  {
    group: 'Coding',
    items: [{ label: 'Worktrees' }],
  },
  {
    group: 'Archived',
    items: [{ label: 'Archived chats' }],
  },
];
// The public profile is published with the laptop's Remote identity, which a
// paired browser cannot use.
const LAPTOP_ONLY_TABS: ReadonlySet<SettingsTab> = new Set(['Profile']);

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

/** Soft jump list above the active section while a search is active. */
function SettingsSearchResults({
  hits,
  activeTab,
  onOpen,
}: {
  hits: SettingsSearchHit[];
  activeTab: SettingsTab;
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
  const [active, setActive] = useState<SettingsTab>(request?.tab ?? 'General');
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
  const showsTab = (label: SettingsTab) => !hiddenTabs.has(label);
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
      content = <SetupSettingsSection onClose={close} />;
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
