// What a token holds, drawn: a colour swatch, or a spacing, radius or shadow
// specimen. The kit's own tokens reach them as custom properties on `style`.

import type { CSSProperties } from 'react';
import type { TokenKind } from '../designSystemDocumentProtocol';
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
  kind,
  name,
  style,
}: {
  kind: TokenKind;
  name: string;
  style: CSSProperties;
}) {
  const paint = `var(${name})`;
  if (kind === 'spacing')
    return (
      <span
        aria-hidden="true"
        className="h-2 max-w-full rounded-full bg-accent/60"
        style={{ ...style, width: paint }}
      />
    );
  if (kind === 'radius')
    return (
      <span
        aria-hidden="true"
        className="size-8 bg-accent/15"
        style={{ ...style, borderRadius: paint }}
      />
    );
  return (
    <span
      aria-hidden="true"
      className="h-8 w-14 rounded-md bg-raised"
      style={{ ...style, boxShadow: paint }}
    />
  );
}
