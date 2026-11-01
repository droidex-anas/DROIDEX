import { buildDocument } from '../buildDocument.js';
import type { DesignSystem } from '../designSystems.js';
import inter from './fonts/inter.json' with { type: 'json' };
import { PRIMITIVES_TSX } from './primitives.js';
import { LICENSED_FONTS, PRIMITIVE_EXAMPLES, PRIMITIVE_PARTS, rulesNote } from './starter.js';
import { GEOMETRY_TOKENS, KIT_CSS } from './styles.js';

const LIGHT_TOKENS: Record<string, string> = {
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
};

const DARK_TOKENS: Record<string, string> = {
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
};

const FEEL_NOTE = `Warm paper and graphite, with restrained amber actions. Keep surfaces quiet, rounded and softly raised, and separate them with tone rather than lines. Use a compact sans-serif hierarchy: one heading size per view and muted text for everything secondary. The preview palette is independent of the app's chrome.
`;

const SETTINGS_TSX = `import { useState } from 'react';
import { Check } from 'lucide-react';
import { Badge, Button, Card, Input, Tabs } from '@droidex/design-system';

export default function SettingsPanel() {
  const [tab, setTab] = useState('general');
  const [name, setName] = useState('Northwind studio');
  const [saved, setSaved] = useState(false);
  return (
    <main className="min-h-screen bg-[color:var(--ds-canvas)] p-8">
      <Card className="mx-auto flex max-w-2xl flex-col gap-6">
        <div className="flex items-center justify-between gap-4">
          <h1>Settings</h1>
          <Badge>Team plan</Badge>
        </div>
        <Tabs
          label="Settings"
          value={tab}
          onValueChange={setTab}
          items={[
            {
              value: 'general',
              label: 'General',
              content: (
                <form
                  className="flex flex-col gap-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    setSaved(true);
                  }}
                >
                  <Input
                    label="Workspace name"
                    value={name}
                    onChange={(event) => {
                      setName(event.target.value);
                      setSaved(false);
                    }}
                    hint="Shown to everyone you invite."
                    error={name.trim() ? undefined : 'Give the workspace a name.'}
                  />
                  <Input label="Owner" defaultValue="ada@northwind.dev" disabled />
                  <div className="flex items-center gap-3">
                    <Button type="submit" disabled={!name.trim() || saved}>
                      {saved ? <Check size={16} aria-hidden="true" /> : null}
                      {saved ? 'Saved' : 'Save changes'}
                    </Button>
                    <Button variant="quiet" onClick={() => setName('Northwind studio')}>
                      Reset
                    </Button>
                  </div>
                </form>
              ),
            },
            {
              value: 'members',
              label: 'Members',
              content: <p className="text-[color:var(--ds-fg-muted)]">Four people work here.</p>,
            },
            { value: 'billing', label: 'Billing', disabled: true, content: null },
          ]}
        />
      </Card>
    </main>
  );
}
`;

const COVER_TSX = `import { ArrowRight, Sparkles } from 'lucide-react';
import { Badge, Button, Card } from '@droidex/design-system';

const SESSIONS = [
  { name: 'Design review', state: 'Waiting for you' },
  { name: 'Quarterly report', state: 'Running' },
  { name: 'Welcome tour', state: 'Almost done' },
  { name: 'Assets sync', state: 'Queued' },
  { name: 'Beta invites', state: 'Queued' },
  { name: 'Import from Figma', state: 'Queued' },
];

export default function Cover() {
  return (
    <main className="flex h-screen overflow-hidden bg-[color:var(--ds-canvas)] px-16">
      <div className="flex flex-1 flex-col justify-end gap-6 pb-16 pr-16">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-[var(--ds-radius-md)] bg-[color:var(--ds-accent)] text-[color:var(--ds-accent-fg)]">
            <Sparkles size={20} aria-hidden="true" />
          </span>
          <span className="text-[length:var(--ds-text-lg)] font-semibold tracking-tight">DROIDEX</span>
        </div>
        <h1 className="max-w-md text-[length:3rem]">Quiet surfaces for focused work.</h1>
        <p className="max-w-md text-[color:var(--ds-fg-muted)]">
          Warm paper, graphite text and one amber action per view.
        </p>
        <div className="flex gap-3">
          <Button>
            Get started
            <ArrowRight size={16} aria-hidden="true" />
          </Button>
          <Button variant="secondary">Read the rules</Button>
        </div>
      </div>
      <Card className="mt-24 flex w-[28rem] shrink-0 flex-col gap-5 self-start p-6">
        <div className="flex items-center justify-between">
          <h2>Three sessions running</h2>
          <Badge>Today</Badge>
        </div>
        <ul className="flex flex-col gap-6">
          {SESSIONS.map((session) => (
            <li key={session.name} className="flex items-center justify-between gap-6 py-1.5">
              <span>{session.name}</span>
              <span className="text-[color:var(--ds-fg-muted)]">{session.state}</span>
            </li>
          ))}
        </ul>
      </Card>
    </main>
  );
}
`;

export const DROIDEX_DESIGN_SYSTEM: DesignSystem = {
  id: 'droidex',
  version: 1,
  name: 'DROIDEX',
  cover: { kind: 'preview', example: 'cover.tsx' },
  sections: buildDocument({
    tokens: { light: LIGHT_TOKENS, dark: DARK_TOKENS },
    overview: [
      rulesNote(LICENSED_FONTS),
      { kind: 'note', label: '2-feel.md', body: FEEL_NOTE },
      {
        kind: 'preview',
        title: 'Settings panel',
        example: 'SettingsPanel.tsx',
        width: 960,
        height: 640,
      },
    ],
    components: PRIMITIVE_PARTS,
  }),
  files: {
    'index.tsx': PRIMITIVES_TSX,
    'tokens.css': inter.css + KIT_CSS,
    'fonts/Inter-OFL.txt': inter.license,
  },
  examples: { ...PRIMITIVE_EXAMPLES, 'SettingsPanel.tsx': SETTINGS_TSX, 'cover.tsx': COVER_TSX },
};
