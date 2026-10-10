import type { DesignSystem } from '../designSystems.js';
import inter from './fonts/inter.json' with { type: 'json' };
import { PRIMITIVES_TSX } from './primitives.js';
import { HEY_TSX, UNIVERSAL_GUIDANCE } from './starter.js';
import { GEOMETRY_TOKENS, KIT_CSS } from './styles.js';

const LIGHT_TOKENS: Record<string, string> = {
  ...GEOMETRY_TOKENS,
  '--ds-canvas': '#f6f3ee',
  '--ds-surface': '#fdfbf7',
  '--ds-raised': '#fffcf7',
  '--ds-elevated': '#f1ece4',
  '--ds-active': '#e8e1d6',
  '--ds-fg': '#221e19',
  '--ds-fg-muted': '#5d564c',
  '--ds-border': '#e3dcd0',
  '--ds-accent': '#8a5a1f',
  '--ds-lift': 'rgb(0 0 0 / 0.06)',
  '--ds-press': 'rgb(0 0 0 / 0.10)',
  '--ds-accent-soft': '#f3e6d4',
  '--ds-accent-fg': '#fffaf2',
  '--ds-focus': '#b9833c',
  '--ds-positive': '#2f6f4f',
  '--ds-danger': '#a3342b',
  '--ds-backdrop': 'rgb(34 30 25 / 0.25)',
  '--ds-shadow-sm': '0 1px 2px rgb(34 30 25 / 0.06)',
  '--ds-shadow-md': '0 12px 32px rgb(34 30 25 / 0.10)',
};

const DARK_TOKENS: Record<string, string> = {
  ...GEOMETRY_TOKENS,
  '--ds-canvas': '#121110',
  '--ds-surface': '#191817',
  '--ds-raised': '#201e1c',
  '--ds-elevated': '#262320',
  '--ds-active': '#2e2a26',
  '--ds-fg': '#ece7df',
  '--ds-fg-muted': '#a8a19a',
  '--ds-border': '#2c2825',
  '--ds-accent': '#e3a857',
  '--ds-lift': 'rgb(255 255 255 / 0.08)',
  '--ds-press': 'rgb(255 255 255 / 0.12)',
  '--ds-accent-soft': '#332a1e',
  '--ds-accent-fg': '#1b1710',
  '--ds-focus': '#e3a857',
  '--ds-positive': '#6ec194',
  '--ds-danger': '#e08a7f',
  '--ds-backdrop': 'rgb(0 0 0 / 0.5)',
  '--ds-shadow-sm': '0 1px 2px rgb(0 0 0 / 0.40)',
  '--ds-shadow-md': '0 16px 44px rgb(0 0 0 / 0.50)',
};

export const DROIDEX_DESIGN_SYSTEM: DesignSystem = {
  id: 'droidex',
  version: 1,
  name: 'DROIDEX',
  modes: { light: LIGHT_TOKENS, dark: DARK_TOKENS },
  files: {
    'index.tsx': PRIMITIVES_TSX,
    'tokens.css': inter.css + KIT_CSS,
    'fonts/Inter-OFL.txt': inter.license,
  },
  guidance:
    UNIVERSAL_GUIDANCE +
    '\nDROIDEX: warm paper and graphite, with restrained amber actions. Keep surfaces quiet, rounded and softly raised; use a compact sans-serif hierarchy. The preview palette is independent of app chrome.\n',
  examples: { 'Hey.tsx': HEY_TSX },
};
