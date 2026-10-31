// One kit mode's tokens under the dialog's four tabs, each drawn with the value
// it holds: a swatch, a type sample, a measured bar or corner, a raised card.

import type { CSSProperties } from 'react';
import { paintable, type Token, type TokenTab } from './designSystemTokenTabs';

const LENGTH_VALUE = /^(?:-?[\d.]+(?:px|rem|em|%)?|(?:calc|clamp|min|max)\(.+\))$/i;

export function TokenPanel({
  tab,
  tokens,
  kitColors,
  unmapped,
}: {
  tab: TokenTab;
  tokens: Token[];
  /** The kit's own colours in this mode, for previews that need its ground. */
  kitColors: { canvas: string; raised: string; fg: string };
  unmapped: ReadonlySet<string>;
}) {
  if (tokens.length === 0)
    return <p className="py-6 text-label font-normal text-muted">This kit sets no tokens here.</p>;
  if (tab === 'shadows')
    return (
      <div
        className="grid grid-cols-2 gap-4 rounded-xl p-5"
        style={{ background: paintable(kitColors.canvas), color: paintable(kitColors.fg) }}
      >
        {tokens.map(([name, value]) => (
          <div key={name} className="flex flex-col gap-2">
            <div
              aria-hidden
              className="h-14 rounded-lg"
              style={{ background: paintable(kitColors.raised), boxShadow: paintable(value) }}
            />
            <TokenLabel name={name} value={value} unmapped={unmapped.has(name)} onCanvas />
          </div>
        ))}
      </div>
    );
  return (
    <ul className={tab === 'colors' ? 'grid grid-cols-2 gap-x-4 gap-y-1' : 'flex flex-col gap-1'}>
      {tokens.map(([name, value]) => (
        <li key={name} className="flex min-w-0 items-center gap-3 rounded-lg py-1.5">
          <TokenSample tab={tab} name={name} value={value} />
          <TokenLabel name={name} value={value} unmapped={unmapped.has(name)} />
        </li>
      ))}
    </ul>
  );
}

function TokenSample({ tab, name, value }: { tab: TokenTab; name: string; value: string }) {
  const paint = paintable(value);
  if (tab === 'colors')
    return (
      <span
        aria-hidden
        // eslint-disable-next-line design-policy/design-tokens -- colour swatch edge: an arbitrary colour needs an edge to read on any surface
        className="h-8 w-8 shrink-0 rounded-lg ring-1 ring-inset ring-divider"
        style={{ background: paint }}
      />
    );
  if (tab === 'typography') {
    // A weight is unitless, so it is told apart by name before any length check.
    let style: CSSProperties = { fontFamily: paint };
    if (name.includes('weight')) style = { fontWeight: paint };
    else if (paint && LENGTH_VALUE.test(paint)) style = { fontSize: `min(${paint}, 32px)` };
    return (
      <span
        aria-hidden
        className="w-12 shrink-0 truncate text-heading font-normal text-primary"
        style={style}
      >
        Aa
      </span>
    );
  }
  if (/radius|rounded/.test(name))
    return (
      <span aria-hidden className="h-8 w-8 shrink-0 bg-accent/15" style={{ borderRadius: paint }} />
    );
  return (
    <span aria-hidden className="flex w-8 shrink-0 items-center">
      <span
        className="h-2 rounded-full bg-accent/70"
        style={{ width: paint && `min(${paint}, 100%)` }}
      />
    </span>
  );
}

function TokenLabel({
  name,
  value,
  unmapped,
  onCanvas = false,
}: {
  name: string;
  value: string;
  unmapped: boolean;
  /** On the kit's own canvas, which can be the opposite of the app's scheme. */
  onCanvas?: boolean;
}) {
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="flex min-w-0 items-center gap-1.5">
        <span className={`truncate text-label font-normal ${onCanvas ? '' : 'text-primary'}`}>
          {name}
        </span>
        {unmapped && (
          <span className="shrink-0 rounded-full bg-warning/10 px-1.5 text-overline text-warning">
            Unmapped
          </span>
        )}
      </span>
      <span className={`truncate text-caption ${onCanvas ? 'opacity-70' : 'text-muted'}`}>
        {value}
      </span>
    </span>
  );
}
