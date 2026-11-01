// The notes, previews and examples the presets authored in code share: the rules
// that hold for any kit, and one note and one preview per shared primitive. Each
// of those presets copies them into its own immutable version. A new kit that is not a copy (blank,
// imported or extracted) starts from the same primitives with the starter's
// token values and files.

import type { DocumentPart } from '../buildDocument.js';
import inter from './fonts/inter.json' with { type: 'json' };
import { PRIMITIVES_TSX } from './primitives.js';
import { GEOMETRY_TOKENS, KIT_CSS } from './styles.js';

export const LICENSED_FONTS =
  'The kit includes licensed Latin fonts; other scripts use local system fonts.';

/** The rules that hold under every kit; `fonts` says what the kit embeds. */
export function rulesNote(fonts: string): DocumentPart {
  return {
    kind: 'note',
    label: '1-rules.md',
    body: `Give every control a real action, a label, and honest loading, empty and error states. Keep the focus, disabled and reduced-motion behaviour. Use buttons, not clickable divs, and reserve a primary action for the next useful step.

Use the semantic --ds-* tokens: foreground on raised, surface and canvas; muted for secondary text; accent-fg on accent; foreground on accent-soft. Separate layers with tone and shadow, not nested outlines. For hover and press, lay the translucent --ds-lift and --ds-press over a control's own background, never a second hard-coded colour.

Write complete literal Tailwind 3 classes in every source file; never concatenate class fragments. Import named icons from lucide-react, never a dynamic icon map. Decorative icons use aria-hidden; icon-only buttons need an accessible name.

Imports are limited to react, react/jsx-runtime, react-dom/client, lucide-react, simple-icons, @droidex/design-system and relative source modules; any other package fails, and so do remote imports and fonts. ${fonts} Local component state resets on a source revision or refresh.
`,
  };
}

interface Primitive {
  name: string;
  api: string;
  size: { width: number; height: number };
  example: string;
}

function primitive(name: string, api: string, size: Primitive['size'], example: string): Primitive {
  return { name, api, size, example };
}

