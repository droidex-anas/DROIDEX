// Collection props (chart data, table rows, list items) are capped before
// rendering: a huge array would not only spawn thousands of DOM nodes but can
// also blow the call stack via spread math like `Math.min(...data)` (a
// model-supplied `data` of 100k+ numbers throws RangeError and freezes chat).
const MAX_ITEMS = 2000;

export const MAX_TABLE_COLUMNS = 40;

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function asString(v: unknown, fallback = ''): string {
  if (v == null) return fallback;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return fallback;
}

export function asNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

export function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v.slice(0, MAX_ITEMS) : [];
}

// Like asArray but drops entries that are not plain objects, so components can
// safely dereference fields (d.value, Object.keys(r), it.status) on specs that
// include null/primitive entries such as data: [null].
export function asRecordArray(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v)
    ? v
        .filter((e): e is Record<string, unknown> => isObject(e) && !Array.isArray(e))
        .slice(0, MAX_ITEMS)
    : [];
}

// Semantic status → themed color. success/warning/error use the fixed semantic
// green/amber/red so they always read by hue, even in monochrome; only info
// follows the neutral accent so it stays part of the monochrome UI chrome.
const STATUS_COLOR: Record<string, string> = {
  success: 'var(--success)',
  error: 'var(--danger)',
  warning: 'var(--warning)',
  info: 'var(--accent)',
};

// Look up by own-property only: a model-supplied status like "constructor" or
// "toString" would otherwise resolve through Object.prototype to a truthy value
// and slip past the map, so guard against prototype keys explicitly.
export function statusColor(key: string, fallback = 'var(--text-muted)'): string {
  return Object.prototype.hasOwnProperty.call(STATUS_COLOR, key) ? STATUS_COLOR[key] : fallback;
}

const COLOR_MAP: Record<string, string> = {
  accent: 'var(--accent)',
  green: 'var(--success)',
  success: 'var(--success)',
  orange: 'var(--warning)',
  warning: 'var(--warning)',
  red: 'var(--danger)',
  error: 'var(--danger)',
  danger: 'var(--danger)',
  info: 'var(--accent)',
  blue: 'var(--accent)',
  muted: 'var(--text-muted)',
  secondary: 'var(--text-secondary)',
  text: 'var(--text)',
  white: 'var(--text)',
  gray: 'var(--text-muted)',
  grey: 'var(--text-muted)',
};

// Only allow our themed names plus literal hex/rgb/hsl/plain-word colors. This
// blocks CSS functions like url()/var()/image-set() from model-supplied specs
// from smuggling network requests or escaping the intended style.
const SAFE_COLOR_RE =
  /^(#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|rgba?\([\d.,\s%/]+\)|hsla?\([\d.,\s%/]+\)|[a-z]+)$/i;

export function resolveColor(c: unknown): string | undefined {
  if (typeof c !== 'string' || !c) return undefined;
  const trimmed = c.trim();
  const mapped = COLOR_MAP[trimmed.toLowerCase()];
  if (mapped) return mapped;
  return SAFE_COLOR_RE.test(trimmed) ? trimmed : undefined;
}
