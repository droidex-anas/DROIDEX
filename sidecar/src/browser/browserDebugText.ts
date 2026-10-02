// What the debug tools say: a line per console message, request or fact about
// an element, short enough to read in a turn.

import type {
  BrowserConsoleEvent,
  BrowserElementInspection,
  BrowserNetworkEvent,
} from './types.js';

const LEVELS = ['debug', 'info', 'warning', 'error'];

/** Console messages since the last read, a repeated one counted. */
export function consoleText(events: BrowserConsoleEvent[]): string {
  if (events.length === 0) return 'No console messages since the last read.';
  const lines: { text: string; times: number }[] = [];
  for (const event of events) {
    const where = event.source
      ? `  (${event.source}${event.line ? `:${String(event.line)}` : ''})`
      : '';
    const text = `${LEVELS[event.level] ?? 'info'}  ${event.message.trimEnd()}${where}`;
    const last = lines.at(-1);
    if (last?.text === text) last.times += 1;
    else lines.push({ text, times: 1 });
  }
  return [
    `${counted(events.length, 'console message')} since the last read:`,
    ...lines.map(({ text, times }) => (times > 1 ? `${text}  ×${String(times)}` : text)),
  ].join('\n');
}

/** Requests that finished since the last read: status, method, URL, type, time, size. */
export function networkText(events: BrowserNetworkEvent[]): string {
  if (events.length === 0) return 'No requests finished since the last read.';
  return [
    `${counted(events.length, 'request')} since the last read:`,
    ...events.map((event) =>
      [
        event.error ? 'failed' : String(event.status ?? '?'),
        event.method,
        event.url,
        event.resourceType,
        event.error,
        event.durationMs === undefined ? undefined : `${String(event.durationMs)} ms`,
        event.bytes === undefined ? undefined : sizeText(event.bytes),
        event.cached ? 'cached' : undefined,
      ]
        .filter(Boolean)
        .join('  '),
    ),
  ].join('\n');
}

/** One element: what it is, where it is, how it looks, and its markup. */
export function inspectionText(inspection: BrowserElementInspection): string {
  const { box, iframe } = inspection;
  const named = [inspection.role, inspection.name ? `"${inspection.name}"` : undefined];
  const facts = (record: Record<string, string>, shown: (name: string, value: string) => string) =>
    Object.entries(record)
      .filter(([, value]) => value)
      .map(([name, value]) => shown(name, value))
      .join('; ');
  return [
    [`<${inspection.tagName}>`, ...named].filter(Boolean).join(' '),
    `box: ${String(box.x)}, ${String(box.y)}, ${String(box.width)} × ${String(box.height)} CSS px`,
    `selector: ${inspection.selector}`,
    line(
      'attributes',
      facts(inspection.attributes, (name, value) => `${name}="${value}"`),
    ),
    line(
      'styles',
      facts(inspection.styles, (name, value) => `${cssName(name)}: ${value}`),
    ),
    line('text', inspection.text),
    iframe
      ? `frame: ${iframe.src ?? 'no address'}, ${iframe.accessible ? 'same site' : 'cross-site'}`
      : undefined,
    `html: ${inspection.html}`,
  ]
    .filter(Boolean)
    .join('\n');
}

function line(label: string, value: string | undefined): string | undefined {
  return value ? `${label}: ${value}` : undefined;
}

function counted(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? '' : 's'}`;
}

function cssName(property: string): string {
  return property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function sizeText(bytes: number): string {
  if (bytes < 1000) return `${String(bytes)} B`;
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(1)} kB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}
