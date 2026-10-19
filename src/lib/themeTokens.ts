import type { DiffStyle } from '../hooks/persistedThemePreferences';
import { diffPaletteForTheme } from './diffTheme';

// The theme values every colour and shadow token derives from. ThemeSettings
// satisfies it; the preset's `border` colour is not an input, because dividers
// are translucent tints of the text colour (docs/design-system/tokens.json).
export interface ThemeTokenSource {
  bg: string;
  fg: string;
  surface: string;
  accent: string;
  diffStyle: DiffStyle;
  translucentSidebar: boolean;
}

/** CSS custom property name → value, as applyTheme writes them on :root. */
export type ThemeTokens = Record<`--${string}`, string>;

type Scheme = 'dark' | 'light';

// WCAG AA for normal text: muted and status text run 11–13px, so the
// large-text 3:1 tier never applies to them.
const AA_TEXT = 4.5;
const SECONDARY_TEXT = 6.2;
// WCAG non-text contrast, the floor for the keyboard focus ring.
const FOCUS_RING_CONTRAST = 3;

export const SKILL_COLORS = {
  dark: '#93c5fd',
  light: '#1d4ed8',
} as const;

// The sidebar's update pill is a system signal, not chrome, so it keeps a fixed
// blue in both schemes the way the status colors do: a monochrome accent must
// never tint "an update is waiting" into the surrounding UI.
export const UPDATE_COLORS = {
  base: '#005fc8',
  hover: '#0054b2',
  label: '#ffffff',
} as const;

// Prompt chip marks keep their own hue beside the blue skill label: rose for a
// skill's Rosette, pink for the Visualize plugin.
const MARK_COLORS = {
  skill: { dark: '#ed4772', light: '#b82950' },
  visualize: { dark: '#f472b6', light: '#b8307a' },
} as const;

// The top reasoning level reads by hue on every theme, the way skills and links
// do: the neutral accent cannot say "this one is different" when it is the same
// tone the rest of the chrome already uses. Each scheme carries the shade that
// keeps AA for 12px label text on its composer surface (--elevated).
export const ULTRA_COLORS = {
  dark: '#bba6ff',
  light: '#6d28d9',
} as const;

// Hyperlinks read by hue, like skills and status do. The neutral accent governs
// chrome and is near-white in dark themes, which left links looking like plain
// underlined text everywhere they appeared.
const LINK_COLORS = {
  dark: '#7cb2ff',
  light: '#1d4ed8',
} as const;

// Semantic status colours are fixed, never accent-derived, so they read as
// green/amber/red even on a monochrome theme. Each theme darkens (light) or
// lightens (dark) them only as far as its own surfaces demand.
const STATUS_COLORS = {
  success: { dark: '#4fae82', light: '#1f7a4d' },
  warning: { dark: '#d9913a', light: '#9a5a0f' },
  danger: { dark: '#cf5d54', light: '#b3312a' },
} as const;

const SOFT_FILL_ALPHA = { dark: 0.12, light: 0.08 } as const;
const DIVIDER_ALPHA = {
  dark: { divider: 0.07, strong: 0.12 },
  light: { divider: 0.08, strong: 0.14 },
} as const;
const FOCUS_RING_ALPHA = { dark: 0.4, light: 0.55 } as const;

// Each shadow carries a faint 1px ring (white on dark, ink on light) that
// gives floating layers their edge in place of a border. Dark drops are deep
// and near-black. Light layers can't lift by tone (raised is already near
// white), so their ring and drop carry the lift, kept soft so paper stays clean.
const SHADOWS = {
  dark: {
    sm: '0 0 0 1px rgba(255, 255, 255, 0.04), 0 4px 16px rgba(0, 0, 0, 0.28)',
    lg: '0 0 0 1px rgba(255, 255, 255, 0.05), 0 10px 40px rgba(0, 0, 0, 0.35)',
  },
  light: {
    sm: '0 0 0 1px rgba(28, 25, 23, 0.06), 0 1px 2px rgba(28, 25, 23, 0.05), 0 4px 12px rgba(28, 25, 23, 0.06)',
    lg: '0 0 0 1px rgba(28, 25, 23, 0.06), 0 2px 6px rgba(28, 25, 23, 0.05), 0 12px 32px rgba(28, 25, 23, 0.1)',
  },
} as const;

