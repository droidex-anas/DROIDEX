// A colour token's swatch that opens the system colour picker (spec §6). What
// the user picks shows in the swatch and in live previews while they choose;
// letting go keeps it in the draft as one change. The picker has no alpha, so
// a translucent value keeps its own.

import { useEffect, useEffectEvent, useRef, useState, type CSSProperties } from 'react';
import type { DocumentToken } from '../designSystemDocumentProtocol';
import type { PreviewMode } from '../PreviewModeToggle';
import { showPickedColor } from './pickedColor';
import { Swatch } from './TokenSpecimens';

const OPAQUE = 255;

/** The swatch a colour cell shows: the picker when it can be edited, a plain swatch otherwise. */
export function CellSwatch({
  kitId,
  token,
  mode,
  label,
  style,
  onCommit,
}: {
  kitId: string;
  token: DocumentToken;
  mode: PreviewMode;
  label: string;
  style: CSSProperties;
  onCommit: ((value: string) => void) | null;
}) {
  if (onCommit === null || ('value' in token && mode === 'dark'))
    return <Swatch name={token.name} style={style} />;
  return (
    <ColorSwatchInput
      kitId={kitId}
      name={token.name}
      mode={'value' in token ? 'both' : mode}
      label={label}
      style={style}
      onCommit={onCommit}
    />
  );
}

function ColorSwatchInput({
  kitId,
  name,
  mode,
  label,
  style,
  onCommit,
}: {
  kitId: string;
  name: string;
  mode: PreviewMode | 'both';
  /** What the colour is, such as "Light value of accent". */
  label: string;
  /** The kit's specimen tokens, so the swatch paints `var(name)` as the kit resolves it. */
  style: CSSProperties;
  onCommit: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const paintRef = useRef<HTMLSpanElement>(null);
  const alphaRef = useRef(OPAQUE);
  const [picked, setPicked] = useState<string | null>(null);
  const isPicking = useRef(false);

  const pick = (value: string | null) => {
    isPicking.current = value !== null;
    setPicked(value);
    showPickedColor(value === null ? null : { kitId, name, mode, value });
  };

  // React's onChange follows every input event; the native change event is the release.
  const keep = useEffectEvent(() => {
    const input = inputRef.current;
    if (!input) return;
    pick(null);
    onCommit(withAlpha(input.value, alphaRef.current));
  });
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const onRelease = () => {
      keep();
    };
    const onCancel = () => {
      pick(null);
    };
    input.addEventListener('change', onRelease);
    input.addEventListener('cancel', onCancel);
    return () => {
      input.removeEventListener('change', onRelease);
      input.removeEventListener('cancel', onCancel);
      if (isPicking.current) showPickedColor(null);
    };
    // pick reads only refs and stable setters; kitId, name and mode are fixed per row cell.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <span className="kit-colour-swatch relative size-6 shrink-0 rounded-md bg-elevated p-0.5 transition-colors duration-quick ease-out hover:bg-active">
      <span
        ref={paintRef}
        className="block size-full rounded-sm"
        style={{ ...style, background: picked ?? `var(${name})` }}
      />
      <input
        ref={inputRef}
        type="color"
        aria-label={label}
        className="absolute inset-0 size-full cursor-pointer opacity-0"
        // The picker opens on the colour the swatch shows, which may refer to other tokens.
        onClick={(event) => {
          const paint = paintRef.current;
          if (!paint) return;
          const [red, green, blue, alpha] = channels(getComputedStyle(paint).backgroundColor);
          // A see-through colour is picked as an opaque one, or it would stay invisible.
          alphaRef.current = alpha === 0 ? OPAQUE : alpha;
          event.currentTarget.value = `#${[red, green, blue].map(hexByte).join('')}`;
        }}
        onInput={(event) => {
          pick(withAlpha(event.currentTarget.value, alphaRef.current));
        }}
      />
    </span>
  );
}

let context: CanvasRenderingContext2D | null = null;

/** A CSS colour as the browser paints it, in 8-bit sRGB channels with alpha. */
function channels(color: string): Uint8ClampedArray {
  if (!context) {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    context = canvas.getContext('2d', { willReadFrequently: true });
  }
  if (!context) return new Uint8ClampedArray([0, 0, 0, OPAQUE]);
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  return context.getImageData(0, 0, 1, 1).data;
}

function withAlpha(hex: string, alpha: number): string {
  return alpha === OPAQUE ? hex : `${hex}${hexByte(alpha)}`;
}

function hexByte(value: number): string {
  return value.toString(16).padStart(2, '0');
}
