import { buildDocument } from '../buildDocument.js';
import type { DesignSystem } from '../designSystems.js';
import inter from './fonts/inter.json' with { type: 'json' };
import { PRIMITIVES_TSX } from './primitives.js';
import { LICENSED_FONTS, PRIMITIVE_EXAMPLES, PRIMITIVE_PARTS, rulesNote } from './starter.js';
import { GEOMETRY_TOKENS, KIT_CSS } from './styles.js';

const LIGHT_TOKENS: Record<string, string> = {
  ...GEOMETRY_TOKENS,
  '--ds-radius-md': '12px',
  '--ds-radius-lg': '24px',
  '--ds-canvas': '#f7f7f5',
  '--ds-surface': '#fafaf8',
  '--ds-raised': '#fdfdfb',
  '--ds-elevated': '#eeefeb',
  '--ds-active': '#e2e5df',
  '--ds-fg': '#202622',
  '--ds-fg-muted': '#535b55',
  '--ds-border': '#dddfd9',
  '--ds-accent': '#245b45',
  '--ds-lift': 'rgb(0 0 0 / 0.05)',
  '--ds-press': 'rgb(0 0 0 / 0.09)',
  '--ds-accent-soft': '#e1ede5',
  '--ds-accent-fg': '#ffffff',
  '--ds-focus': '#41755c',
  '--ds-positive': '#226243',
  '--ds-danger': '#a52f35',
  '--ds-shadow-sm': '0 1px 2px rgb(34 30 25 / 0.10)',
  '--ds-shadow-md': '0 12px 32px rgb(34 30 25 / 0.10)',
  '--ds-backdrop': 'rgb(34 30 25 / 0.35)',
};

const DARK_TOKENS: Record<string, string> = {
  ...GEOMETRY_TOKENS,
  '--ds-radius-md': '12px',
  '--ds-radius-lg': '24px',
  '--ds-canvas': '#131715',
  '--ds-surface': '#191e1b',
  '--ds-raised': '#202622',
  '--ds-elevated': '#29302b',
  '--ds-active': '#333d36',
  '--ds-fg': '#edf2ee',
  '--ds-fg-muted': '#b1bdb4',
  '--ds-border': '#353e38',
  '--ds-accent': '#a1d6b6',
  '--ds-lift': 'rgb(255 255 255 / 0.07)',
  '--ds-press': 'rgb(255 255 255 / 0.11)',
  '--ds-accent-soft': '#293e32',
  '--ds-accent-fg': '#16281d',
  '--ds-focus': '#a1d6b6',
  '--ds-positive': '#9dd7b2',
  '--ds-danger': '#f29e9e',
  '--ds-shadow-sm': '0 1px 2px rgb(0 0 0 / 0.50)',
  '--ds-shadow-md': '0 12px 32px rgb(0 0 0 / 0.50)',
  '--ds-backdrop': 'rgb(0 0 0 / 0.35)',
};

const FEEL_NOTE = `A locally authored interpretation, not an official preset. Airy sans-serif layouts, neutral mineral surfaces and restrained forest-green actions. Keep copy direct, give the hierarchy room, and let large radii and soft shadows carry the structure.
`;

const PRICING_TSX = `import { useState } from 'react';
import { Check } from 'lucide-react';
import { Badge, Button, Card, Tabs } from '@droidex/design-system';

const PLANS = [
  { name: 'Free', monthly: 0, features: ['One project', 'Community support'] },
  { name: 'Plus', monthly: 20, features: ['Unlimited projects', 'Priority support', 'Shared history'] },
];

export default function PricingCard() {
  const [billing, setBilling] = useState('monthly');
  const [chosen, setChosen] = useState('');
  const price = (monthly: number) => (billing === 'yearly' ? monthly * 10 : monthly);
  return (
    <main className="flex min-h-screen flex-col items-center gap-8 bg-[color:var(--ds-canvas)] p-10">
      <h1>Choose a plan</h1>
      <Tabs
        label="Billing period"
        value={billing}
        onValueChange={setBilling}
        items={[
          { value: 'monthly', label: 'Monthly', content: null },
          { value: 'yearly', label: 'Yearly', content: null },
        ]}
      />
      <div className="grid w-full max-w-3xl grid-cols-2 gap-6">
        {PLANS.map((plan) => (
          <Card key={plan.name} className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2>{plan.name}</h2>
              {plan.name === 'Plus' ? <Badge>Popular</Badge> : null}
            </div>
            <p className="text-[length:var(--ds-text-xl)] font-semibold">
              {'$' + price(plan.monthly)}
              <span className="text-[length:var(--ds-text-sm)] font-normal text-[color:var(--ds-fg-muted)]">
                {billing === 'yearly' ? ' a year' : ' a month'}
              </span>
            </p>
            <ul className="flex flex-col gap-2">
              {plan.features.map((feature) => (
                <li key={feature} className="flex items-center gap-2">
                  <Check size={16} aria-hidden="true" />
                  {feature}
                </li>
              ))}
            </ul>
            <Button
              variant={plan.name === 'Plus' ? 'primary' : 'secondary'}
              disabled={chosen === plan.name}
              onClick={() => setChosen(plan.name)}
            >
              {chosen === plan.name ? 'Current plan' : 'Choose ' + plan.name}
            </Button>
          </Card>
        ))}
      </div>
    </main>
  );
}
`;

const COVER_TSX = `import { ArrowRight, Circle } from 'lucide-react';
import { Button, Card, Input } from '@droidex/design-system';

export default function Cover() {
  return (
    <main className="flex h-screen flex-col items-center justify-center gap-8 overflow-hidden bg-[color:var(--ds-canvas)] px-16 text-center">
      <div className="flex items-center gap-2">
        <Circle size={22} aria-hidden="true" className="text-[color:var(--ds-accent)]" />
        <span className="text-[length:var(--ds-text-lg)] font-semibold">OpenAI-inspired</span>
      </div>
      <h1 className="max-w-xl">Clear answers, plenty of room.</h1>
      <Card className="flex w-full max-w-xl items-end gap-3 text-left">
        <div className="flex-1">
          <Input label="Ask anything" placeholder="Plan a three-day trip to Lisbon" />
        </div>
        <Button aria-label="Send">
          <ArrowRight size={16} aria-hidden="true" />
        </Button>
      </Card>
    </main>
  );
}
`;

export const OPENAI_INSPIRED_DESIGN_SYSTEM: DesignSystem = {
  id: 'openai-inspired',
  version: 1,
  name: 'OpenAI-inspired',
  cover: { kind: 'preview', example: 'cover.tsx' },
  sections: buildDocument({
    tokens: { light: LIGHT_TOKENS, dark: DARK_TOKENS },
    overview: [
      rulesNote(LICENSED_FONTS),
      { kind: 'note', label: '2-feel.md', body: FEEL_NOTE },
      {
        kind: 'preview',
        title: 'Pricing card',
        example: 'PricingCard.tsx',
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
  examples: { ...PRIMITIVE_EXAMPLES, 'PricingCard.tsx': PRICING_TSX, 'cover.tsx': COVER_TSX },
};
