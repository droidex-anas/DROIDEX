import type { DesignSystem } from '../designSystems.js';
import lora from './fonts/lora.json';
import inter from './fonts/inter.json';
import { PRIMITIVES_TSX } from './primitives.js';
import { HEY_TSX, UNIVERSAL_GUIDANCE } from './starter.js';
import { GEOMETRY_TOKENS, KIT_CSS } from './styles.js';

const LIGHT_TOKENS: Record<string, string> = {
  ...GEOMETRY_TOKENS,
  '--ds-font-heading': 'Lora, ui-serif, Georgia, serif',
  '--ds-radius-md': '8px',
  '--ds-radius-lg': '16px',
  '--ds-canvas': '#f8f5ef',
  '--ds-surface': '#faf7f1',
  '--ds-raised': '#fffcf6',
  '--ds-elevated': '#f0eae0',
  '--ds-active': '#e7ddcf',
  '--ds-fg': '#30271f',
  '--ds-fg-muted': '#665747',
  '--ds-border': '#e3d8c9',
  '--ds-accent': '#91462f',
  '--ds-lift': 'rgb(0 0 0 / 0.07)',
  '--ds-press': 'rgb(0 0 0 / 0.11)',
  '--ds-accent-soft': '#f3e1d5',
  '--ds-accent-fg': '#fffaf3',
  '--ds-focus': '#a05e42',
  '--ds-positive': '#386848',
  '--ds-danger': '#a02f34',
  '--ds-shadow-sm': '0 1px 2px rgb(34 30 25 / 0.10)',
  '--ds-shadow-md': '0 12px 32px rgb(34 30 25 / 0.10)',
  '--ds-backdrop': 'rgb(34 30 25 / 0.35)',
};

const DARK_TOKENS: Record<string, string> = {
  ...GEOMETRY_TOKENS,
  '--ds-font-heading': 'Lora, ui-serif, Georgia, serif',
  '--ds-radius-md': '8px',
  '--ds-radius-lg': '16px',
  '--ds-canvas': '#1b1815',
  '--ds-surface': '#211d19',
  '--ds-raised': '#29231e',
  '--ds-elevated': '#332b24',
  '--ds-active': '#3e342a',
  '--ds-fg': '#f4e9dc',
  '--ds-fg-muted': '#c3b19c',
  '--ds-border': '#493c31',
  '--ds-accent': '#e9a285',
  '--ds-lift': 'rgb(255 255 255 / 0.09)',
  '--ds-press': 'rgb(255 255 255 / 0.13)',
  '--ds-accent-soft': '#493126',
  '--ds-accent-fg': '#301b13',
  '--ds-focus': '#e9a285',
  '--ds-positive': '#a6c798',
  '--ds-danger': '#f2a296',
  '--ds-shadow-sm': '0 1px 2px rgb(0 0 0 / 0.50)',
  '--ds-shadow-md': '0 12px 32px rgb(0 0 0 / 0.50)',
  '--ds-backdrop': 'rgb(0 0 0 / 0.35)',
};

export const CLAUDE_INSPIRED_DESIGN_SYSTEM: DesignSystem = {
  id: 'claude-inspired',
  version: 1,
  name: 'Claude-inspired',
  modes: { light: LIGHT_TOKENS, dark: DARK_TOKENS },
  files: {
    'index.tsx': PRIMITIVES_TSX,
    'tokens.css': inter.css + lora.css + KIT_CSS,
    'fonts/Inter-OFL.txt': inter.license,
    'fonts/Lora-OFL.txt': lora.license,
  },
  guidance:
    UNIVERSAL_GUIDANCE +
    '\nClaude-inspired: a locally authored interpretation, not an official preset. Warm parchment, clay actions and Lora serif headings with Inter controls. Use an editorial rhythm, generous reading space and gentle shadows.\n',
  examples: { 'Hey.tsx': HEY_TSX },
};