// How far the hover (`elevated`) and selected (`active`) rungs step from their
// base, in RGB units. Contrast ratios compress near white, so light rungs step
// further to read as clearly as dark ones: about 1.13:1 for hover and 1.3:1
// for selection against the sidebar in both schemes.
const RUNG_STEPS = {
  dark: { elevated: 13, active: 26 },
  light: { elevated: 20, active: 34 },
} as const;
type Rung = keyof (typeof RUNG_STEPS)['dark'];

export function deriveThemeTokens(theme: ThemeTokenSource): ThemeTokens {
  const scheme: Scheme = isDarkCanvas(theme.bg) ? 'dark' : 'light';
  const elevated = elevatedSurfaceColor(theme);
  const active = surfaceStep(theme, 'active');
  const raised = raisedSurfaceColor(theme);
  // A light sidebar sits a shade below the canvas, like paper under a page,
  // so the near-white reading area stays the brightest region of the window.
  const sidebar = scheme === 'dark' ? theme.surface : adjustColor(theme.bg, -6);
  // Text and status colours must read on every surface, so they are tuned
  // against the one they read worst on (the top of the ramp, `active`, for
  // every built-in preset).
  const ground = hardestSurface(theme.fg, [
    theme.bg,
    theme.surface,
    elevated,
    active,
    raised,
    sidebar,
  ]);
  // Secondary keeps 6.2:1, or sits halfway between text and muted when the
  // text is too close to that for three distinct tones (Catppuccin dark).
  const secondaryFloor = Math.max(
    AA_TEXT,
    Math.min(SECONDARY_TEXT, (contrastRatio(theme.fg, ground) + AA_TEXT) / 2),
  );
  const success = readableStatusColor(STATUS_COLORS.success[scheme], ground);
  const warning = readableStatusColor(STATUS_COLORS.warning[scheme], ground);
  const danger = readableStatusColor(STATUS_COLORS.danger[scheme], ground);
  const diff = diffPaletteForTheme(scheme === 'dark', theme.diffStyle);

  return {
    '--bg': theme.bg,
    '--surface': theme.surface,
    '--elevated': elevated,
    // Fields share the elevated rung today: a raised pad on dark, a recessed
    // well on light. Kept separate so fields can move on their own.
    '--field': elevated,
    '--active': active,
    '--raised': raised,
    ...sidebarTokens(sidebar, scheme, theme.translucentSidebar),
    '--divider': withAlpha(theme.fg, DIVIDER_ALPHA[scheme].divider),
    '--divider-strong': withAlpha(theme.fg, DIVIDER_ALPHA[scheme].strong),
    '--text': theme.fg,
    '--text-secondary': textTone(theme.fg, ground, scheme, 30, secondaryFloor),
    '--text-muted': textTone(theme.fg, ground, scheme, 50, AA_TEXT),
    // Readable but receding, for the agent's thinking. Dark themes leave muted
    // well above AA, so quiet steps further down; light muted already sits at
    // the floor, so there the two match.
    '--text-quiet': textTone(theme.fg, ground, scheme, 80, AA_TEXT),
    '--accent': theme.accent,
    '--focus-ring': focusRingColor(theme.accent, theme.fg, ground, FOCUS_RING_ALPHA[scheme]),
    '--link': LINK_COLORS[scheme],
    '--skill': SKILL_COLORS[scheme],
    '--skill-mark': MARK_COLORS.skill[scheme],
    '--visualize-mark': MARK_COLORS.visualize[scheme],
    '--ultra': ULTRA_COLORS[scheme],
    '--success': success,
    '--success-soft': withAlpha(success, SOFT_FILL_ALPHA[scheme]),
    '--warning': warning,
    '--warning-soft': withAlpha(warning, SOFT_FILL_ALPHA[scheme]),
    '--danger': danger,
    '--danger-soft': withAlpha(danger, SOFT_FILL_ALPHA[scheme]),
    '--update': UPDATE_COLORS.base,
    '--update-hover': UPDATE_COLORS.hover,
    '--on-update': UPDATE_COLORS.label,
    '--shadow-sm': SHADOWS[scheme].sm,
    '--shadow-lg': SHADOWS[scheme].lg,
    '--diff-add-fg': diff.addFg,
    '--diff-add-bg': diff.addBg,
    '--diff-add-gutter': diff.addGutter,
    '--diff-del-fg': diff.delFg,
    '--diff-del-bg': diff.delBg,
    '--diff-del-gutter': diff.delGutter,
    '--diff-hunk-bg': diff.hunkBg,
    '--diff-hunk-fg': diff.hunkFg,
  };
}

