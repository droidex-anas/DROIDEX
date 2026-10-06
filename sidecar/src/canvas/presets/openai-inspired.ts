import type { DesignSystem } from '../designSystems.js';
import inter from './fonts/inter.json';
import { PRIMITIVES_TSX } from './primitives.js';
import { HEY_TSX, UNIVERSAL_GUIDANCE } from './starter.js';
import { GEOMETRY_TOKENS, KIT_CSS } from './styles.js';

const LIGHT_TOKENS: Record<string, string> = {
  ...GEOMETRY_TOKENS,
  '--ds-radius-md': '12px',
  '--ds-radius-lg': '24px',
  '--ds-canvas': '#f7f7f5',
  '--ds-surface': '#fafaf8',
  '--ds-raised': '#fdfdfb',
  '--ds-elevated': '#eeefeb',
  '--ds-active': '#e2e5df',
  '--ds-fg': '#202622',
  '--ds-fg-muted': '#535b55',
  '--ds-border': '#dddfd9',
  '--ds-accent': '#245b45',
  '--ds-lift': 'rgb(0 0 0 / 0.05)',
  '--ds-press': 'rgb(0 0 0 / 0.09)',
  '--ds-accent-soft': '#e1ede5',
  '--ds-accent-fg': '#ffffff',
  '--ds-focus': '#41755c',
  '--ds-positive': '#226243',
  '--ds-danger': '#a52f35',
  '--ds-shadow-sm': '0 1px 2px rgb(34 30 25 / 0.10)',
  '--ds-shadow-md': '0 12px 32px rgb(34 30 25 / 0.10)',
  '--ds-backdrop': 'rgb(34 30 25 / 0.35)',
};

const DARK_TOKENS: Record<string, string> = {
  ...GEOMETRY_TOKENS,
  '--ds-radius-md': '12px',
  '--ds-radius-lg': '24px',
  '--ds-canvas': '#131715',
  '--ds-surface': '#191e1b',
  '--ds-raised': '#202622',
  '--ds-elevated': '#29302b',
  '--ds-active': '#333d36',
  '--ds-fg': '#edf2ee',
  '--ds-fg-muted': '#b1bdb4',
  '--ds-border': '#353e38',
  '--ds-accent': '#a1d6b6',
  '--ds-lift': 'rgb(255 255 255 / 0.07)',
  '--ds-press': 'rgb(255 255 255 / 0.11)',
  '--ds-accent-soft': '#293e32',
  '--ds-accent-fg': '#16281d',
  '--ds-focus': '#a1d6b6',
  '--ds-positive': '#9dd7b2',
  '--ds-danger': '#f29e9e',
  '--ds-shadow-sm': '0 1px 2px rgb(0 0 0 / 0.50)',
  '--ds-shadow-md': '0 12px 32px rgb(0 0 0 / 0.50)',
  '--ds-backdrop': 'rgb(0 0 0 / 0.35)',
};

export const OPENAI_INSPIRED_DESIGN_SYSTEM: DesignSystem = {
  id: 'openai-inspired',
  version: 1,
  name: 'OpenAI-inspired',
  modes: { light: LIGHT_TOKENS, dark: DARK_TOKENS },
  files: {
    'index.tsx': PRIMITIVES_TSX,
    'tokens.css': inter.css + KIT_CSS,
    'fonts/Inter-OFL.txt': inter.license,
  },
  guidance:
    UNIVERSAL_GUIDANCE +
    '\nOpenAI-inspired: a locally authored interpretation, not an official preset. Airy sans-serif layouts, neutral mineral surfaces and restrained forest-green actions. Keep copy direct and the hierarchy spacious.\n',
  examples: { 'Hey.tsx': HEY_TSX },
};
