import { buildDocument } from '../buildDocument.js';
import type { DesignSystem } from '../designSystems.js';
import lora from './fonts/lora.json' with { type: 'json' };
import inter from './fonts/inter.json' with { type: 'json' };
import { PRIMITIVES_TSX } from './primitives.js';
import { LICENSED_FONTS, PRIMITIVE_EXAMPLES, PRIMITIVE_PARTS, rulesNote } from './starter.js';
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

const FEEL_NOTE = `A locally authored interpretation, not an official preset. Warm parchment, clay actions and Lora serif headings over Inter controls. Use an editorial rhythm: generous reading space, a measure of about 65 characters for prose, and gentle shadows rather than borders.
`;

const READING_TSX = `import { useState } from 'react';
import { Bookmark, BookmarkCheck } from 'lucide-react';
import { Badge, Button, Card } from '@droidex/design-system';

export default function ReadingView() {
  const [saved, setSaved] = useState(false);
  return (
    <main className="min-h-screen bg-[color:var(--ds-canvas)] px-8 py-12">
      <article className="mx-auto flex max-w-xl flex-col gap-6">
        <Badge>Essay · 6 min read</Badge>
        <h1>On writing things down</h1>
        <p className="text-[color:var(--ds-fg-muted)]">
          A note kept is a decision you no longer have to make twice.
        </p>
        <p>
          Most of what we know at the end of a day is gone by the next morning. The habit of writing a few
          lines before closing the laptop turns a busy day into one you can return to: what changed, what is
          still open, and what you would do first tomorrow.
        </p>
        <Card className="flex flex-col gap-3">
          <h2>Try it tonight</h2>
          <p>Three lines are enough. Keep them where you will see them first.</p>
        </Card>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={() => setSaved(!saved)} aria-pressed={saved}>
            {saved ? <BookmarkCheck size={16} aria-hidden="true" /> : <Bookmark size={16} aria-hidden="true" />}
            {saved ? 'Saved' : 'Save for later'}
          </Button>
        </div>
      </article>
    </main>
  );
}
`;

const COVER_TSX = `import { ArrowRight, Feather } from 'lucide-react';
import { Button } from '@droidex/design-system';

export default function Cover() {
  return (
    <main className="flex h-screen items-center gap-16 overflow-hidden bg-[color:var(--ds-canvas)] px-16">
      <div className="flex flex-1 flex-col gap-6">
        <div className="flex items-center gap-3 text-[color:var(--ds-accent)]">
          <Feather size={24} aria-hidden="true" />
          <span className="font-[family-name:var(--ds-font-heading)] text-[length:var(--ds-text-lg)] text-[color:var(--ds-fg)]">
            Claude-inspired
          </span>
        </div>
        <h1 className="max-w-lg">Room to think, and words worth reading.</h1>
        <Button className="w-fit">
          Start writing
          <ArrowRight size={16} aria-hidden="true" />
        </Button>
      </div>
      <blockquote className="max-w-sm rounded-[var(--ds-radius-lg)] bg-[color:var(--ds-raised)] p-8 font-[family-name:var(--ds-font-heading)] text-[length:var(--ds-text-lg)] shadow-[var(--ds-shadow-md)]">
        “The first draft is just you telling yourself the story.”
      </blockquote>
    </main>
  );
}
`;

export const CLAUDE_INSPIRED_DESIGN_SYSTEM: DesignSystem = {
  id: 'claude-inspired',
  version: 1,
  name: 'Claude-inspired',
  cover: { kind: 'preview', example: 'cover.tsx' },
  sections: buildDocument({
    tokens: { light: LIGHT_TOKENS, dark: DARK_TOKENS },
    overview: [
      rulesNote(LICENSED_FONTS),
      { kind: 'note', label: '2-feel.md', body: FEEL_NOTE },
      {
        kind: 'preview',
        title: 'Reading view',
        example: 'ReadingView.tsx',
        width: 960,
        height: 720,
      },
    ],
    components: PRIMITIVE_PARTS,
  }),
  files: {
    'index.tsx': PRIMITIVES_TSX,
    'tokens.css': inter.css + lora.css + KIT_CSS,
    'fonts/Inter-OFL.txt': inter.license,
    'fonts/Lora-OFL.txt': lora.license,
  },
  examples: { ...PRIMITIVE_EXAMPLES, 'ReadingView.tsx': READING_TSX, 'cover.tsx': COVER_TSX },
};
