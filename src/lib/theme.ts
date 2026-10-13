import { deriveThemeTokens } from './themeTokens';

// The five colors every theme is built from; deriveThemeTokens builds the
// token layer from them. `border` no longer feeds the app's dividers, which are
// translucent text tints; the terminal, theme previews and app blocks still
// read it.
export interface ThemeColors {
  bg: string;
  fg: string;
  surface: string;
  border: string;
  accent: string;
}

export type ThemeMode = 'dark' | 'light' | 'system';

// Structural view of the persisted theme that applyTheme needs. Matches
// ThemeConfig in useStore without importing it (store -> theme one-way dep).
export interface ThemeSettings extends ThemeColors {
  diffStyle: 'soft' | 'focused';
  uiFont: string;
  uiFontSize: number;
  codeFontSize: number;
  translucentSidebar: boolean;
  contrast: number;
}

// A named theme with a light and a dark variant. The color scheme setting
// (light/dark/system) picks which variant of the active preset is applied.
export interface ThemePreset {
  id: string;
  name: string;
  light: ThemeColors;
  dark: ThemeColors;
}

// Sentinel presetId for flattened colors that match no preset (manual edits).
export const CUSTOM_THEME_ID = 'custom';
export const DEFAULT_THEME_ID = 'droid';

// Each preset carries a theme-matched neutral accent so switching scheme/preset
// keeps the UI monochrome (the accent tracks the foreground tone) instead of
// leaving a stale colored accent behind. Tinted themes use their own fg tone
// as the accent so they stay on a single tonal scale. The branded presets
// (Claude, VS Code, ChatGPT, Catppuccin, Tokyo Night) instead carry their
// signature accent color, tuned per variant so it reads on its own canvas.
//
// Light variants read like paper: a softly tinted near-white canvas (warm for
// Droid, cool blue for Midnight, etc.), a slightly deeper sidebar, and pure
// white raised layers. A mid-grey canvas makes the page look like an inverted
// dark theme and drops text contrast, which is harder on the eyes than a soft
// white; pure #ffffff everywhere glares and flattens every edge. Foregrounds
// stay softened rather than black for the same reason.
// Non-empty tuple so the default entry (index 0) is statically defined.
export const BUILT_IN_THEMES: [ThemePreset, ...ThemePreset[]] = [
  {
    id: DEFAULT_THEME_ID,
    name: 'Default',
    dark: {
      bg: '#0a0a0a',
      fg: '#ededed',
      surface: '#111111',
      border: '#1f1f1f',
      accent: '#f2f2f2',
    },
    light: {
      bg: '#f8f7f4',
      fg: '#2d2a26',
      surface: '#fdfcfa',
      border: '#e2ded6',
      accent: '#2d2a26',
    },
  },
  {
    id: 'midnight',
    name: 'Midnight',
    dark: {
      bg: '#0a0e1a',
      fg: '#c8d0e0',
      surface: '#11152a',
      border: '#1a2040',
      accent: '#c8d0e0',
    },
    light: {
      bg: '#f5f6f9',
      fg: '#2a3040',
      surface: '#fcfcfd',
      border: '#dde0e8',
      accent: '#2a3040',
    },
  },
  {
    id: 'ember',
    name: 'Ember',
    dark: {
      bg: '#1a1612',
      fg: '#d8d0c8',
      surface: '#221e18',
      border: '#322a22',
      accent: '#d8d0c8',
    },
    light: {
      bg: '#f9f5ef',
      fg: '#362e26',
      surface: '#fdfbf7',
      border: '#e7ded0',
      accent: '#362e26',
    },
  },
  {
    id: 'ocean',
    name: 'Ocean',
    dark: {
      bg: '#081318',
      fg: '#c2d4dc',
      surface: '#0d1b22',
      border: '#1a2e39',
      accent: '#c2d4dc',
    },
    light: {
      bg: '#f4f7f7',
      fg: '#25353c',
      surface: '#fbfdfd',
      border: '#d9e2e4',
      accent: '#25353c',
    },
  },
  {
    id: 'violet',
    name: 'Violet',
    dark: {
      bg: '#120e1c',
      fg: '#d2cbe8',
      surface: '#1a1428',
      border: '#2a2140',
      accent: '#d2cbe8',
    },
    light: {
      bg: '#f7f5fa',
      fg: '#322b44',
      surface: '#fcfbfd',
      border: '#e2ddea',
      accent: '#322b44',
    },
  },
  // Anthropic's Claude: warm book-cloth ivory / warm ink, terracotta accent.
  // The light accent is a deepened terracotta so links and active states keep
  // ~4.6:1 on the ivory canvas; dark keeps the brand orange (#d97757).
  {
    id: 'claude',
    name: 'Claude',
    dark: {
      bg: '#141413',
      fg: '#ede9e3',
      surface: '#1e1d1b',
      border: '#2e2c29',
      accent: '#d97757',
    },
    light: {
      bg: '#faf9f5',
      fg: '#28261f',
      surface: '#fefdfb',
      border: '#e4dfd3',
      accent: '#a84a28',
    },
  },
  // VS Code Dark+/Light+: the familiar editor greys with the status-bar blue,
  // lightened/darkened per variant so accent text keeps >=4.5:1 on its canvas.
  {
    id: 'vscode',
    name: 'VS Code',
    dark: {
      bg: '#1e1e1e',
      fg: '#d4d4d4',
      surface: '#252526',
      border: '#3c3c3c',
      accent: '#3794ff',
    },
    light: {
      bg: '#f7f7f8',
      fg: '#1f1f1f',
      surface: '#fdfdfd',
      border: '#dedfe3',
      accent: '#0066aa',
    },
  },
  // ChatGPT/Codex: strictly monochrome mid-greys; the accent is the send-button
  // white/black, like the real app.
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    dark: {
      bg: '#212121',
      fg: '#ececec',
      surface: '#2f2f2f',
      border: '#424242',
      accent: '#f5f5f5',
    },
    light: {
      bg: '#f8f8f7',
      fg: '#0d0d0d',
      surface: '#fdfdfc',
      border: '#e1e1df',
      accent: '#0d0d0d',
    },
  },
  // Catppuccin Mocha/Latte with the signature mauve accent. The Latte text is
  // deepened a step so body text keeps >=7:1 on tinted paper.
  {
    id: 'catppuccin',
    name: 'Catppuccin',
    dark: {
      bg: '#1e1e2e',
      fg: '#cdd6f4',
      surface: '#313244',
      border: '#45475a',
      accent: '#cba6f7',
    },
    light: {
      bg: '#eff1f5',
      fg: '#40435c',
      surface: '#f8f9fb',
      border: '#d4d8e2',
      accent: '#8839ef',
    },
  },
  // Tokyo Night (Night/Day): deep blue-grey canvas with the signature blue.
  // The Day accent is darkened so accent text keeps >=4.5:1 on its canvas.
  {
    id: 'tokyo-night',
    name: 'Tokyo Night',
    dark: {
      bg: '#1a1b26',
      fg: '#c0caf5',
      surface: '#24283b',
      border: '#3b4261',
      accent: '#7aa2f7',
    },
    light: {
      bg: '#eef0f4',
      fg: '#343b58',
      surface: '#f8f9fb',
      border: '#d3d7e1',
      accent: '#0066aa',
    },
  },
];

