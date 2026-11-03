// What a token holds, drawn: a colour swatch, a line of text set in a type
// token, a length bar, a rounded square for a corner radius, or a card carrying
// a shadow. The kit's own tokens reach them as custom properties on `style`.

import type { CSSProperties } from 'react';
import { loadedFamilyProperty, typeProperty } from './specimenStyle';

const SAMPLE_LINE = 'The quick brown fox jumps over the lazy dog';
// Long enough to wrap in its column, so the room between its lines shows.
const SAMPLE_PARAGRAPH =
  'Line height is the room each line of a paragraph takes, and it decides how a block of text breathes.';

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

export function Specimen({
  shape,
  name,
  style,
}: {
  shape: 'radius' | 'length' | 'type';
  name: string;
  style: CSSProperties;
}) {
  const paint = `var(${name})`;
  if (shape === 'type') return <TypeSample name={name} style={style} />;
  if (shape === 'length')
    return (
      <span
        aria-hidden="true"
        className="h-2 max-w-full rounded-full bg-accent/60"
        style={{ ...style, width: paint }}
      />
    );
  return (
    <span
      aria-hidden="true"
      className="size-8 bg-accent/15"
      style={{ ...style, borderRadius: paint }}
    />
  );
}

/** Text in the kit's body face with one property set by the token, at the document's reading size unless the token is a size. */
function TypeSample({ name, style }: { name: string; style: CSSProperties }) {
  const property = typeProperty(name);
  const paint = `var(${name})`;
  if (property === 'fontSize')
    return (
      <span
        aria-hidden="true"
        className="kit-body-font kit-type-sample min-w-0 flex-1 leading-tight text-primary"
        style={{ ...style, fontSize: paint }}
      >
        {SAMPLE_LINE}
      </span>
    );
  if (property === 'lineHeight')
    return (
      <span
        aria-hidden="true"
        className="kit-body-font line-clamp-2 min-w-0 text-prose text-primary"
        style={{ ...style, lineHeight: paint }}
      >
        {SAMPLE_PARAGRAPH}
      </span>
    );
  // A family is set in the fonts the document loaded for the kit, once it has.
  const value = property === 'fontFamily' ? `var(${loadedFamilyProperty(name)}, ${paint})` : paint;
  return (
    <span
      aria-hidden="true"
      className="kit-body-font kit-type-sample min-w-0 flex-1 text-prose text-primary"
      style={{ ...style, [property]: value }}
    >
      {SAMPLE_LINE}
    </span>
  );
}

const TILE_SIZE = {
  row: { tile: 'h-8 w-11 rounded-md', card: 'h-4 w-6 rounded-sm' },
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
