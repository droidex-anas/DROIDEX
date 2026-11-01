// A box-shadow value as the layers its editor shows (spec §5): offsets, blur
// and spread as numbers in their own units, and the alpha of each layer's
// colour. Only a value whose every layer names a colour with an alpha it can
// read and rewrite parses; anything else stays plain text.

export interface ShadowLength {
  amount: number;
  /** As written; empty only for a bare 0. */
  unit: string;
}

export interface ShadowLayer {
  inset: boolean;
  x: ShadowLength;
  y: ShadowLength;
  blur: ShadowLength;
  spread: ShadowLength;
  /** The colour as written. */
  color: string;
  /** From 0 to 1. */
  alpha: number;
}

const LENGTH = /^(-?\d*\.?\d+)(px|rem|em|)$/;
const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const COLOR_FUNCTION = /^(rgba?|hsla?|hwb|lab|lch|oklab|oklch)\((.*)\)$/i;
const ALPHA = /^(\d*\.?\d+)(%?)$/;
const ZERO: ShadowLength = { amount: 0, unit: '' };

export function parseShadow(value: string): ShadowLayer[] | null {
  const layers = splitOutsideParentheses(value.trim(), ',').map(parseLayer);
  return layers.every((layer) => layer !== null) ? layers : null;
}

export function formatShadow(layers: ShadowLayer[]): string {
  return layers.map(formatLayer).join(', ');
}

/** What a row shows of a shadow: "2 layers · 4%", or a range when the layers' alphas differ. */
export function shadowSummary(layers: ShadowLayer[]): string {
  const percents = layers.map(({ alpha }) => Math.round(alpha * 100));
  const lowest = Math.min(...percents);
  const highest = Math.max(...percents);
  const alpha =
    lowest === highest ? `${String(highest)}%` : `${String(lowest)}–${String(highest)}%`;
  return `${String(layers.length)} ${layers.length === 1 ? 'layer' : 'layers'} · ${alpha}`;
}

export function formatLength({ amount, unit }: ShadowLength): string {
  if (amount === 0 && unit === '') return '0';
  return `${String(amount)}${unit || 'px'}`;
}

function parseLayer(text: string): ShadowLayer | null {
  let inset = false;
  let color: string | null = null;
  const lengths: ShadowLength[] = [];
  for (const word of splitOutsideParentheses(text, ' ').filter((part) => part !== '')) {
    const length = LENGTH.exec(word);
    if (length) {
      const amount = Number(length[1]);
      // CSS reads a bare number only as 0.
      if (length[2] === '' && amount !== 0) return null;
      lengths.push({ amount, unit: length[2] });
    } else if (word.toLowerCase() === 'inset' && !inset) inset = true;
    else if (color === null) color = word;
    else return null;
  }
  if (lengths.length < 2 || lengths.length > 4 || color === null) return null;
  const alpha = colorAlpha(color);
  if (alpha === null) return null;
  const [x, y, blur = ZERO, spread = ZERO] = lengths;
  return { inset, x, y, blur, spread, color, alpha };
}

function formatLayer(layer: ShadowLayer): string {
  const lengths = [layer.x, layer.y, layer.blur, layer.spread];
  // A spread, then a blur, of 0 is left out, as CSS reads it.
  while (lengths.length > 2 && lengths.at(-1)?.amount === 0) lengths.pop();
  const color =
    layer.alpha === colorAlpha(layer.color)
      ? layer.color
      : withColorAlpha(layer.color, layer.alpha);
  return [...(layer.inset ? ['inset'] : []), ...lengths.map(formatLength), color].join(' ');
}

/** A colour's alpha from 0 to 1, or null for one whose alpha cannot be rewritten, such as a name or a var(). */
export function colorAlpha(color: string): number | null {
  if (HEX.test(color)) {
    const digits = color.slice(1);
    if (digits.length === 4) return parseInt(digits[3].repeat(2), 16) / 255;
    if (digits.length === 8) return parseInt(digits.slice(6), 16) / 255;
    return 1;
  }
  const call = COLOR_FUNCTION.exec(color);
  if (!call || call[2].includes('var(')) return null;
  const { alpha } = colorArguments(call[2]);
  if (alpha === undefined) return 1;
  const match = ALPHA.exec(alpha);
  if (!match) return null;
  const amount = Number(match[1]) / (match[2] === '%' ? 100 : 1);
  return Math.min(amount, 1);
}

/** `color` with `alpha`, in the colour's own notation. Takes only a colour `colorAlpha` reads. */
export function withColorAlpha(color: string, alpha: number): string {
  if (HEX.test(color)) {
    const digits = color.slice(1);
    // #rgb and #rgba write each digit once.
    const rgb = digits.length <= 4 ? digits.slice(0, 3).replace(/./g, '$&$&') : digits.slice(0, 6);
    if (alpha === 1) return `#${rgb}`;
    const byte = Math.round(alpha * 255)
      .toString(16)
      .padStart(2, '0');
    return `#${rgb}${byte}`;
  }
  const call = COLOR_FUNCTION.exec(color);
  if (!call) return color;
  const [, name, inner] = call;
  const { channels, alpha: written, commas } = colorArguments(inner);
  const next = written?.endsWith('%') ? `${String(rounded(alpha * 100))}%` : String(rounded(alpha));
  return commas ? `${name}(${channels}, ${next})` : `${name}(${channels} / ${next})`;
}

function colorArguments(inner: string): {
  channels: string;
  alpha: string | undefined;
  commas: boolean;
} {
  const slash = inner.lastIndexOf('/');
  if (slash !== -1)
    return {
      channels: inner.slice(0, slash).trim(),
      alpha: inner.slice(slash + 1).trim(),
      commas: false,
    };
  const parts = inner.split(',');
  if (parts.length === 4)
    return { channels: parts.slice(0, 3).join(',').trim(), alpha: parts[3].trim(), commas: true };
  return { channels: inner.trim(), alpha: undefined, commas: parts.length === 3 };
}

function rounded(amount: number): number {
  return Math.round(amount * 1000) / 1000;
}

function splitOutsideParentheses(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    else if (depth === 0 && (char === separator || (separator === ' ' && /\s/.test(char)))) {
      parts.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts;
}
