// What the presets authored in code share past the primitives: the token
// vocabulary their documents group, which each preset gives a value for every
// name, the type roles and control sizes their stylesheets read from it, and
// the assembly into one immutable kit version.

import {
  buildDocument,
  type DocumentPart,
  type DocumentSource,
  type TokenGroup,
} from '../buildDocument.js';
import type { DesignSystem } from '../designSystems.js';
import { PRIMITIVES_TSX } from './primitives.js';
import { LICENSED_FONTS, PRIMITIVE_EXAMPLES, PRIMITIVE_PARTS, rulesNote } from './starter.js';
import { KIT_CSS } from './styles.js';

const VOCABULARY = [
  {
    kind: 'colors',
    title: 'Surfaces',
    names: [
      '--ds-canvas',
      '--ds-surface',
      '--ds-raised',
      '--ds-elevated',
      '--ds-active',
      '--ds-border',
      '--ds-border-strong',
      '--ds-backdrop',
    ],
  },
  {
    kind: 'colors',
    title: 'Text',
    names: ['--ds-fg', '--ds-fg-secondary', '--ds-fg-muted', '--ds-fg-quiet'],
  },
  {
    kind: 'colors',
    title: 'Status',
    names: [
      '--ds-positive',
      '--ds-positive-soft',
      '--ds-warning',
      '--ds-warning-soft',
      '--ds-danger',
      '--ds-danger-soft',
      '--ds-info',
      '--ds-info-soft',
    ],
  },
  {
    kind: 'colors',
    title: 'Interaction',
    names: ['--ds-lift', '--ds-press', '--ds-focus', '--ds-selection'],
  },
  {
    kind: 'typography',
    title: 'Type sizes',
    names: [
      '--ds-text-2xs',
      '--ds-text-xs',
      '--ds-text-sm',
      '--ds-text-base',
      '--ds-text-md',
      '--ds-text-lg',
      '--ds-text-xl',
      '--ds-text-2xl',
      '--ds-text-3xl',
      '--ds-text-4xl',
      '--ds-text-code',
    ],
  },
  {
    kind: 'typography',
    title: 'Type families',
    names: ['--ds-font-sans', '--ds-font-heading', '--ds-font-prose', '--ds-font-mono'],
  },
  {
    kind: 'typography',
    title: 'Weights',
    names: [
      '--ds-weight-regular',
      '--ds-weight-medium',
      '--ds-weight-semibold',
      '--ds-weight-bold',
      '--ds-weight-heading',
    ],
  },
  {
    kind: 'typography',
    title: 'Line heights',
    names: [
      '--ds-leading-tight',
      '--ds-leading-snug',
      '--ds-leading-normal',
      '--ds-leading-relaxed',
    ],
  },
  {
    kind: 'typography',
    title: 'Tracking',
    names: ['--ds-tracking-tight', '--ds-tracking-normal', '--ds-tracking-wide'],
  },
  {
    kind: 'spacing',
    title: 'Spacing scale',
    names: [
      '--ds-space-0-5',
      '--ds-space-1',
      '--ds-space-1-5',
      '--ds-space-2',
      '--ds-space-2-5',
      '--ds-space-3',
      '--ds-space-4',
      '--ds-space-5',
      '--ds-space-6',
      '--ds-space-8',
      '--ds-space-10',
      '--ds-space-12',
      '--ds-space-16',
    ],
  },
  {
    kind: 'radius',
    title: 'Corners',
    names: [
      '--ds-radius-xs',
      '--ds-radius-sm',
      '--ds-radius-md',
      '--ds-radius-lg',
      '--ds-radius-xl',
      '--ds-radius-2xl',
      '--ds-radius-pill',
    ],
  },
  {
    kind: 'shadows',
    title: 'Elevation',
    names: ['--ds-shadow-sm', '--ds-shadow-md', '--ds-shadow-lg'],
  },
  {
    kind: 'motion',
    title: 'Durations',
    names: ['--ds-duration-fast', '--ds-duration', '--ds-duration-slow'],
  },
  { kind: 'motion', title: 'Easing', names: ['--ds-ease', '--ds-ease-in'] },
  {
    kind: 'size',
    title: 'Controls',
    names: [
      '--ds-control-sm',
      '--ds-control-md',
      '--ds-control-lg',
      '--ds-icon-sm',
      '--ds-icon-md',
      '--ds-icon-lg',
    ],
  },
  {
    kind: 'size',
    title: 'Layout',
    names: ['--ds-sidebar-width', '--ds-reading-width', '--ds-content-width', '--ds-dialog-width'],
  },
] as const;

type VocabularyName = (typeof VOCABULARY)[number]['names'][number];
type ContractName = '--ds-accent' | '--ds-accent-soft' | '--ds-accent-fg';

/** One mode's values: every vocabulary token and any of the preset's own. */
export type PresetTokens = Record<VocabularyName | ContractName, string> & Record<string, string>;

