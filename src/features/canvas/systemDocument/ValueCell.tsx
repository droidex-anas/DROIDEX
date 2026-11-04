// One value of a token row (spec §5, §6): a colour's swatch and text, a
// shadow's tiles and layers, or the value as text. A row that separates its
// modes has one for each.

import { useState, type CSSProperties, type ReactNode } from 'react';
import type { DocumentToken, TokenKind } from '../designSystemDocumentProtocol';
import type { PreviewMode } from '../PreviewModeToggle';
import { CellSwatch } from './ColorSwatchInput';
import { bareTokenName } from './documentSections';
import { ShadowValue } from './ShadowValue';
import { modeValue } from './specimenStyle';
import type { TokenShape } from './tokenShape';
import { TokenValue } from './TokenValue';

const MODE_LABEL: Record<PreviewMode, string> = { light: 'Light', dark: 'Dark' };

export function ValueCell({
  token,
  which,
  kind,
  shape,
  kitId,
  specimens,
  tokenNames,
  isRemoved,
  onSet,
}: {
  token: DocumentToken;
  which: 'value' | PreviewMode;
  kind: TokenKind;
  shape: TokenShape;
  kitId: string;
  /** The kit's specimen tokens as custom properties, per mode. */
  specimens: Record<PreviewMode, CSSProperties>;
  /** Every token name in the draft, which a typed bare name may refer to. */
  tokenNames: ReadonlySet<string>;
  isRemoved: boolean;
  /** Null for a value that cannot be edited. */
  onSet: ((mode: PreviewMode, value: string) => void) | null;
}) {
  // A colour being typed, which its swatch paints as it is typed.
  const [draft, setDraft] = useState<string | null>(null);
  const mode: PreviewMode = which === 'dark' ? 'dark' : 'light';
  const isColorTable = kind === 'colors';
  // Other tables name the mode only on a row that separates them.
  const modeLabel = !isColorTable && which !== 'value' ? MODE_LABEL[which] : null;
  const value = modeValue(token, mode);
  const label = `${which === 'value' ? 'Value' : `${MODE_LABEL[which]} value`} of ${bareTokenName(token.name)}`;
  const onCommit =
    onSet &&
    ((text: string) => {
      onSet(mode, text);
    });
  // A shadow is made for the surface under it, so a value for both modes shows on both.
  const modes: PreviewMode[] = which === 'value' ? ['light', 'dark'] : [which];

  let shown: ReactNode;
  // Colours always show both modes; a one-value colour edits its value from Light.
  if (isColorTable && 'value' in token && which === 'dark')
    shown = <span className="truncate text-caption text-muted">Same as light</span>;
  else if (shape === 'shadow')
    shown = (
      <ShadowValue
        name={token.name}
        value={value}
        kind={kind}
        label={label}
        surfaces={modes.map((tileMode) => specimens[tileMode])}
        tokenNames={tokenNames}
        isRemoved={isRemoved}
        onCommit={onCommit}
      />
    );
  else
    shown = (
      <TokenValue
        value={value}
        kind={kind}
        label={label}
        tokenNames={tokenNames}
        isRemoved={isRemoved}
        onDraft={shape === 'color' ? setDraft : undefined}
        onCommit={onCommit}
      />
    );

  return (
    <span className="flex min-h-control-md min-w-0 items-center gap-2">
      {modeLabel && <span className="w-8 shrink-0 text-caption text-muted">{modeLabel}</span>}
      {shape === 'color' && (
        <CellSwatch
          kitId={kitId}
          token={token}
          mode={mode}
          label={label}
          style={specimens[mode]}
          draft={draft}
          onCommit={onCommit}
        />
      )}
      {shown}
    </span>
  );
}
