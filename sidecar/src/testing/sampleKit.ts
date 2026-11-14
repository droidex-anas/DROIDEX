// A small kit authored on the shared primitives and the starter's tokens, with
// a cover, a pricing demo, and Inter and the DROIDEX kit's Silkscreen in its own
// sheet, for suites that need a document and previews that never change. It is
// not built in: save it first.

import { buildDocument } from '../canvas/buildDocument.js';
import type { DesignSystem } from '../canvas/designSystems.js';
import { catalogFile, KIT_CATALOG_FILE, type CatalogEntry } from '../canvas/kitCatalog.js';
import droidex from '../canvas/presets/droidex/system.json' with { type: 'json' };
import inter from '../canvas/presets/fonts/inter.json' with { type: 'json' };
import { PRIMITIVES_TSX } from '../canvas/presets/primitives.js';
import {
  LICENSED_FONTS,
  PRIMITIVE_EXAMPLES,
  PRIMITIVE_PARTS,
  STARTER_TOKENS,
  rulesNote,
} from '../canvas/presets/starter.js';
import { KIT_CSS } from '../canvas/presets/styles.js';

// The pricing card reads only the shared primitives' tokens, so it builds
// strictly under any kit made from them.
export const PRICING_TSX = `import { useState } from 'react';
import { Check } from 'lucide-react';
import { Badge, Button, Card, Tabs } from '@droidex/design-system';

const PLANS = [
  { name: 'Starter', seat: 0, summary: 'For a small team on one workspace.', features: ['Up to 5 seats', 'One workspace', 'Email support'] },
  { name: 'Growth', seat: 18, summary: 'For teams that bill and report every day.', features: ['Unlimited seats', 'Audit log', 'Priority support'] },
  { name: 'Scale', seat: 32, summary: 'For finance and operations across entities.', features: ['SAML single sign-on', 'Custom roles', 'A named success manager'] },
];

export default function PricingCard() {
  const [billing, setBilling] = useState('monthly');
  const [chosen, setChosen] = useState('Starter');
  const price = (seat: number) => (billing === 'yearly' ? seat * 10 : seat);
  return (
    <main className="flex h-[600px] w-[1040px] flex-col items-center gap-6 overflow-hidden bg-[color:var(--ds-canvas)] px-10 py-12">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1>Choose a plan</h1>
        <p className="text-[color:var(--ds-fg-muted)]">Every plan includes unlimited invoices and the full API.</p>
      </div>
      <Tabs
        label="Billing period"
        value={billing}
        onValueChange={setBilling}
        items={[
          { value: 'monthly', label: 'Monthly', content: null },
          { value: 'yearly', label: 'Yearly, two months free', content: null },
        ]}
      />
      <div className="grid w-full max-w-4xl grid-cols-3 gap-4">
        {PLANS.map((plan) => (
          <Card key={plan.name} className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2>{plan.name}</h2>
              {plan.name === 'Growth' ? <Badge>Most teams</Badge> : null}
            </div>
            <p className="text-[length:var(--ds-text-sm)] text-[color:var(--ds-fg-muted)]">{plan.summary}</p>
            <p className="text-[length:var(--ds-text-xl)] font-semibold tabular-nums">
              {'$' + price(plan.seat)}
              <span className="text-[length:var(--ds-text-sm)] font-normal text-[color:var(--ds-fg-muted)]">
                {billing === 'yearly' ? ' per seat a year' : ' per seat a month'}
              </span>
            </p>
            <ul className="flex flex-1 flex-col gap-2 text-[length:var(--ds-text-sm)]">
              {plan.features.map((feature) => (
                <li key={feature} className="flex items-center gap-2">
                  <Check size={16} aria-hidden="true" className="text-[color:var(--ds-positive)]" />
                  {feature}
                </li>
              ))}
            </ul>
            <Button
              variant={plan.name === 'Growth' ? 'primary' : 'secondary'}
              disabled={chosen === plan.name}
              onClick={() => setChosen(plan.name)}
            >
              {chosen === plan.name ? 'Current plan' : 'Switch to ' + plan.name}
            </Button>
          </Card>
        ))}
      </div>
    </main>
  );
}
`;

const COVER_TSX = `import { Badge, Button, Card } from '@droidex/design-system';

export default function Cover() {
  return (
    <main className="flex h-[480px] w-[1200px] items-center justify-between gap-10 overflow-hidden bg-[color:var(--ds-canvas)] px-16">
      <div className="flex max-w-md flex-col gap-4">
        <Badge>Sample</Badge>
        <h1>Plans a team reads at a glance</h1>
        <p className="text-[color:var(--ds-fg-muted)]">Quiet neutrals and one accent for the action.</p>
      </div>
      <Card className="flex w-80 flex-col gap-3">
        <h2>Growth</h2>
        <p className="text-[length:var(--ds-text-sm)] text-[color:var(--ds-fg-muted)]">Unlimited seats and the audit log.</p>
        <Button>Switch plan</Button>
      </Card>
    </main>
  );
}
`;

export const SAMPLE_KIT: DesignSystem = {
  id: 'sample',
  version: 1,
  name: 'Sample',
  cover: { kind: 'preview', example: 'cover.tsx' },
  sections: buildDocument({
    tokens: STARTER_TOKENS,
    overview: [
      rulesNote(LICENSED_FONTS),
      { kind: 'preview', title: 'Pricing', example: 'PricingCard.tsx', width: 1040, height: 600 },
    ],
    components: PRIMITIVE_PARTS,
  }),
  files: {
    'index.tsx': PRIMITIVES_TSX,
    'fonts.css': inter.css + droidex.files['fonts.css'],
    'tokens.css': KIT_CSS,
    'fonts/Inter-OFL.txt': inter.license,
    'fonts/Silkscreen-OFL.txt': droidex.files['fonts/Silkscreen-OFL.txt'],
  },
  examples: { ...PRIMITIVE_EXAMPLES, 'cover.tsx': COVER_TSX, 'PricingCard.tsx': PRICING_TSX },
};

/** A catalog entry with a prop to pick, whose second option no shipped kit writes. */
export const SAMPLE_BUTTON_ENTRY: CatalogEntry = {
  name: 'Button',
  module: 'index.tsx',
  uses: ['Button'],
  icons: [],
  jsx: '<Button variant="primary">Save</Button>',
  note: null,
  props: [{ name: 'variant', options: ['primary', 'zesty'], default: 'primary' }],
};

/** The sample kit with a catalog of that one entry. */
export const SAMPLE_CATALOG_KIT: DesignSystem = {
  ...SAMPLE_KIT,
  id: 'sample-catalog',
  files: { ...SAMPLE_KIT.files, [KIT_CATALOG_FILE]: catalogFile([SAMPLE_BUTTON_ENTRY]) },
};
