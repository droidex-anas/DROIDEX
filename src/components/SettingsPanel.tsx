import {
  shallowEqual,
  useStoreDispatch,
  useStoreSelector,
  type ImagePasteQuality,
} from '../hooks/useStore';
import type { DiffStyle } from '../hooks/persistedThemePreferences';
import type {
  DiffViewMode,
  LiveEnterBehavior,
  ModelSelectorStyle,
  SideChatDefaultPlacement,
} from '../hooks/persistedUiPreferences';
import { ChevronLeft, ChevronDown, Search, Check, X, Plus } from '@droidex/icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import AutonomySelector from './AutonomySelector';
import { ModelIcon, providerOf } from './ModelIcon';
import type { ModelInfo, VoiceNarration } from '../types/bridge';
import { useOnboarding } from '../hooks/useOnboarding';
import { Switch } from './Switch';
import { getAppVersion, openExternal, type AppUpdateInfo } from '../lib/onboarding';
import cursorDesign from './browser/browserAgentCursorDesign.json';
import { refreshAppUpdate, requestAppUpdate } from '../lib/appUpdate';
import { hasActiveSessionWork } from '../lib/sessions';
import { applyTheme } from '../lib/theme';
import { AppearanceSection } from './AppearanceSettings';
import { DiagnosticsSettings } from './DiagnosticsSettings';
import { DroidProxySettings } from './DroidProxySettings';
import { KeyboardShortcutsSettings } from './KeyboardShortcutsSettings';
import { McpServersSettings } from './McpServersSettings';
import { NotificationsSettings } from './NotificationsSettings';
import { WorktreesSettings } from './WorktreesSettings';
import { Dropdown, GroupLabel, SectionTitle, SettingRow, type DropdownOption } from './settingsKit';
import { HardwareAccelerationSetting } from './HardwareAccelerationSetting';
import { HarnessCliSettings } from './HarnessCliSettings';
import { HarnessModelSettings } from './HarnessModelSettings';
import { ArchivedChatsSettings } from './ArchivedChatsSettings';
import {
  bestTabForQuery,
  searchSettings,
  tabMatchesQuery,
  type SettingsSearchHit,
} from '../lib/settingsSearch';
import { ToolActivitySettings } from './ToolActivitySettings';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { Input } from './ui/Field';
import { Popover } from './ui/Popover';
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

/* ── compaction token limit helpers ── */
// Format a raw token count for display: 200000 → "200K", 1500000 → "1.5M".
function formatTokenLimit(n: number): string {
  if (n >= 1_000_000) return `${String(Number((n / 1_000_000).toFixed(2)))}M`;
  if (n >= 1_000) return `${String(Number((n / 1_000).toFixed(2)))}K`;
  return String(n);
}

const TOKEN_PRESETS = [
  100_000, 200_000, 250_000, 300_000, 400_000, 500_000, 600_000, 700_000, 800_000, 900_000,
  1_000_000,
];
const RECOMMENDED_LIMIT = 250_000;

/* ── voice ── */
// The voices Codex's realtime thread speaks with. A voice session publishes the
// harness's own list when it opens; this picker only has to name them, and the
// empty value leaves the choice to the harness.
// The harness names its own voices, and it only answers while a chat is live,
// so Settings offers the ones it last reported. A voice chosen before, and no
// longer offered, stays in the list rather than reading as no choice at all.
function voiceOptions(known: string[], chosen: string): DropdownOption[] {
  const voices = chosen && !known.includes(chosen) ? [...known, chosen] : known;
  return [
    { value: '', label: 'Harness default' },
    ...voices.map((voice) => ({
      value: voice,
      label: voice.charAt(0).toUpperCase() + voice.slice(1),
    })),
  ];
}

// Themed preset picker for compaction token limits. Empty/"Factory default"
// lets Droid use its model-dependent compaction threshold.
function TokenLimitSelect({
  value,
  onSelect,
  width = 'w-40',
}: {
  value?: number;
  onSelect: (n?: number) => void;
  width?: string;
}) {
  const limits =
    value === undefined || TOKEN_PRESETS.includes(value)
      ? TOKEN_PRESETS
      : [value, ...TOKEN_PRESETS];

  return (
    <Dropdown
      ariaLabel="Compaction token limit"
      value={value === undefined ? '' : String(value)}
      width={width}
      options={[
        { value: '', label: 'Factory default' },
        ...limits.map((limit) => ({
          value: String(limit),
          label: `${formatTokenLimit(limit)}${limit === RECOMMENDED_LIMIT ? ' (recommended)' : ''}`,
        })),
      ]}
      onChange={(next) => {
        onSelect(next === '' ? undefined : Number(next));
      }}
    />
  );
}