// When the frosted sidebar is on, the window is transparent (see index.css and
// Electron vibrancy) and only the sidebar fill lets the wallpaper through.
// Light surfaces sit over a dark vibrancy material, so a low-opacity fill and a
// strong saturation boost would bleed through as a muddy tint: light stays
// mostly opaque with gentle saturation, dark can show more.
function sidebarTokens(sidebar: string, scheme: Scheme, translucent: boolean): ThemeTokens {
  if (!translucent) return { '--sidebar': sidebar, '--sidebar-blur': 'none' };
  return scheme === 'dark'
    ? { '--sidebar': `${sidebar}99`, '--sidebar-blur': 'blur(6px) saturate(150%)' }
    : { '--sidebar': `${sidebar}f2`, '--sidebar-blur': 'blur(6px) saturate(108%)' };
}

// Muted and secondary text step down from the foreground but never below the
// contrast they must keep. Near-white dark-theme text has headroom, so it steps
// by a fixed amount; a near-black light-theme foreground has none below it, so
// it fades toward the surface exactly as far as the floor allows.
function textTone(fg: string, ground: string, scheme: Scheme, darkStep: number, floor: number) {
  if (scheme === 'light') return mixToContrast(fg, ground, floor);
  const stepped = adjustColor(fg, -darkStep);
  return contrastRatio(stepped, ground) >= floor ? stepped : mixToContrast(fg, ground, floor);
}

// The accent at the scheme's resting alpha, raised in 5% steps only as far as a
// focus indicator's 3:1 needs: a coloured accent needs more than a neutral one.
// An accent close to the surfaces (a near-white Quick accent on a light theme)
// never gets there, so the ring falls back to the text colour, which always can.
function focusRingColor(accent: string, fg: string, ground: string, restingAlpha: number): string {
  return (
    ringAtContrast(accent, ground, restingAlpha) ?? ringAtContrast(fg, ground, restingAlpha) ?? fg
  );
}

function ringAtContrast(color: string, ground: string, restingAlpha: number): string | undefined {
  for (let percent = Math.round(restingAlpha * 100); percent <= 100; percent += 5) {
    const alpha = percent / 100;
    if (contrastRatio(mixHex(ground, color, alpha), ground) >= FOCUS_RING_CONTRAST) {
      return withAlpha(color, alpha);
    }
  }
  return undefined;
}

function hardestSurface(fg: string, surfaces: string[]): string {
  return surfaces.reduce((hardest, surface) =>
    contrastRatio(fg, surface) < contrastRatio(fg, hardest) ? surface : hardest,
  );
}

export function isDarkCanvas(bg: string): boolean {
  return colorLuminance(bg) < 0.4;
}