export const DEFAULT_THEME: ThemePreset = BUILT_IN_THEMES[0];

export function findPreset(id: string, customThemes: ThemePreset[]): ThemePreset | undefined {
  return BUILT_IN_THEMES.find((p) => p.id === id) ?? customThemes.find((p) => p.id === id);
}

// Resolve the on-screen scheme for a mode: 'system' follows the OS preference
// (dark when no preference is readable, e.g. in tests). Shared by every place
// that needs the visible scheme so the media query lives in exactly one spot.
export function resolveScheme(mode: ThemeMode): 'light' | 'dark' {
  return mode === 'light' ||
    (mode === 'system' &&
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: light)').matches)
    ? 'light'
    : 'dark';
}

// Resolve which variant of a preset a scheme mode selects.
export function resolveVariant(preset: ThemePreset, mode: ThemeMode): ThemeColors {
  return resolveScheme(mode) === 'light' ? preset.light : preset.dark;
}

function sameColors(a: ThemeColors, b: ThemeColors): boolean {
  return (Object.keys(a) as (keyof ThemeColors)[]).every(
    (key) => a[key].toLowerCase() === b[key].toLowerCase(),
  );
}

// Identify the preset a flattened palette came from (either variant matches).
// Used to label themes saved before presetId existed; unmatched colors are
// reported as CUSTOM_THEME_ID.
export function detectPresetId(colors: ThemeColors, customThemes: ThemePreset[] = []): string {
  for (const preset of [...BUILT_IN_THEMES, ...customThemes]) {
    if (sameColors(preset.light, colors) || sameColors(preset.dark, colors)) return preset.id;
  }
  return CUSTOM_THEME_ID;
}

