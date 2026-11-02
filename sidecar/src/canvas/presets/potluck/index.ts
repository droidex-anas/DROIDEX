import { authoredPreset } from '../authored.js';
import nunito from '../fonts/nunito.json' with { type: 'json' };
import { COVER_TSX } from './cover.js';
import { EVENT_TSX, PLANS_TSX } from './demos.js';
import { CHECKLIST, COPY, FEEL, INTERACTION, LAYOUT, SECTION_NOTES, USAGE } from './notes.js';
import { POTLUCK_CSS } from './styles.js';
import { DARK, GROUPS, LIGHT } from './tokens.js';

/** Friendly consumer: Nunito, warm cream, pastel tints and one basil green. */
export const POTLUCK_DESIGN_SYSTEM = authoredPreset({
  id: 'potluck',
  name: 'Potluck',
  tokens: { light: LIGHT, dark: DARK },
  groups: GROUPS,
  overview: [
    { kind: 'note', label: '2-feel.md', body: FEEL },
    { kind: 'preview', title: 'Event', example: 'Event.tsx', width: 1200, height: 720 },
    { kind: 'note', label: '3-interaction.md', body: INTERACTION },
    { kind: 'note', label: '4-layout.md', body: LAYOUT },
    { kind: 'preview', title: 'Plans', example: 'Plans.tsx', width: 1040, height: 600 },
    { kind: 'note', label: '5-copy.md', body: COPY },
    { kind: 'note', label: '6-checklist.md', body: CHECKLIST },
  ],
  sectionNotes: SECTION_NOTES,
  usage: USAGE,
  fonts: { Nunito: nunito },
  css: POTLUCK_CSS,
  examples: { 'cover.tsx': COVER_TSX, 'Event.tsx': EVENT_TSX, 'Plans.tsx': PLANS_TSX },
});
