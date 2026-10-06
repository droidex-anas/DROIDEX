// The DROIDEX design kit, version 1: warm paper and graphite with one amber
// signal colour. Inspired by the app's own warm light/near-black dark themes
// rather than copied from them, because a preview is content and the DROIDEX
// chrome keeps its own palette (spec §10).

import type { DesignSystem } from '../designSystems.js';

const LIGHT_TOKENS: Record<string, string> = {
  '--ds-canvas': '#f6f3ee',
  '--ds-surface': '#fdfbf7',
  '--ds-raised': '#ffffff',
  '--ds-elevated': '#f1ece4',
  '--ds-active': '#e8e1d6',
  '--ds-fg': '#221e19',
  '--ds-fg-muted': '#5d564c',
  '--ds-fg-subtle': '#8a8278',
  '--ds-border': '#e3dcd0',
  '--ds-accent': '#8a5a1f',
  '--ds-accent-strong': '#6e4716',
  '--ds-accent-soft': '#f3e6d4',
  '--ds-accent-fg': '#fffaf2',
  '--ds-focus': '#b9833c',
  '--ds-positive': '#2f6f4f',
  '--ds-danger': '#a3342b',
  '--ds-shadow-sm': '0 1px 2px rgb(34 30 25 / 0.06)',
  '--ds-shadow-md': '0 12px 32px rgb(34 30 25 / 0.10)',
};

const DARK_TOKENS: Record<string, string> = {
  '--ds-canvas': '#121110',
  '--ds-surface': '#191817',
  '--ds-raised': '#201e1c',
  '--ds-elevated': '#262320',
  '--ds-active': '#2e2a26',
  '--ds-fg': '#ece7df',
  '--ds-fg-muted': '#a8a19a',
  '--ds-fg-subtle': '#7b746c',
  '--ds-border': '#2c2825',
  '--ds-accent': '#e3a857',
  '--ds-accent-strong': '#f0bc74',
  '--ds-accent-soft': '#332a1e',
  '--ds-accent-fg': '#1b1710',
  '--ds-focus': '#e3a857',
  '--ds-positive': '#6ec194',
  '--ds-danger': '#e08a7f',
  '--ds-shadow-sm': '0 1px 2px rgb(0 0 0 / 0.40)',
  '--ds-shadow-md': '0 16px 44px rgb(0 0 0 / 0.50)',
};

// Geometry, type and motion do not change with the mode, so they are plain kit
// CSS instead of two identical token sets.
const TOKENS_CSS = `:root {
  --ds-radius-sm: 6px;
  --ds-radius-md: 10px;
  --ds-radius-lg: 18px;
  --ds-radius-pill: 999px;
  --ds-text-xs: 0.75rem;
  --ds-text-sm: 0.875rem;
  --ds-text-base: 1rem;
  --ds-text-lg: 1.25rem;
  --ds-text-xl: 1.75rem;
  --ds-font-sans: 'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
  --ds-font-mono: ui-monospace, 'SF Mono', 'Menlo', monospace;
  --ds-duration: 140ms;
}

html,
body {
  height: 100%;
}

body {
  margin: 0;
  background: var(--ds-canvas);
  color: var(--ds-fg);
  font-family: var(--ds-font-sans);
  font-size: var(--ds-text-base);
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}

@media (prefers-reduced-motion: reduce) {
  * {
    transition-duration: 1ms !important;
    animation-duration: 1ms !important;
  }
}
`;

// Class lists are whole literal strings so Tailwind finds every utility by
// scanning the source; nothing is assembled from fragments at runtime.
const INDEX_TSX = `import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 rounded-[var(--ds-radius-md)] px-4 py-2 text-[length:var(--ds-text-sm)] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ds-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--ds-canvas)] disabled:cursor-not-allowed disabled:opacity-50';

const BUTTON_VARIANTS = {
  primary:
    'bg-[color:var(--ds-accent)] text-[color:var(--ds-accent-fg)] shadow-[var(--ds-shadow-sm)] hover:bg-[color:var(--ds-accent-strong)]',
  secondary:
    'bg-[color:var(--ds-elevated)] text-[color:var(--ds-fg)] hover:bg-[color:var(--ds-active)]',
  quiet: 'bg-transparent text-[color:var(--ds-fg-muted)] hover:bg-[color:var(--ds-elevated)]',
};

export type ButtonVariant = keyof typeof BUTTON_VARIANTS;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export function Button({ variant = 'primary', className, type, ...rest }: ButtonProps) {
  const classes = [BUTTON_BASE, BUTTON_VARIANTS[variant], className].filter(Boolean).join(' ');
  return <button type={type ?? 'button'} className={classes} {...rest} />;
}

const CARD_BASE =
  'rounded-[var(--ds-radius-lg)] bg-[color:var(--ds-raised)] p-6 text-[color:var(--ds-fg)] shadow-[var(--ds-shadow-md)]';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function Card({ className, children, ...rest }: CardProps) {
  const classes = [CARD_BASE, className].filter(Boolean).join(' ');
  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  );
}
`;

const HEY_TSX = `import { useState } from 'react';
import { Button, Card } from '@droidex/design-system';

export default function Hey() {
  const [done, setDone] = useState(false);
  return (
    <main className="flex min-h-screen items-center justify-center p-10">
      <Card className="flex w-full max-w-sm flex-col gap-4">
        <h1 className="text-[length:var(--ds-text-xl)] font-semibold tracking-tight">
          Hey, welcome in.
        </h1>
        <p className="text-[color:var(--ds-fg-muted)]">A small place to start something good.</p>
        <div className="flex items-center gap-3">
          <Button onClick={() => setDone(true)} disabled={done}>
            {done ? "You're all set" : 'Get started'}
          </Button>
          {done ? (
            <Button variant="quiet" onClick={() => setDone(false)}>
              Start over
            </Button>
          ) : null}
        </div>
      </Card>
    </main>
  );
}
`;

const GUIDANCE = `DROIDEX kit, version 1.

Compose with the tokens, not with raw colours. Use var(--ds-canvas) for the
page, var(--ds-raised) for a card, var(--ds-elevated) and var(--ds-active) for
controls and their hover state, and var(--ds-accent) only for the one primary
action in a view.

Separate layers with tone and var(--ds-shadow-md), not outlines. Use
var(--ds-border) as a hairline only when tone alone cannot show the edge, and
never the accent as a resting border.

Import Button and Card from @droidex/design-system and keep their focus,
hover and disabled behaviour. Button takes the usual button props plus
variant: primary, secondary or quiet. Card takes children and className.

Write whole Tailwind class names in the source. A class assembled from
fragments at runtime is not generated, so it will have no effect.

Every control does something: wire onClick to real state before shipping a
screen, and give an empty or loading state its own honest text.
`;

export const DROIDEX_DESIGN_SYSTEM: DesignSystem = {
  id: 'droidex',
  version: 1,
  name: 'DROIDEX',
  modes: { light: LIGHT_TOKENS, dark: DARK_TOKENS },
  files: { 'index.tsx': INDEX_TSX, 'tokens.css': TOKENS_CSS },
  guidance: GUIDANCE,
  examples: { 'Hey.tsx': HEY_TSX },
};