/* ── custom preset persistence + import ── */
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR.test(value);
}

function readThemeColors(value: unknown): ThemeColors | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const colors = {
    bg: raw.bg,
    fg: raw.fg,
    surface: raw.surface,
    border: raw.border,
    accent: raw.accent,
  };
  for (const v of Object.values(colors)) {
    if (!isHexColor(v)) return null;
  }
  return colors as ThemeColors;
}

function readPresetName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim().slice(0, 60);
  return name ? name : null;
}

// Add a custom preset, replacing any existing entry with the same id. Shared
// by the store reducer and the UI handler that persists first, so both always
// compute the same list.
export function upsertCustomTheme(themes: ThemePreset[], preset: ThemePreset): ThemePreset[] {
  return themes.some((p) => p.id === preset.id)
    ? themes.map((p) => (p.id === preset.id ? preset : p))
    : [...themes, preset];
}

export function removeCustomTheme(themes: ThemePreset[], id: string): ThemePreset[] {
  return themes.filter((p) => p.id !== id);
}

// Validate the persisted custom-theme list, dropping malformed entries so a
// corrupt payload never blocks the built-ins.
export function parseCustomThemes(raw: unknown): ThemePreset[] {
  if (!Array.isArray(raw)) return [];
  const presets: ThemePreset[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const { id, name, light, dark } = entry as Record<string, unknown>;
    const colors = { light: readThemeColors(light), dark: readThemeColors(dark) };
    const label = readPresetName(name);
    if (typeof id !== 'string' || !id || !label || !colors.light || !colors.dark) continue;
    presets.push({ id, name: label, light: colors.light, dark: colors.dark });
  }
  return presets;
}

// Validate an imported theme file ({ name, light, dark }). The preset gets a
// fresh id when the import is saved.
export function parseThemePresetImport(
  raw: unknown,
): { name: string; light: ThemeColors; dark: ThemeColors } | null {
  if (!raw || typeof raw !== 'object') return null;
  const { name, light, dark } = raw as Record<string, unknown>;
  const label = readPresetName(name);
  const lightColors = readThemeColors(light);
  const darkColors = readThemeColors(dark);
  if (!label || !lightColors || !darkColors) return null;
  return { name: label, light: lightColors, dark: darkColors };
}

export function newCustomThemeId(): string {
  return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

const SYSTEM_FONT_STACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
export const UI_FONTS: { id: string; label: string; stack: string }[] = [
  { id: 'system', label: 'System', stack: SYSTEM_FONT_STACK },
  { id: 'inter', label: 'Inter', stack: `"Inter", ${SYSTEM_FONT_STACK}` },
  { id: 'sf', label: 'SF Pro', stack: `"SF Pro Display", "SF Pro Text", ${SYSTEM_FONT_STACK}` },
  { id: 'geist', label: 'Geist', stack: `"Geist", ${SYSTEM_FONT_STACK}` },
  { id: 'helvetica', label: 'Helvetica', stack: `"Helvetica Neue", Helvetica, Arial, sans-serif` },
  { id: 'georgia', label: 'Georgia', stack: `Georgia, "Times New Roman", serif` },
  { id: 'mono', label: 'Mono', stack: `"JetBrains Mono", "Fira Code", ui-monospace, monospace` },
];

function uiFontStack(id: string): string {
  return UI_FONTS.find((f) => f.id === id)?.stack ?? SYSTEM_FONT_STACK;
}

/* ── apply CSS variables to document ── */
export function applyTheme(theme: ThemeSettings) {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(deriveThemeTokens(theme))) {
    root.style.setProperty(name, value);
  }
  root.setAttribute('data-diff-style', theme.diffStyle);
  root.setAttribute('data-translucent', theme.translucentSidebar ? 'true' : 'false');

  root.style.setProperty('--ui-font-family', uiFontStack(theme.uiFont));
  root.style.setProperty('--ui-font-size', `${String(theme.uiFontSize)}px`);
  // The UI is built with fixed px text sizes, so scale the whole app relative
  // to the 14px baseline to make the size slider take visible effect.
  root.style.setProperty('--ui-zoom', String(theme.uiFontSize / 14));
  root.style.setProperty('--code-font-size', `${String(theme.codeFontSize)}px`);

  // Apply contrast as a filter only below 100% so it never creates a stacking
  // context that would defeat the sidebar's backdrop blur at the default value.
  const rootEl = document.getElementById('root');
  if (rootEl)
    rootEl.style.filter = theme.contrast >= 100 ? '' : `contrast(${String(theme.contrast)}%)`;
}
