// Appearance settings composition: color-scheme cards with live wireframe
// previews, the theme preset card (see ThemePresetCard.tsx), the app icon
// selector, and the typography/behavior card. Manual color edits still work
// directly; they become an unsaved "custom" look until saved as a theme.

import { Check, Monitor, Moon, Sun } from '@droidex/icons';
import { shallowEqual, useStoreDispatch, useStoreSelector } from '../hooks/useStore';
import type { ThemeConfig } from '../hooks/persistedThemePreferences';
import {
  applyTheme,
  DEFAULT_THEME,
  findPreset,
  resolveScheme,
  resolveVariant,
  UI_FONTS,
  type ThemeMode,
} from '../lib/theme';
import { Dropdown, GroupLabel, SectionTitle } from './settingsKit';
import { ThemePresetCard } from './ThemePresetCard';
import { SchemePreview } from './ThemePreview';
import { Switch } from './Switch';

/* ── shared controls ── */
function ModeButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ElementType;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`flex h-control-sm select-none items-center gap-1.5 rounded-md px-2.5 text-label transition-colors duration-150 ease-out ${
        active ? 'bg-active text-primary' : 'text-muted hover:bg-elevated hover:text-primary'
      }`}
    >
      <Icon aria-hidden="true" className="size-icon-sm" />
      {label}
    </button>
  );
}

function Slider({
  label,
  sub,
  value,
  min,
  max,
  onChange,
  suffix = '',
}: {
  label: string;
  sub?: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  suffix?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <div>
        <div className="text-body text-primary">{label}</div>
        {sub && <div className="text-caption text-muted">{sub}</div>}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={min}
          max={max}
          value={value}
          aria-label={label}
          onChange={(e) => {
            onChange(Number(e.target.value));
          }}
          className="w-32 h-1 rounded-full cursor-pointer"
          style={{ accentColor: 'var(--accent)' }}
        />
        <span className="w-8 text-right text-caption tabular-nums text-muted">
          {value}
          {suffix}
        </span>
      </div>
    </div>
  );
}

/* ── color scheme card (System / Light / Dark) ── */
function SchemeCard({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`select-none rounded-xl p-2 text-left transition-colors duration-150 ease-out ${
        active ? 'bg-active' : 'bg-surface hover:bg-elevated'
      }`}
    >
      <div className="h-24 overflow-hidden rounded-md shadow-sm">{children}</div>
      <div className="mt-2 flex items-center justify-between px-0.5 pb-0.5">
        <span className={`text-label ${active ? 'text-primary' : 'text-secondary'}`}>{label}</span>
        {active && <Check aria-hidden="true" className="size-icon-sm text-accent" />}
      </div>
    </button>
  );
}

/* ── appearance content ── */
export function AppearanceSection() {
  const dispatch = useStoreDispatch();
  const { theme, customThemes } = useStoreSelector(
    (state) => ({ theme: state.theme, customThemes: state.customThemes }),
    shallowEqual,
  );

  const activePreset = findPreset(theme.presetId, customThemes);
  // Palette behind the scheme cards: the active preset, or the default when
  // the current colors are hand-edited and match no preset.
  const previewPreset = activePreset ?? DEFAULT_THEME;
  const resolvedScheme = resolveScheme(theme.mode);

  const updateTheme = (patch: Partial<ThemeConfig>) => {
    dispatch({ type: 'SET_THEME', theme: patch });
    applyTheme({ ...theme, ...patch });
  };

  // Switching scheme re-resolves the active preset's other variant; hand-edited
  // (custom) colors have no second variant, so they stay as they are.
  const selectScheme = (mode: ThemeMode) => {
    updateTheme({ mode, ...(activePreset ? resolveVariant(activePreset, mode) : {}) });
  };

  const schemes = [
    { mode: 'system' as const, label: 'System', icon: Monitor },
    { mode: 'light' as const, label: 'Light', icon: Sun },
    { mode: 'dark' as const, label: 'Dark', icon: Moon },
  ];

  return (
    <div className="max-w-2xl mx-auto">
      <SectionTitle
        title="Appearance"
        sub="Choose how DROIDEX looks. Use a built-in theme or make your own."
      />

      {/* Color scheme */}
      <GroupLabel>Color scheme</GroupLabel>
      <div className="grid grid-cols-3 gap-3 mb-8">
        {schemes.map(({ mode, label }) => (
          <SchemeCard
            key={mode}
            label={label}
            active={theme.mode === mode}
            onClick={() => {
              selectScheme(mode);
            }}
          >
            <SchemePreview preset={previewPreset} scheme={mode} />
          </SchemeCard>
        ))}
      </div>

      {/* Themes */}
      <GroupLabel>Themes</GroupLabel>
      <ThemePresetCard resolvedScheme={resolvedScheme} />

      {/* App icon */}
      <div className="rounded-xl bg-surface shadow-lg p-4 mb-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-body text-primary">App icon</div>
            <div className="text-caption text-muted">
              Match the system, or pick the light or dark DROIDEX icon
            </div>
          </div>
          <div className="flex gap-1" role="group" aria-label="App icon">
            <ModeButton
              active={theme.appIconMode === 'light'}
              onClick={() => {
                updateTheme({ appIconMode: 'light' });
              }}
              icon={Sun}
              label="Light"
            />
            <ModeButton
              active={theme.appIconMode === 'dark'}
              onClick={() => {
                updateTheme({ appIconMode: 'dark' });
              }}
              icon={Moon}
              label="Dark"
            />
            <ModeButton
              active={theme.appIconMode === 'system'}
              onClick={() => {
                updateTheme({ appIconMode: 'system' });
              }}
              icon={Monitor}
              label="System"
            />
          </div>
        </div>
      </div>

      {/* Typography + behavior */}
      <GroupLabel>Typography & behavior</GroupLabel>
      <div className="rounded-xl bg-surface px-4 shadow-lg">
        <div className="flex items-center justify-between py-3">
          <div>
            <div className="text-body text-primary">UI font</div>
            <div className="text-caption text-muted">
              Typeface for the whole app (defaults to your OS font)
            </div>
          </div>
          <Dropdown
            ariaLabel="UI font"
            value={theme.uiFont}
            width="w-44"
            options={UI_FONTS.map((f) => ({ value: f.id, label: f.label }))}
            onChange={(v) => {
              updateTheme({ uiFont: v });
            }}
          />
        </div>
        <Slider
          label="UI font size"
          sub="Base size used across the DROIDEX UI"
          value={theme.uiFontSize}
          min={12}
          max={18}
          onChange={(v) => {
            updateTheme({ uiFontSize: v });
          }}
          suffix="px"
        />
        <Slider
          label="Code font size"
          sub="Base size for code across chats and diffs"
          value={theme.codeFontSize}
          min={10}
          max={16}
          onChange={(v) => {
            updateTheme({ codeFontSize: v });
          }}
          suffix="px"
        />
        <Slider
          label="Contrast"
          sub="Adjust overall UI contrast"
          value={theme.contrast}
          min={40}
          max={100}
          onChange={(v) => {
            updateTheme({ contrast: v });
          }}
        />
        <div className="flex items-center justify-between gap-3 py-3">
          <div>
            <div className="text-body text-primary">Translucent sidebar</div>
            <div className="text-caption text-muted">Blur and lighten the sidebar surface</div>
          </div>
          <Switch
            label="Translucent sidebar"
            checked={theme.translucentSidebar}
            onChange={(v) => {
              updateTheme({ translucentSidebar: v });
            }}
          />
        </div>
      </div>
    </div>
  );
}
