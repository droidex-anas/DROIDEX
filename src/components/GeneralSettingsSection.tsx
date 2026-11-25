import { ChevronDown, Check, X, Plus } from '@droidex/icons';
import { memo, useCallback, useRef, useState } from 'react';
import type { ModelInfo, VoiceNarration } from '@droidex/protocol';
import {
  shallowEqual,
  useStoreDispatch,
  useStoreSelector,
  type ImagePasteQuality,
} from '../hooks/useStore';
import type { DiffStyle } from '../hooks/persistedThemePreferences';
import type { DiffViewMode, LiveEnterBehavior } from '../hooks/persistedUiPreferences';
import { applyTheme } from '../lib/theme';
import { ModelIcon, providerOf } from './ModelIcon';
import { Dropdown, GroupLabel, SectionTitle, SettingRow, type DropdownOption } from './settingsKit';
import { HardwareAccelerationSetting } from './HardwareAccelerationSetting';
import { Button } from './ui/Button';
import { Input } from './ui/Field';
import { Popover } from './ui/Popover';

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
const CompactionModelOption = memo(function CompactionModelOption({
  id,
  label,
  sub,
  active,
  model,
  onSelect,
}: {
  id: string;
  label: string;
  sub?: string;
  active: boolean;
  model?: ModelInfo;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        onSelect(id);
      }}
      className={`flex w-full select-none items-center gap-2 rounded-md px-2 py-1.5 text-left ${
        active ? 'bg-active' : 'hover:bg-elevated dark:hover:bg-active'
      }`}
    >
      {model && <ModelIcon provider={providerOf(model, id)} size={16} />}
      <div className="min-w-0 flex-1">
        <div className="truncate text-body text-primary">{label}</div>
        {sub && <div className="truncate text-caption text-muted">{sub}</div>}
      </div>
      {active && <Check aria-hidden="true" className="size-icon-sm shrink-0 text-accent" />}
    </button>
  );
});

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

  const choose = useCallback(
    (id: string) => {
      onSelect(id);
      close();
    },
    [onSelect, close],
  );

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
          <CompactionModelOption
            id="current-model"
            label="Current model"
            sub="Use whatever model the session runs"
            active={isCurrent}
            onSelect={choose}
          />
          {filtered.map((m) => (
            <CompactionModelOption
              key={m.id}
              id={m.id}
              label={m.displayName}
              sub={m.provider}
              active={selected === m.id}
              model={m}
              onSelect={choose}
            />
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
export function GeneralSettingsSection() {
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
      <div className="rounded-xl bg-surface shadow-lg mb-8">
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
      <div className="rounded-xl bg-surface shadow-lg mb-8">
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
      <div className="rounded-xl bg-surface shadow-lg mb-8">
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
      <div className="rounded-xl bg-surface shadow-lg mb-8">
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
