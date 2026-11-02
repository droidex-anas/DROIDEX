import { authoredPreset } from '../authored.js';
import manrope from '../fonts/manrope.json' with { type: 'json' };
import { COVER_TSX } from './cover.js';
import { INVOICES_TSX, PRICING_TSX } from './demos.js';
import { CHECKLIST, COPY, FEEL, INTERACTION, LAYOUT, SECTION_NOTES, USAGE } from './notes.js';
import { GRIDLINE_CSS } from './styles.js';
import { DARK, GROUPS, LIGHT } from './tokens.js';

/** Crisp B2B SaaS: Manrope, slate surfaces, one cobalt accent and dense tabular data. */
export const GRIDLINE_DESIGN_SYSTEM = authoredPreset({
  id: 'gridline',
  name: 'Gridline',
  tokens: { light: LIGHT, dark: DARK },
  groups: GROUPS,
  overview: [
    { kind: 'note', label: '2-feel.md', body: FEEL },
    { kind: 'preview', title: 'Invoices', example: 'Invoices.tsx', width: 1200, height: 600 },
    { kind: 'note', label: '3-interaction.md', body: INTERACTION },
    { kind: 'note', label: '4-layout.md', body: LAYOUT },
    { kind: 'preview', title: 'Pricing', example: 'PricingCard.tsx', width: 1040, height: 600 },
    { kind: 'note', label: '5-copy.md', body: COPY },
    { kind: 'note', label: '6-checklist.md', body: CHECKLIST },
  ],
  sectionNotes: SECTION_NOTES,
  usage: USAGE,
  fonts: { Manrope: manrope },
  css: GRIDLINE_CSS,
  examples: {
    'cover.tsx': COVER_TSX,
    'Invoices.tsx': INVOICES_TSX,
    'PricingCard.tsx': PRICING_TSX,
  },
});