const PRIMITIVES: Primitive[] = [
  primitive(
    'Button',
    '`Button` from @droidex/design-system takes native button props and `variant`: primary, secondary or quiet (primary by default). Use one primary per view; secondary for the other actions and quiet for low-emphasis ones such as Cancel.\n',
    { width: 640, height: 200 },
    `import { ArrowRight } from 'lucide-react';
import { Button } from '@droidex/design-system';

export default function ButtonStates() {
  return (
    <main className="flex min-h-screen flex-col justify-center gap-4 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button>
          Continue
          <ArrowRight size={16} aria-hidden="true" />
        </Button>
        <Button variant="secondary">Save draft</Button>
        <Button variant="quiet">Cancel</Button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled>Continue</Button>
        <Button variant="secondary" disabled>
          Save draft
        </Button>
        <Button variant="quiet" disabled>
          Cancel
        </Button>
      </div>
    </main>
  );
}
`,
  ),
  primitive(
    'Input',
    '`Input` takes native input props plus a required visible `label` and an optional `hint` or `error`; it connects both to the field for assistive technology, and `error` marks the field invalid.\n',
    { width: 640, height: 360 },
    `import { useState } from 'react';
import { Input } from '@droidex/design-system';

export default function InputStates() {
  const [email, setEmail] = useState('');
  return (
    <main className="grid min-h-screen grid-cols-2 content-center gap-6 p-6">
      <Input
        label="Email"
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="you@example.com"
        hint="We only use it to sign you in."
      />
      <Input label="Team name" defaultValue="Northwind" />
      <Input label="Workspace URL" defaultValue="north wind" error="Use letters, digits and hyphens." />
      <Input label="Plan" defaultValue="Team" disabled />
    </main>
  );
}
`,
  ),
  primitive(
    'Card',
    '`Card` takes div props and children and gives them the raised surface, the large radius and the medium shadow. Use it for a grouped block; do not nest cards.\n',
    { width: 640, height: 320 },
    `import { Button, Card } from '@droidex/design-system';

export default function CardStates() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="flex w-full max-w-md flex-col gap-4">
        <div className="space-y-2">
          <h2>Weekly summary</h2>
          <p className="text-[color:var(--ds-fg-muted)]">
            Twelve designs changed this week, three of them waiting for review.
          </p>
        </div>
        <div className="flex gap-3">
          <Button>Review now</Button>
          <Button variant="quiet">Later</Button>
        </div>
      </Card>
    </main>
  );
}
`,
  ),
  primitive(
    'Badge',
    '`Badge` takes span props: a short status or category label on the soft accent. Keep it to one or two words.\n',
    { width: 480, height: 160 },
    `import { Badge } from '@droidex/design-system';

export default function BadgeStates() {
  return (
    <main className="flex min-h-screen flex-wrap items-center justify-center gap-3 p-6">
      <Badge>New</Badge>
      <Badge>In review</Badge>
      <Badge>Shipped</Badge>
    </main>
  );
}
`,
  ),
  primitive(
    'Tabs',
    '`Tabs` takes `label`, `value`, `onValueChange` and `items`: `{ value, label, content, disabled? }[]`. Use unique item values and keep `value` on an enabled item. Arrow keys, Home and End move and select; Tab enters the active panel.\n',
    { width: 640, height: 280 },
    `import { useState } from 'react';
import { Tabs } from '@droidex/design-system';

export default function TabsStates() {
  const [tab, setTab] = useState('overview');
  return (
    <main className="min-h-screen p-6">
      <Tabs
        label="Project"
        value={tab}
        onValueChange={setTab}
        items={[
          { value: 'overview', label: 'Overview', content: <p>Everything about this project at a glance.</p> },
          { value: 'activity', label: 'Activity', content: <p>Three changes since yesterday.</p> },
          { value: 'archive', label: 'Archive', disabled: true, content: null },
        ]}
      />
    </main>
  );
}
`,
  ),
  primitive(
    'Dialog',
    '`Dialog` takes `open`, `onClose`, `title` and children. Keep `open` in state and set it false in `onClose`. Tab stays inside, Escape asks to close, and closing returns focus to an enabled, visible opener. Set `returnFocusId` when closing hides the opener, and `fallbackFocusId` when that destination can be disabled.\n',
    { width: 720, height: 420 },
    `import { useState } from 'react';
import { Button, Dialog } from '@droidex/design-system';

export default function DialogStates() {
  const [open, setOpen] = useState(true);
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Rename project
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Rename project">
        <p>The new name shows everywhere this project appears.</p>
        <div className="mt-4 flex justify-end gap-3">
          <Button variant="quiet" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={() => setOpen(false)}>Rename</Button>
        </div>
      </Dialog>
    </main>
  );
}
`,
  ),
];

/** Each primitive's API note followed by its preview, for a Components section. */
export const PRIMITIVE_PARTS: DocumentPart[] = PRIMITIVES.flatMap(({ name, api, size }) => [
  { kind: 'note', label: `${name.toLowerCase()}.md`, body: api },
  { kind: 'preview', title: name, example: `${name}.tsx`, ...size },
]);

/** The examples the primitive previews render, by file name. */
export const PRIMITIVE_EXAMPLES: Record<string, string> = Object.fromEntries(
  PRIMITIVES.map(({ name, example }) => [`${name}.tsx`, example]),
);

/** A value for every token the shared primitives read: warm paper, graphite text and an amber accent. */
export const STARTER_TOKENS: Record<'light' | 'dark', Record<string, string>> = {
  light: {
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
  },
  dark: {
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
  },
};

/** The shared primitives, their stylesheet and Inter, which the starter's type tokens name. */
export const STARTER_FILES: Record<string, string> = {
  'index.tsx': PRIMITIVES_TSX,
  'tokens.css': inter.css + KIT_CSS,
  'fonts/Inter-OFL.txt': inter.license,
};