/* ── compaction model picker (collapsed trigger + searchable popover) ── */
function CompactionModelPicker({
  selected,
  models,
  onSelect,
}: {
  selected: string;
  models: ModelInfo[];
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
  }, []);

  const isCurrent = selected === 'current-model';
  const selModel = isCurrent ? undefined : models.find((m) => m.id === selected);
  const label = isCurrent ? 'Current model' : (selModel?.displayName ?? selected);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? models.filter(
        (m) => m.displayName.toLowerCase().includes(q) || m.id.toLowerCase().includes(q),
      )
    : models;

  const choose = (id: string) => {
    onSelect(id);
    close();
  };

  const Option = ({
    id,
    label: l,
    sub,
    current,
  }: {
    id: string;
    label: string;
    sub?: string;
    current?: boolean;
  }) => {
    const active = selected === id;
    return (
      <button
        type="button"
        onClick={() => {
          choose(id);
        }}
        className={`flex w-full select-none items-center gap-2 rounded-md px-2 py-1.5 text-left ${
          active ? 'bg-active' : 'hover:bg-elevated dark:hover:bg-active'
        }`}
      >
        {!current && (
          <ModelIcon
            provider={providerOf(
              models.find((m) => m.id === id),
              id,
            )}
            size={16}
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-body text-primary">{l}</div>
          {sub && <div className="truncate text-caption text-muted">{sub}</div>}
        </div>
        {active && <Check aria-hidden="true" className="size-icon-sm shrink-0 text-accent" />}
      </button>
    );
  };

  return (
    <div className="shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          if (open) close();
          else setOpen(true);
        }}
        className={`flex h-control-md select-none items-center gap-2 rounded-md px-3 text-body text-primary transition-colors duration-150 ease-out ${
          open ? 'bg-active' : 'bg-elevated hover:bg-active'
        }`}
      >
        {!isCurrent && <ModelIcon provider={providerOf(selModel, selected)} size={14} />}
        <span className="max-w-40 truncate">{label}</span>
        <ChevronDown
          aria-hidden="true"
          className={`size-icon-sm text-muted transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      <Popover
        open={open}
        onClose={close}
        anchorRef={triggerRef}
        label="Compaction model"
        placement="bottom-end"
        width={288}
      >
        <div className="p-1.5">
          <Input
            autoFocus
            aria-label="Search models"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
            }}
            placeholder="Search models…"
            spellCheck={false}
          />
        </div>
        <div className="min-h-0 overflow-y-auto px-1.5 pb-1.5">
          <Option
            id="current-model"
            label="Current model"
            sub="Use whatever model the session runs"
            current
          />
          {filtered.map((m) => (
            <Option key={m.id} id={m.id} label={m.displayName} sub={m.provider} />
          ))}
          {filtered.length === 0 && (
            <div className="px-2 py-4 text-center text-body text-muted">No models match.</div>
          )}
        </div>
      </Popover>
    </div>
  );
}

/* ── general content ── */
function GeneralSection() {
  const dispatch = useStoreDispatch();
  const state = useStoreSelector(
    (current) => ({
      compactionModel: current.compactionModel,
      compactionTokenLimit: current.compactionTokenLimit,
      compactionTokenLimitPerModel: current.compactionTokenLimitPerModel,
      models: current.models,
      liveEnterBehavior: current.liveEnterBehavior,
      imagePasteQuality: current.imagePasteQuality,
      defaultVoice: current.defaultVoice,
      knownVoices: current.knownVoices,
      narrationMode: current.narrationMode,
      diffView: current.diffView,
      theme: current.theme,
    }),
    shallowEqual,
  );
  const selected = state.compactionModel || 'current-model';

  const setCompaction = (value: string) => {
    dispatch({ type: 'SET_COMPACTION_MODEL_GLOBAL', compactionModel: value });
  };

  const setGlobalLimit = (limit?: number) => {
    dispatch({ type: 'SET_COMPACTION_TOKEN_LIMIT_GLOBAL', limit });
  };

  const setModelLimit = (modelId: string, limit?: number) => {
    dispatch({ type: 'SET_COMPACTION_TOKEN_LIMIT_FOR_MODEL', modelId, limit });
  };

  const overrideEntries = Object.entries(state.compactionTokenLimitPerModel);
  const availableForOverride = state.models.filter(
    (m) => !(m.id in state.compactionTokenLimitPerModel),
  );
  const modelLabel = (id: string) => state.models.find((m) => m.id === id)?.displayName ?? id;
  const defaultLimitLabel =
    state.compactionTokenLimit !== undefined
      ? `the ${formatTokenLimit(state.compactionTokenLimit)}-token default limit`
      : "Factory's model-dependent default limit";

  return (
    <div className="max-w-2xl mx-auto">
      <SectionTitle
        title="General"
        sub="Defaults that apply across chats and Mission Control sessions."
      />

      <GroupLabel>Composer</GroupLabel>
      <div className="rounded-xl bg-surface shadow-lg divide-y divide-divider mb-8">
        <SettingRow
          label="Enter while working"
          description="What Enter does while the agent works. Steer hands the message to the agent at its next step; Queue sends it after the turn. Cmd/Ctrl+Enter does the other."
        >
          <Dropdown
            ariaLabel="Enter while working"
            value={state.liveEnterBehavior}
            width="w-44"
            options={[
              { value: 'steer', label: 'Steer message' },
              { value: 'queue', label: 'Queue message' },
            ]}
            onChange={(behavior) => {
              dispatch({
                type: 'SET_LIVE_ENTER_BEHAVIOR',
                behavior: behavior as LiveEnterBehavior,
              });
            }}
          />
        </SettingRow>
        <SettingRow
          label="Image paste quality"
          description="How pasted or dropped images are encoded for the model. Original keeps the exact pixels; smaller tiers save context tokens."
        >
          <Dropdown
            ariaLabel="Image paste quality"
            value={state.imagePasteQuality}
            width="w-52"
            options={[
              { value: 'original', label: 'Original · exact bytes' },
              { value: 'high', label: 'High · 2048px PNG' },
              { value: 'compact', label: 'Compact · 1568px JPEG' },
            ]}
            onChange={(quality) => {
              dispatch({
                type: 'SET_IMAGE_PASTE_QUALITY',
                quality: quality as ImagePasteQuality,
              });
            }}
          />
        </SettingRow>
      </div>

      <GroupLabel>Voice</GroupLabel>
      <div className="rounded-xl bg-surface shadow-lg divide-y divide-divider mb-8">
        <SettingRow
          label="Voice"
          description="Which voice speaks in voice mode. The harness offers the list; leave this on its default to take whichever voice it picks."
        >
          <Dropdown
            ariaLabel="Voice"
            value={state.defaultVoice}
            width="w-44"
            options={voiceOptions(state.knownVoices, state.defaultVoice)}
            onChange={(voice) => {
              dispatch({ type: 'SET_DEFAULT_VOICE', voice });
            }}
          />
        </SettingRow>
        <SettingRow
          label="While it works"
          description="What you hear once a spoken request starts a turn — a short acknowledgement, or a running account of the work."
        >
          <Dropdown
            ariaLabel="While it works"
            value={state.narrationMode}
            width="w-52"
            options={[
              { value: 'brief', label: 'Brief acknowledgement' },
              { value: 'commentary', label: 'Narrate the work' },
            ]}
            onChange={(mode) => {
              dispatch({ type: 'SET_NARRATION_MODE', mode: mode as VoiceNarration });
            }}
          />
        </SettingRow>
      </div>

      <GroupLabel>Diff display</GroupLabel>
      <div className="rounded-xl bg-surface shadow-lg divide-y divide-divider mb-8">
        <SettingRow
          label="Diff view"
          description="How file diffs render in the Review tab — one column or side-by-side."
        >
          <Dropdown
            ariaLabel="Diff view"
            value={state.diffView}
            width="w-44"
            options={[
              { value: 'unified', label: 'Unified' },
              { value: 'split', label: 'Split' },
            ]}
            onChange={(mode) => {
              dispatch({ type: 'SET_DIFF_VIEW', mode: mode as DiffViewMode });
            }}
          />
        </SettingRow>
        <SettingRow
          label="Diff theme"
          description="Choose a softer GitHub-style tint or a stronger focused change treatment."
        >
          <Dropdown
            ariaLabel="Diff theme"
            value={state.theme.diffStyle}
            width="w-44"
            options={[
              { value: 'soft', label: 'Soft contrast' },
              { value: 'focused', label: 'Focused contrast' },
            ]}
            onChange={(value) => {
              const diffStyle = value as DiffStyle;
              const theme = { ...state.theme, diffStyle };
              dispatch({ type: 'SET_THEME', theme: { diffStyle } });
              applyTheme(theme);
            }}
          />
        </SettingRow>
      </div>

      <HardwareAccelerationSetting />

      <GroupLabel>Compaction</GroupLabel>
      <div className="rounded-xl bg-surface shadow-lg divide-y divide-divider mb-8">
        <SettingRow
          label="Compaction model"
          description="Model that summarizes a conversation when it is compacted."
        >
          <CompactionModelPicker
            selected={selected}
            models={state.models}
            onSelect={setCompaction}
          />
        </SettingRow>
        <SettingRow
          label="Token limit"
          description="Compact once a conversation passes this size. Factory default follows the model. Limits cannot exceed the model's context window."
        >
          <TokenLimitSelect value={state.compactionTokenLimit} onSelect={setGlobalLimit} />
        </SettingRow>
      </div>

      {/* Per-model token limits */}
      <GroupLabel>Per-model token limits</GroupLabel>
      <p className="mb-3 text-body text-muted">
        Override the compaction limit for specific models. Models without an override use{' '}
        {defaultLimitLabel}.
      </p>
      <div className="rounded-xl bg-surface shadow-lg p-3">
        {overrideEntries.length === 0 && (
          <div className="px-1 py-1.5 text-body text-muted">
            No overrides — every model uses {defaultLimitLabel}.
          </div>
        )}

        <div className="space-y-1.5">
          {overrideEntries.map(([id, limit]) => (
            <div key={id} className="flex items-center gap-2.5 rounded-md bg-elevated px-2.5 py-2">
              <ModelIcon
                provider={providerOf(
                  state.models.find((m) => m.id === id),
                  id,
                )}
                size={16}
              />
              <span className="flex-1 truncate text-body text-primary">{modelLabel(id)}</span>
              <TokenLimitSelect
                value={limit}
                onSelect={(n) => {
                  setModelLimit(id, n);
                }}
                width="w-32"
              />
              <Button
                variant="ghost"
                size="sm"
                icon={X}
                aria-label={`Remove the ${modelLabel(id)} override`}
                title="Remove override"
                onClick={() => {
                  setModelLimit(id, undefined);
                }}
              />
            </div>
          ))}
        </div>

        {availableForOverride.length > 0 && (
          <div className="mt-2.5">
            <Dropdown
              ariaLabel="Add a model override"
              value=""
              placeholder="Add a model override…"
              triggerIcon={<Plus aria-hidden="true" className="size-icon-sm text-muted" />}
              width="w-full"
              align="left"
              options={availableForOverride.map((m) => ({
                value: m.id,
                label: m.displayName,
                icon: <ModelIcon provider={providerOf(m, m.id)} size={16} />,
              }))}
              onChange={(id) => {
                setModelLimit(id, state.compactionTokenLimit ?? 200_000);
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

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
      <div className="rounded-xl bg-surface shadow-lg divide-y divide-divider mb-8">
        <SettingRow
          label="CLI status"
          description={env?.cli.present ? env.cli.path : 'Not detected on this machine.'}
        >
          <div className="flex items-center gap-2">
            <span className="font-mono text-code text-muted">
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
      <div className="rounded-xl bg-surface shadow-lg divide-y divide-divider mb-8">
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
        <SettingRow label="Credits" description={cursorDesign.attribution}>
          <Button
            size="sm"
            onClick={() => {
              void openExternal(cursorDesign.attributionUrl);
            }}
          >
            Flaticon
          </Button>
        </SettingRow>
      </div>

      <GroupLabel>Onboarding</GroupLabel>
      <div className="rounded-xl bg-surface shadow-lg divide-y divide-divider">
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
  const modelSelectorStyle = useStoreSelector((state) => state.modelSelectorStyle);
  const sideChatPlacement = useStoreSelector((state) => state.sideChatDefaultPlacement);
  return (
    <div className="max-w-2xl mx-auto">
      <SectionTitle title="Configuration" />
      <GroupLabel>Default models</GroupLabel>
      <HarnessModelSettings />
      <GroupLabel>Composer</GroupLabel>
      <div className="rounded-xl bg-surface shadow-lg divide-y divide-divider mb-8">
        <SettingRow
          label="Model selector"
          description="How the composer's model chip picks a model: a card that drills into an effort slider, or the classic list with per-row effort dots."
        >
          <Dropdown
            ariaLabel="Model selector"
            value={modelSelectorStyle}
            width="w-44"
            options={[
              { value: 'slider', label: 'Effort slider' },
              { value: 'classic', label: 'Classic list' },
            ]}
            onChange={(style) => {
              dispatch({
                type: 'SET_MODEL_SELECTOR_STYLE',
                style: style as ModelSelectorStyle,
              });
            }}
          />
        </SettingRow>
      </div>
      <GroupLabel>Transcript</GroupLabel>
      <ToolActivitySettings />
      <GroupLabel>Sessions</GroupLabel>
      <div className="rounded-xl bg-surface shadow-lg divide-y divide-divider mb-8">
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
  const [active, setActive] = useState('General');
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

  // Content-aware search: typing "play sound" jumps to Notifications so the
  // matching controls are on screen (nav filter alone only matched tab titles).
  useEffect(() => {
    const next = bestTabForQuery(query);
    if (next) setActive(next);
  }, [query]);

  const close = () => {
    dispatch({ type: 'TOGGLE_SETTINGS' });
  };
  const q = query.trim();
  const hits = q ? searchSettings(q) : [];
  let content: React.ReactNode;
  switch (active) {
    case 'Appearance':
      content = <AppearanceSection />;
      break;
    case 'General':
      content = <GeneralSection />;
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
                setQuery(e.target.value);
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
            const filtered = items.filter((it) => tabMatchesQuery(it.label, q));
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

/* theme application lives in ../lib/theme (imported above) */