// One rung of the tint ramp (hover, selection, user bubbles, code blocks).
//
// Dark presets keep headroom above their surface, so each rung lightens it and
// the ramp reads bg < surface < elevated < active. Light presets put the
// surface ABOVE the canvas with nothing left above it, so their rungs step
// darker, measured from the canvas: stepping down from the surface would land
// the first rung back on the canvas and make every tint vanish.
export function surfaceStep(theme: { bg: string; surface: string }, rung: Rung): string {
  return isDarkCanvas(theme.bg)
    ? adjustColor(theme.surface, RUNG_STEPS.dark[rung])
    : adjustColor(theme.bg, -RUNG_STEPS.light[rung]);
}

export function elevatedSurfaceColor(theme: { bg: string; surface: string }): string {
  return surfaceStep(theme, 'elevated');
}

// Floating layers (composer, menus, popovers, tooltips, toasts) need the
// opposite direction from the tint ramp on light themes: a darker rung reads as
// a grey hole in the page, so they lift to near-white and rely on the shadow's
// ring for their edge. Dark themes already lighten upward, so they share the
// elevated rung.
function raisedSurfaceColor(theme: { bg: string; surface: string }): string {
  return isDarkCanvas(theme.bg)
    ? elevatedSurfaceColor(theme)
    : mixHex(theme.surface, '#ffffff', 0.6);
}

/**
 * A status shade pushed away from the surface (toward black on a light one,
 * white on a dark one) only as far as AA on that surface demands. A shade that
 * already reads comes back unchanged, so only the presets that need it shift.
 */
export function readableStatusColor(hex: string, ground: string): string {
  if (contrastRatio(hex, ground) >= AA_TEXT) return hex;
  const extreme =
    contrastRatio('#000000', ground) > contrastRatio('#ffffff', ground) ? '#000000' : '#ffffff';
  let fails = 0;
  let reads = 1;
  for (let i = 0; i < 12; i++) {
    const middle = (fails + reads) / 2;
    if (contrastRatio(mixHex(hex, extreme, middle), ground) >= AA_TEXT) reads = middle;
    else fails = middle;
  }
  return mixHex(hex, extreme, reads);
}

// Blend `hex` as far toward `target` as `ratio` contrast against `target`
// allows. Contrast falls monotonically as the blend approaches the target, so a
// bisection finds the quietest tone that still reads. Returns `hex` unchanged
// when even the unblended color cannot reach the ratio.
function mixToContrast(hex: string, target: string, ratio: number): string {
  let readable = 0;
  let faded = 1;
  for (let i = 0; i < 12; i++) {
    const middle = (readable + faded) / 2;
    if (contrastRatio(mixHex(hex, target, middle), target) >= ratio) readable = middle;
    else faded = middle;
  }
  return mixHex(hex, target, readable);
}

function rgbChannels(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function toHex(channels: number[]): string {
  return `#${channels.map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0')).join('')}`;
}

function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = rgbChannels(hex);
  return `rgba(${String(r)}, ${String(g)}, ${String(b)}, ${String(alpha)})`;
}

// Perceptual-ish luminance (0 = black, 1 = white), used to tell dark canvases
// from light ones.
function colorLuminance(hex: string): number {
  const [r, g, b] = rgbChannels(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function adjustColor(hex: string, lighten: number): string {
  return toHex(rgbChannels(hex).map((n) => n + lighten));
}

// Blend `hex` toward `target` by t (0..1).
function mixHex(hex: string, target: string, t: number): string {
  const to = rgbChannels(target);
  return toHex(rgbChannels(hex).map((n, i) => Math.round(n * (1 - t) + to[i] * t)));
}

// sRGB channel -> linear-light value, for WCAG contrast checks.
function linearChannel(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

// WCAG relative luminance (0 = black, 1 = white).
export function relativeLuminance(hex: string): number {
  const [r, g, b] = rgbChannels(hex).map(linearChannel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// WCAG contrast ratio between two hex colors (1..21).
export function contrastRatio(a: string, b: string): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}
