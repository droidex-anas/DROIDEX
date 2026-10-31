// The canonical builder every document that is not typed by hand comes from:
// presets, imports, extraction and the v1.6 conversion (design system documents
// spec §2). Contract tokens land in their sections and groups by name, any other
// token in Other tokens, and the sections follow the canonical order. A note
// longer than one holds continues in name-2.md and on, so nothing is cut.

import { DOCUMENT_LIMITS, type DocumentSection } from './designSystemDocument.js';

type TokenKind = Exclude<DocumentSection['kind'], 'notes' | 'components' | 'assets'>;
type DocumentItem = DocumentSection['items'][number];

export type DocumentPart =
  | { kind: 'note'; label: string; body: string }
  | {
      kind: 'preview';
      title: string;
      example: string;
      width: number;
      height: number;
      note?: string;
    };

export interface DocumentSource {
  tokens: { light: Record<string, string>; dark: Record<string, string> };
  /** Notes and demos for the Overview section, in order. */
  overview?: DocumentPart[];
  /** Notes and previews for the Components section, in order. */
  components?: DocumentPart[];
}

const TOKEN_SECTIONS: { kind: TokenKind; title: string }[] = [
  { kind: 'colors', title: 'Colors' },
  { kind: 'typography', title: 'Typography' },
  { kind: 'spacing', title: 'Spacing' },
  { kind: 'radius', title: 'Corner radius' },
  { kind: 'shadows', title: 'Shadows' },
  { kind: 'motion', title: 'Motion' },
  { kind: 'tokens', title: 'Other tokens' },
];

/** The tokens Button, Input, Card, Badge, Tabs and Dialog read, grouped as a document shows them. */
const CONTRACT_GROUPS: { kind: TokenKind; title: string; names: string[] }[] = [
  {
    kind: 'colors',
    title: 'Surfaces',
    names: [
      '--ds-canvas',
      '--ds-surface',
      '--ds-raised',
      '--ds-elevated',
      '--ds-active',
      '--ds-border',
      '--ds-backdrop',
    ],
  },
  { kind: 'colors', title: 'Text', names: ['--ds-fg', '--ds-fg-muted'] },
  { kind: 'colors', title: 'Accent', names: ['--ds-accent', '--ds-accent-soft', '--ds-accent-fg'] },
  { kind: 'colors', title: 'Status', names: ['--ds-positive', '--ds-danger'] },
  { kind: 'colors', title: 'Interaction', names: ['--ds-lift', '--ds-press', '--ds-focus'] },
  {
    kind: 'typography',
    title: 'Type sizes',
    names: ['--ds-text-xs', '--ds-text-sm', '--ds-text-base', '--ds-text-lg', '--ds-text-xl'],
  },
  {
    kind: 'typography',
    title: 'Type families',
    names: ['--ds-font-sans', '--ds-font-heading', '--ds-font-mono'],
  },
  {
    kind: 'spacing',
    title: 'Spacing scale',
    names: ['--ds-space-1', '--ds-space-2', '--ds-space-3', '--ds-space-4', '--ds-space-6'],
  },
  {
    kind: 'radius',
    title: 'Corners',
    names: ['--ds-radius-sm', '--ds-radius-md', '--ds-radius-lg', '--ds-radius-pill'],
  },
  { kind: 'shadows', title: 'Elevation', names: ['--ds-shadow-sm', '--ds-shadow-md'] },
  { kind: 'motion', title: 'Durations', names: ['--ds-duration'] },
];

/** Every token name the shared primitives read. */
export const CONTRACT_TOKEN_NAMES: ReadonlySet<string> = new Set(
  CONTRACT_GROUPS.flatMap((group) => group.names),
);

export function buildDocument(source: DocumentSource): DocumentSection[] {
  // Section ids are fixed, and the two §14 preview targets are never an item's.
  const ids = new Set(['overview', 'components', 'cover', ...TOKEN_SECTIONS.map((s) => s.kind)]);
  const sections: DocumentSection[] = [];
  if (source.overview?.length)
    sections.push({
      kind: 'notes',
      id: 'overview',
      title: 'Overview',
      items: source.overview.flatMap((part) => items(part, ids)),
    });

  const { light, dark } = source.tokens;
  const names = [...new Set([...Object.keys(light), ...Object.keys(dark)])];
  const token = (name: string) => {
    const lightValue = light[name] ?? dark[name];
    const darkValue = dark[name] ?? light[name];
    return lightValue === darkValue
      ? { name, value: lightValue }
      : { name, light: lightValue, dark: darkValue };
  };
  const groups = [
    ...CONTRACT_GROUPS.map((group) => ({
      ...group,
      names: group.names.filter((name) => names.includes(name)),
    })),
    {
      kind: 'tokens' as const,
      title: 'Other',
      names: names.filter((name) => !CONTRACT_TOKEN_NAMES.has(name)),
    },
  ];
  for (const { kind, title } of TOKEN_SECTIONS) {
    const items = groups
      .filter((group) => group.kind === kind && group.names.length > 0)
      .map((group) => ({
        kind: 'group' as const,
        id: uniqueId(ids, group.title),
        title: group.title,
        tokens: group.names.map(token),
      }));
    if (items.length > 0) sections.push({ kind, id: kind, title, items });
  }

  if (source.components?.length)
    sections.push({
      kind: 'components',
      id: 'components',
      title: 'Components',
      items: source.components.flatMap((part) => items(part, ids)),
    });
  return sections;
}

function items(
  part: DocumentPart,
  ids: Set<string>,
): Extract<DocumentItem, { kind: 'note' | 'preview' }>[] {
  if (part.kind === 'preview') return [{ ...part, id: uniqueId(ids, part.title) }];
  const stem = part.label.slice(0, -'.md'.length);
  return noteBodies(part.body, DOCUMENT_LIMITS.maxNoteBytes).map((body, index) => {
    const label = index === 0 ? part.label : `${stem}-${String(index + 1)}.md`;
    return {
      kind: 'note',
      label,
      body,
      id: uniqueId(ids, `${label.slice(0, -'.md'.length)}-note`),
      author: 'user',
    };
  });
}

// Where a long note breaks, coarsest first: between paragraphs or before a
// heading, then between lines, then between characters.
const NOTE_BREAKS = [/(?<=\n\n)|(?<=\n)(?=#{1,6} )/, /(?<=\n)/, /(?:)/u];

function noteBodies(text: string, maxBytes: number, level = 0): string[] {
  const bodies: string[] = [];
  let body = '';
  let bytes = 0;
  for (const piece of text.split(NOTE_BREAKS[level])) {
    const size = Buffer.byteLength(piece, 'utf8');
    if (bytes + size <= maxBytes) {
      body += piece;
      bytes += size;
      continue;
    }
    if (body !== '') bodies.push(body);
    const parts = size <= maxBytes ? [piece] : noteBodies(piece, maxBytes, level + 1);
    body = parts.pop() ?? '';
    bytes = Buffer.byteLength(body, 'utf8');
    bodies.push(...parts);
  }
  bodies.push(body);
  return bodies;
}

function uniqueId(ids: Set<string>, text: string): string {
  const base =
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'item';
  let id = base;
  for (let suffix = 2; ids.has(id); suffix += 1) id = `${base}-${String(suffix)}`;
  ids.add(id);
  return id;
}
