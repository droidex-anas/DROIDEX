// What a token holds, drawn: a colour swatch, a length bar, a rounded square
// for a corner radius, or a card carrying a shadow. The kit's own tokens reach
// them as custom properties on `style`.

import type { CSSProperties } from 'react';
import type { PreviewMode } from '../PreviewModeToggle';
import { isPaintable } from './specimenStyle';

export function Swatch({ name, style }: { name: string; style: CSSProperties }) {
  return (
    <span
      aria-hidden="true"
      // eslint-disable-next-line design-policy/design-tokens -- colour swatch edge: an arbitrary colour needs an edge to read on any surface
      className="size-5 shrink-0 rounded-sm ring-1 ring-inset ring-divider"
      style={{ ...style, background: `var(${name})` }}
    />
  );
}

/** The colour being typed, drawn only once it parses. */
export function LiveSwatch({ value }: { value: string }) {
  const trimmed = value.trim();
  return (
    <span
      aria-hidden="true"
      // eslint-disable-next-line design-policy/design-tokens -- colour swatch edge: an arbitrary colour needs an edge to read on any surface
      className="mr-2 inline-block size-3.5 rounded-xs align-middle ring-1 ring-inset ring-divider"
      style={{ background: isPaintable('color', trimmed) ? trimmed : undefined }}
    />
  );
}

export function Specimen({
  shape,
  name,
  specimens,
  mode,
}: {
  shape: 'shadow' | 'radius' | 'length';
  name: string;
  specimens: Record<PreviewMode, CSSProperties>;
  mode: PreviewMode;
}) {
  const paint = `var(${name})`;
  if (shape === 'length')
    return (
      <span
        aria-hidden="true"
        className="h-2 max-w-full rounded-full bg-accent/60"
        style={{ ...specimens[mode], width: paint }}
      />
    );
  if (shape === 'radius')
    return (
      <span
        aria-hidden="true"
        className="size-8 bg-accent/15"
        style={{ ...specimens[mode], borderRadius: paint }}
      />
    );
  // A shadow is made for the surface under it, so both modes show at once.
  return (
    <span className="flex gap-1.5">
      <ShadowTile shadow={paint} style={specimens.light} size="row" />
      <ShadowTile shadow={paint} style={specimens.dark} size="row" />
    </span>
  );
}

const TILE_SIZE = {
  row: { tile: 'h-9 w-11 rounded-md', card: 'h-4 w-6 rounded-sm' },
  editor: { tile: 'h-20 flex-1 rounded-lg', card: 'h-9 w-16 rounded-md' },
};

/** A card on the kit's canvas, carrying `shadow` in the mode whose tokens `style` holds. */
export function ShadowTile({
  shadow,
  style,
  size,
}: {
  shadow: string;
  style: CSSProperties;
  size: keyof typeof TILE_SIZE;
}) {
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center ${TILE_SIZE[size].tile}`}
      style={{ ...style, background: 'var(--ds-canvas, var(--ds-surface, var(--surface)))' }}
    >
      <span
        className={TILE_SIZE[size].card}
        style={{
          background: 'var(--ds-raised, var(--ds-surface, var(--raised)))',
          boxShadow: shadow,
        }}
      />
    </span>
  );
}
