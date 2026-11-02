import { authoredPreset } from '../authored.js';
import newsreader from '../fonts/newsreader.json' with { type: 'json' };
import schibstedGrotesk from '../fonts/schibsted-grotesk.json' with { type: 'json' };
import { COVER_TSX } from './cover.js';
import { ARCHIVE_TSX, ARTICLE_TSX } from './demos.js';
import { CHECKLIST, COPY, FEEL, INTERACTION, LAYOUT, SECTION_NOTES, USAGE } from './notes.js';
import { MARGIN_CSS } from './styles.js';
import { DARK, LIGHT } from './tokens.js';

/** Editorial: Newsreader for reading, Schibsted Grotesk for chrome, ink on stone paper and one claret. */
export const MARGIN_DESIGN_SYSTEM = authoredPreset({
  id: 'margin',
  name: 'Margin',
  tokens: { light: LIGHT, dark: DARK },
  overview: [
    { kind: 'note', label: '2-feel.md', body: FEEL },
    { kind: 'preview', title: 'Article', example: 'Article.tsx', width: 1200, height: 800 },
    { kind: 'note', label: '3-interaction.md', body: INTERACTION },
    { kind: 'note', label: '4-layout.md', body: LAYOUT },
    { kind: 'preview', title: 'Archive', example: 'Archive.tsx', width: 1040, height: 720 },
    { kind: 'note', label: '5-copy.md', body: COPY },
    { kind: 'note', label: '6-checklist.md', body: CHECKLIST },
  ],
  sectionNotes: SECTION_NOTES,
  usage: USAGE,
  fonts: { Newsreader: newsreader, SchibstedGrotesk: schibstedGrotesk },
  css: MARGIN_CSS,
  examples: { 'cover.tsx': COVER_TSX, 'Article.tsx': ARTICLE_TSX, 'Archive.tsx': ARCHIVE_TSX },
});