// Type roles, tones and control sizes read the vocabulary, so a preset's look
// lives in its token values and its own stylesheet.
const AUTHORED_CSS = `body {
  line-height: var(--ds-leading-normal);
  font-weight: var(--ds-weight-regular);
}
h1,
h2 {
  font-weight: var(--ds-weight-heading);
  letter-spacing: var(--ds-tracking-tight);
  line-height: var(--ds-leading-snug);
}
code,
kbd,
pre,
samp {
  font-family: var(--ds-font-mono);
  font-size: var(--ds-text-code);
}
::selection {
  background: var(--ds-selection);
}
.ds-display,
.ds-title,
.ds-heading,
.ds-subheading {
  font-family: var(--ds-font-heading);
  font-weight: var(--ds-weight-heading);
  letter-spacing: var(--ds-tracking-tight);
  text-wrap: balance;
}
.ds-display {
  font-size: var(--ds-text-4xl);
  line-height: var(--ds-leading-tight);
}
.ds-title {
  font-size: var(--ds-text-3xl);
  line-height: var(--ds-leading-tight);
}
.ds-heading {
  font-size: var(--ds-text-2xl);
  line-height: var(--ds-leading-snug);
}
.ds-subheading {
  font-size: var(--ds-text-xl);
  line-height: var(--ds-leading-snug);
}
.ds-lead {
  font-family: var(--ds-font-prose);
  font-size: var(--ds-text-lg);
  line-height: var(--ds-leading-snug);
  text-wrap: pretty;
}
.ds-prose {
  font-family: var(--ds-font-prose);
  font-size: var(--ds-text-md);
  line-height: var(--ds-leading-relaxed);
  text-wrap: pretty;
}
.ds-body,
.ds-body-strong {
  font-size: var(--ds-text-base);
  line-height: var(--ds-leading-normal);
}
.ds-body-strong {
  font-weight: var(--ds-weight-medium);
}
.ds-label {
  font-size: var(--ds-text-sm);
  line-height: var(--ds-leading-snug);
  font-weight: var(--ds-weight-medium);
}
.ds-caption {
  font-size: var(--ds-text-xs);
  line-height: var(--ds-leading-normal);
}
.ds-overline {
  font-size: var(--ds-text-2xs);
  line-height: var(--ds-leading-snug);
  letter-spacing: var(--ds-tracking-wide);
  font-weight: var(--ds-weight-semibold);
  text-transform: uppercase;
}
.ds-code {
  font-family: var(--ds-font-mono);
  font-size: var(--ds-text-code);
  line-height: var(--ds-leading-normal);
  letter-spacing: 0;
}
.ds-tabular {
  font-variant-numeric: tabular-nums;
}
.ds-text-secondary {
  color: var(--ds-fg-secondary);
}
.ds-text-muted {
  color: var(--ds-fg-muted);
}
.ds-text-quiet {
  color: var(--ds-fg-quiet);
}
.ds-text-accent {
  color: var(--ds-accent);
}
.ds-skeleton {
  display: block;
  height: 0.625em;
  border-radius: var(--ds-radius-pill);
  background: color-mix(in srgb, var(--ds-fg) 9%, transparent);
}
.ds-button,
.ds-tab,
.ds-input {
  min-height: var(--ds-control-md);
  transition-timing-function: var(--ds-ease);
}
.ds-button svg,
.ds-tab svg {
  flex-shrink: 0;
}
.ds-dialog {
  width: min(var(--ds-dialog-width), calc(100% - 2rem));
  box-shadow: var(--ds-shadow-lg);
}
`;

/** The vocabulary's groups, which a document shows before the preset's own. */
const VOCABULARY_GROUPS: TokenGroup[] = VOCABULARY.map((group) => ({
  ...group,
  names: [...group.names],
}));

export interface AuthoredPreset {
  id: string;
  name: string;
  tokens: { light: PresetTokens; dark: PresetTokens };
  /** Groups for the preset's own tokens past the vocabulary. */
  groups?: TokenGroup[];
  /** Notes and demo previews for the Overview, after the shared rules. */
  overview: DocumentPart[];
  sectionNotes: NonNullable<DocumentSource['sectionNotes']>;
  /** How the preset uses a primitive, added to its API note, by that note's label. */
  usage: Partial<Record<string, string>>;
  /** Each embedded font by the stem of its licence file, fonts/<stem>-OFL.txt. */
  fonts: Record<string, { css: string; license: string }>;
  /** The preset's own stylesheet, after the shared one. */
  css: string;
  /** The cover's and the demos' sources by file name. */
  examples: Record<string, string> & { 'cover.tsx': string };
}

export function authoredPreset(preset: AuthoredPreset): DesignSystem {
  const components = PRIMITIVE_PARTS.map((part) => {
    if (part.kind !== 'note') return part;
    const usage = preset.usage[part.label];
    return usage === undefined ? part : { ...part, body: `${part.body}\n${usage}` };
  });
  const fonts = Object.entries(preset.fonts);
  return {
    id: preset.id,
    version: 1,
    name: preset.name,
    cover: { kind: 'preview', example: 'cover.tsx' },
    sections: buildDocument({
      tokens: preset.tokens,
      overview: [rulesNote(LICENSED_FONTS), ...preset.overview],
      groups: [...VOCABULARY_GROUPS, ...(preset.groups ?? [])],
      sectionNotes: preset.sectionNotes,
      components,
    }),
    files: {
      'index.tsx': PRIMITIVES_TSX,
      // Faces sit in their own sheet, which loads before tokens.css by path.
      'fonts.css': fonts.map(([, font]) => font.css).join(''),
      'tokens.css': KIT_CSS + AUTHORED_CSS + preset.css,
      ...Object.fromEntries(fonts.map(([stem, font]) => [`fonts/${stem}-OFL.txt`, font.license])),
    },
    examples: { ...PRIMITIVE_EXAMPLES, ...preset.examples },
  };
}
