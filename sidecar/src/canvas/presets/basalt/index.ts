import { authoredPreset } from '../authored.js';
import instrumentSans from '../fonts/instrument-sans.json' with { type: 'json' };
import jetbrainsMono from '../fonts/jetbrains-mono.json' with { type: 'json' };
import { COVER_TSX } from './cover.js';
import { API_KEYS_TSX, DEPLOYMENTS_TSX } from './demos.js';
import { CHECKLIST, COPY, FEEL, INTERACTION, LAYOUT, SECTION_NOTES, USAGE } from './notes.js';
import { BASALT_CSS } from './styles.js';
import { DARK, GROUPS, LIGHT } from './tokens.js';

/** Dark-first developer tool: Instrument Sans chrome, JetBrains Mono for code, basalt greys and one lava accent. */
export const BASALT_DESIGN_SYSTEM = authoredPreset({
  id: 'basalt',
  name: 'Basalt',
  tokens: { light: LIGHT, dark: DARK },
  groups: GROUPS,
  overview: [
    { kind: 'note', label: '2-feel.md', body: FEEL },
    { kind: 'preview', title: 'Deployments', example: 'Deployments.tsx', width: 1200, height: 640 },
    { kind: 'note', label: '3-interaction.md', body: INTERACTION },
    { kind: 'note', label: '4-layout.md', body: LAYOUT },
    { kind: 'preview', title: 'API keys', example: 'ApiKeys.tsx', width: 1040, height: 600 },
    { kind: 'note', label: '5-copy.md', body: COPY },
    { kind: 'note', label: '6-checklist.md', body: CHECKLIST },
  ],
  sectionNotes: SECTION_NOTES,
  usage: USAGE,
  fonts: { InstrumentSans: instrumentSans, JetBrainsMono: jetbrainsMono },
  css: BASALT_CSS,
  examples: {
    'cover.tsx': COVER_TSX,
    'Deployments.tsx': DEPLOYMENTS_TSX,
    'ApiKeys.tsx': API_KEYS_TSX,
  },
});
