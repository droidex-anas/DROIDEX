// Appearance settings composition: color-scheme cards with live wireframe
// previews, the theme preset card (see ThemePresetCard.tsx), the app icon
// selector, and the typography/behavior card. Manual color edits still work
// directly; they become an unsaved "custom" look until saved as a theme.

import { Check, Monitor, Moon, Sun } from 'lucide-react';
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
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-[11px] transition-colors ${
        active ? 'bg-elevated text-primary border border-divider' : 'text-muted hover:text-primary'
      }`}
    >
      <Icon className="w-3.5 h-3.5" />
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
    <div className="flex items-center justify-between gap-3 py-2.5 border-b border-divider">
      <div>
        <div className="text-[13px] text-primary">{label}</div>
        {sub && <div className="text-[11px] text-muted">{sub}</div>}
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
        <span className="font-mono text-[11px] text-muted w-8 text-right">
          {value}
          {suffix}
        </span>
      </div>
    </div>
  );
}

function Toggle({
  label,
  sub,
  checked,
  onChange,
}: {
  label: string;
  sub?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-divider">
      <div>
        <div className="text-[13px] text-primary">{label}</div>
        {sub && <div className="text-[11px] text-muted">{sub}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => {
          onChange(!checked);
        }}
        className={`w-10 h-6 rounded-full transition-colors shrink-0 flex items-center p-0.5 ${checked ? 'bg-accent' : 'bg-divider'}`}
      >
        <span
          className={`w-5 h-5 rounded-full shadow-[0_1px_2px_0_rgb(0_0_0/0.05)] transition-transform ${checked ? 'bg-bg translate-x-4' : 'bg-secondary translate-x-0'}`}
        />
      </button>
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
      className={`rounded-lg border p-2 text-left transition-colors ${
        active ? 'border-accent/50 bg-elevated' : 'border-divider hover:border-divider-strong'
      }`}
    >
      <div className="h-24 overflow-hidden rounded-md border border-divider">{children}</div>
      <div className="mt-2 flex items-center justify-between px-0.5 pb-0.5">
        <span className={`text-[12px] ${active ? 'text-primary' : 'text-secondary'}`}>{label}</span>
        {active && (
          <Check className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} strokeWidth={3} />
        )}
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
        sub="Choose how Droid Control looks. Use a built-in theme or make your own."
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
      <div className="rounded-lg border border-divider bg-surface p-4 mb-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[13px] text-primary">App icon</div>
            <div className="text-[11px] text-muted">
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
      <div className="rounded-lg border border-divider bg-surface px-4 [&>*:last-child]:border-b-0">
        <div className="flex items-center justify-between py-2.5 border-b border-divider">
          <div>
            <div className="text-[13px] text-primary">UI font</div>
            <div className="text-[11px] text-muted">
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
          sub="Base size used across the Droid Control UI"
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
        <Toggle
          label="Translucent sidebar"
          sub="Blur and lighten the sidebar surface"
          checked={theme.translucentSidebar}
          onChange={(v) => {
            updateTheme({ translucentSidebar: v });
          }}
        />
      </div>
    </div>
  );
}
