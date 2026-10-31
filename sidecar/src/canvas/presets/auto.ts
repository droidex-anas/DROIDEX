import { buildDocument } from '../buildDocument.js';
import type { DesignSystem } from '../designSystems.js';
import { PRIMITIVES_TSX } from './primitives.js';
import { PRIMITIVE_EXAMPLES, PRIMITIVE_PARTS, rulesNote } from './starter.js';
import { GEOMETRY_TOKENS, KIT_CSS } from './styles.js';

// A blank base rather than a look: greys, a monochrome accent and the system
// font, so the primitives work until the design sets its own --ds-* values.
const SYSTEM_FONTS = {
  '--ds-font-sans': 'ui-sans-serif, system-ui, sans-serif',
  '--ds-font-heading': 'ui-sans-serif, system-ui, sans-serif',
};

const LIGHT_TOKENS: Record<string, string> = {
  ...GEOMETRY_TOKENS,
  ...SYSTEM_FONTS,
  '--ds-canvas': '#ffffff',
  '--ds-surface': '#ffffff',
  '--ds-raised': '#ffffff',
  '--ds-elevated': '#f4f4f5',
  '--ds-active': '#e9e9eb',
  '--ds-fg': '#18181b',
  '--ds-fg-muted': '#5f5f67',
  '--ds-border': '#e4e4e7',
  '--ds-accent': '#18181b',
  '--ds-lift': 'rgb(0 0 0 / 0.05)',
  '--ds-press': 'rgb(0 0 0 / 0.09)',
  '--ds-accent-soft': '#ededef',
  '--ds-accent-fg': '#ffffff',
  '--ds-focus': '#71717a',
  '--ds-positive': '#2f7d4f',
  '--ds-danger': '#b42318',
  '--ds-backdrop': 'rgb(0 0 0 / 0.3)',
  '--ds-shadow-sm': '0 1px 2px rgb(0 0 0 / 0.06)',
  '--ds-shadow-md': '0 12px 32px rgb(0 0 0 / 0.10)',
};

const DARK_TOKENS: Record<string, string> = {
  ...GEOMETRY_TOKENS,
  ...SYSTEM_FONTS,
  '--ds-canvas': '#0f0f10',
  '--ds-surface': '#161617',
  '--ds-raised': '#1c1c1e',
  '--ds-elevated': '#232325',
  '--ds-active': '#2c2c2f',
  '--ds-fg': '#ededee',
  '--ds-fg-muted': '#a1a1aa',
  '--ds-border': '#2e2e31',
  '--ds-accent': '#ededee',
  '--ds-lift': 'rgb(255 255 255 / 0.08)',
  '--ds-press': 'rgb(255 255 255 / 0.12)',
  '--ds-accent-soft': '#2a2a2d',
  '--ds-accent-fg': '#111112',
  '--ds-focus': '#a1a1aa',
  '--ds-positive': '#6cc08f',
  '--ds-danger': '#ef8a80',
  '--ds-backdrop': 'rgb(0 0 0 / 0.5)',
  '--ds-shadow-sm': '0 1px 2px rgb(0 0 0 / 0.40)',
  '--ds-shadow-md': '0 16px 44px rgb(0 0 0 / 0.50)',
};

const AUTO_NOTE =
  "The user chose no design system, so this one has no look of its own. Take the style from, in order: the request itself (a product, brand, mood or reference it names), the frames already on this canvas (match their palette, type, spacing and radius), then your own judgement. Set that style as --ds-* token overrides in a stylesheet of the frame's own, for example :root { --ds-accent: …; --ds-canvas: … } in styles.css, so the primitives take it on; give dark its own values under [data-mode='dark'] when it needs them. These neutral tokens are a blank base, not a style to keep. Auto is not the DROIDEX preset: use DROIDEX's warm paper and amber only when the user asks for DROIDEX. Builds are not checked against a kit under Auto.\n";

/** The resting kit: no style of its own, so the agent derives one per request. */
export const AUTO_DESIGN_SYSTEM: DesignSystem = {
  id: 'auto',
  version: 1,
  name: 'Auto',
  cover: null,
  sections: buildDocument({
    tokens: { light: LIGHT_TOKENS, dark: DARK_TOKENS },
    overview: [
      rulesNote('Auto embeds no fonts: use local system font stacks.'),
      { kind: 'note', label: '2-feel.md', body: AUTO_NOTE },
    ],
    components: PRIMITIVE_PARTS,
  }),
  files: { 'index.tsx': PRIMITIVES_TSX, 'tokens.css': KIT_CSS },
  examples: PRIMITIVE_EXAMPLES,
};
