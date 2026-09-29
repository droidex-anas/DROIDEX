import { normalizeAppIconMode, type AppIconMode } from '../lib/appIcon';
import {
  DEFAULT_THEME,
  DEFAULT_THEME_ID,
  detectPresetId,
  findPreset,
  parseCustomThemes,
  readThemeColors,
  resolveVariant,
  type ThemePreset,
} from '../lib/theme';

export type DiffStyle = 'soft' | 'focused';

export interface ThemeConfig {
  mode: 'dark' | 'light' | 'system';
  appIconMode: AppIconMode;
  // The preset the flattened colors came from: a built-in/custom theme id, or
  // 'custom' when the colors were edited by hand and match no preset.
  presetId: string;
  accent: string;
  bg: string;
  fg: string;
  surface: string;
  border: string;
  uiFont: string;
  uiFontSize: number;
  codeFontSize: number;
  translucentSidebar: boolean;
  diffStyle: DiffStyle;
  contrast: number;
}

const defaultTheme: ThemeConfig = {
  mode: 'dark',
  appIconMode: 'system',
  presetId: DEFAULT_THEME_ID,
  ...DEFAULT_THEME.dark,
  uiFont: 'system',
  uiFontSize: 14,
  codeFontSize: 12,
  translucentSidebar: false,
  diffStyle: 'soft',
  contrast: 100,
};

const THEME_STORAGE_KEY = 'droid-theme';
const CUSTOM_THEMES_STORAGE_KEY = 'droid-theme-presets';

function getLocalStorage(): Storage | undefined {
  if (typeof window !== 'undefined') return window.localStorage;
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  return descriptor && 'value' in descriptor ? (descriptor.value as Storage) : undefined;
}

// 'symbol' is the focused style's earlier name. Loading never rewrites the
// saved theme, so a theme saved before the rename still carries it.
export function normalizeDiffStyle(value: unknown): DiffStyle {
  if (value === 'focused' || value === 'symbol') return 'focused';
  return 'soft';
}

export function loadCustomThemes(): ThemePreset[] {
  try {
    const raw = getLocalStorage()?.getItem(CUSTOM_THEMES_STORAGE_KEY);
    return raw ? parseCustomThemes(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

// Unlike the rest of the store, custom themes are saved by the dispatching
// handler (ThemePresetCard) before it dispatches, so a failed write (quota,
// restricted storage) leaves state untouched and shows a retryable error.
// Throws on failure; callers must catch.
export function persistCustomThemes(presets: ThemePreset[]): void {
  getLocalStorage()?.setItem(CUSTOM_THEMES_STORAGE_KEY, JSON.stringify(presets));
}

function readSavedTheme(): Record<string, unknown> | null {
  try {
    const saved: unknown = JSON.parse(getLocalStorage()?.getItem(THEME_STORAGE_KEY) ?? 'null');
    return saved && typeof saved === 'object' ? (saved as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// A field this version cannot read falls back to its default; a record that is
// not an object at all falls back to the default theme.
export function loadTheme(customThemes: ThemePreset[]): ThemeConfig {
  const saved = readSavedTheme();
  if (!saved) return defaultTheme;
  const colors = readThemeColors(saved) ?? DEFAULT_THEME.dark;
  const theme: ThemeConfig = {
    mode: saved.mode === 'light' || saved.mode === 'system' ? saved.mode : 'dark',
    appIconMode: normalizeAppIconMode(saved.appIconMode),
    // A theme saved without a preset is matched to one by its colors.
    presetId:
      typeof saved.presetId === 'string' && saved.presetId
        ? saved.presetId
        : detectPresetId(colors, customThemes),
    ...colors,
    uiFont: typeof saved.uiFont === 'string' ? saved.uiFont : defaultTheme.uiFont,
    uiFontSize: typeof saved.uiFontSize === 'number' ? saved.uiFontSize : defaultTheme.uiFontSize,
    codeFontSize:
      typeof saved.codeFontSize === 'number' ? saved.codeFontSize : defaultTheme.codeFontSize,
    translucentSidebar:
      typeof saved.translucentSidebar === 'boolean'
        ? saved.translucentSidebar
        : defaultTheme.translucentSidebar,
    diffStyle: normalizeDiffStyle(saved.diffStyle),
    contrast: typeof saved.contrast === 'number' ? saved.contrast : defaultTheme.contrast,
  };
  // The preset owns its colors; the flattened copy is only a cache. Re-reading
  // it means a retuned preset reaches themes saved before the change.
  const preset = findPreset(theme.presetId, customThemes);
  return preset ? { ...theme, ...resolveVariant(preset, theme.mode) } : theme;
}

export function persistTheme(theme: ThemeConfig): void {
  try {
    getLocalStorage()?.setItem(THEME_STORAGE_KEY, JSON.stringify(theme));
  } catch {
    /* ignore */
  }
}
