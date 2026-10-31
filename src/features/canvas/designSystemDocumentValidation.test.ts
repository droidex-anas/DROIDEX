import assert from 'node:assert/strict';
import test from 'node:test';

import { documentSectionsSchema } from '../../../sidecar/src/canvas/designSystemDocument.js';
import type { CanvasEvent } from '../../../sidecar/src/canvas/protocol.js';
import { DROIDEX_DOCUMENT_SECTIONS } from '../../../sidecar/src/testing/droidexDocument.js';
import type { DocumentSection } from './designSystemDocumentProtocol';
import { isDocumentSections } from './designSystemDocumentValidation';
import { isCanvasEvent } from './wireValidation';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function acceptedBy(sections: DocumentSection[]) {
  const serialized: unknown = JSON.parse(JSON.stringify(sections));
  return {
    sidecar: documentSectionsSchema.safeParse(serialized).success,
    renderer: isDocumentSections(serialized),
  };
}

function tokenSection(id: string, names: string[]): DocumentSection {
  return {
    kind: 'tokens',
    id,
    title: 'Other tokens',
    items: [
      {
        kind: 'group',
        id: `${id}-group`,
        title: 'Other',
        tokens: names.map((name) => ({ name, value: '1px' })),
      },
    ],
  };
}

// Types agreeing is not enough: a document the sidecar saves has to reach the
// document view, and one it refuses must not be shown.
test('both boundaries accept the DROIDEX document and refuse the same ones past its limits', () => {
  assert.deepEqual(acceptedBy(DROIDEX_DOCUMENT_SECTIONS), { sidecar: true, renderer: true });

  const [overview, colors, shadows, components] = DROIDEX_DOCUMENT_SECTIONS;
  const manyNames = Array.from({ length: 125 }, (_, index) => `--other-${String(index)}`);
  const copiedLabel = {
    ...overview,
    items: [...overview.items, { ...overview.items[0], id: 'rules-copy' }],
  };
  const widePreview = {
    ...components,
    items: components.items.map((item) =>
      item.kind === 'preview' ? { ...item, width: 1441 } : item,
    ),
  };
  const refused: Record<string, DocumentSection[]> = {
    'more than 128 tokens': [...DROIDEX_DOCUMENT_SECTIONS, tokenSection('other', manyNames)],
    'a token in two sections': [
      ...DROIDEX_DOCUMENT_SECTIONS,
      tokenSection('other', ['--ds-accent']),
    ],
    'two notes with one label': [copiedLabel, colors, shadows, components],
    'two colour sections': [
      ...DROIDEX_DOCUMENT_SECTIONS,
      { kind: 'colors', id: 'more', title: 'More', items: [] },
    ],
    'a preview wider than 1440 px': [overview, colors, shadows, widePreview],
  };
  for (const [name, sections] of Object.entries(refused))
    assert.deepEqual(acceptedBy(sections), { sidecar: false, renderer: false }, name);
});

// Values the sidecar trims or refuses must read the same in the renderer, or a
// document one side saves is one the other cannot show.
test('both boundaries trim and refuse the same token values, titles, example paths and keys', () => {
  const [overview, colors, shadows, components] = DROIDEX_DOCUMENT_SECTIONS;
  const group = colors.items.find((item) => item.kind === 'group');
  const preview = components.items.find((item) => item.kind === 'preview');
  assert.ok(group?.kind === 'group' && preview?.kind === 'preview');
  const [token] = group.tokens;
  const withColors = (changed: object) => [
    overview,
    { ...colors, items: [changed, ...colors.items.filter((item) => item !== group)] },
    shadows,
    components,
  ];
  const withToken = (changed: object) =>
    withColors({ ...group, tokens: [changed, ...group.tokens.slice(1)] });
  const withValue = (value: string) => withToken({ name: token.name, value });
  const withPreview = (changed: object) => [
    overview,
    colors,
    shadows,
    { ...components, items: components.items.map((item) => (item === preview ? changed : item)) },
  ];
  const cases: [string, unknown[], boolean][] = [
    ['a value that ends its rule', withValue('red; color: blue'), false],
    ['a value that opens a comment', withValue('red/*comment*/'), false],
    ['a value across two lines', withValue('red\nblue'), false],
    ['a value of one space', withValue(' '), false],
    ['a full-length value padded with spaces', withValue(` ${'x'.repeat(160)} `), true],
    [
      'a section title of one space',
      [{ ...overview, title: ' ' }, colors, shadows, components],
      false,
    ],
    [
      'a full-length title padded with spaces',
      [{ ...overview, title: ` ${'x'.repeat(120)} ` }, colors, shadows, components],
      true,
    ],
    ['an example outside the kit', withPreview({ ...preview, example: '../Button.tsx' }), false],
    [
      'an example under a reserved name',
      withPreview({ ...preview, example: 'constructor/Button.tsx' }),
      false,
    ],
    [
      'a section with an extra key',
      [{ ...overview, hidden: true }, colors, shadows, components],
      false,
    ],
    ['a token with an extra key', withToken({ ...token, hidden: true }), false],
  ];
  for (const [name, sections, accepted] of cases)
    assert.deepEqual(
      acceptedBy(sections as DocumentSection[]),
      { sidecar: accepted, renderer: accepted },
      name,
    );
});

test('the renderer accepts every design system reply and event the sidecar sends', () => {
  const events: CanvasEvent[] = [
    {
      type: 'canvas.result',
      requestId: 'req_03',
      ok: true,
      reply: {
        kind: 'designSystems',
        systems: [
          {
            id: 'droidex',
            version: 1,
            name: 'DROIDEX',
            kind: 'preset',
            swatches: {
              light: { surface: '#fdfbf7', accent: '#8a5a1f' },
              dark: { surface: '#191817', accent: '#e3a857' },
            },
            cover: true,
            savedAt: null,
            proposal: false,
          },
        ],
      },
    },
    {
      type: 'canvas.result',
      requestId: 'req_03',
      ok: true,
      reply: {
        kind: 'designSystem',
        system: {
          id: 'paper',
          version: 2,
          latestVersion: 3,
          name: 'Paper',
          kind: 'user',
          cover: { kind: 'preview', example: 'cover.tsx' },
          sections: DROIDEX_DOCUMENT_SECTIONS,
          examples: ['cover.tsx'],
          unmapped: ['--brand-ink'],
          provenance: { copiedFrom: { id: 'droidex', version: 1 } },
          savedAt: '2026-10-31T12:00:00.000Z',
          savedBy: { actor: 'agent', appSessionId: 'app-1' },
          proposal: null,
        },
      },
    },
    {
      type: 'canvas.result',
      requestId: 'req_03',
      ok: true,
      reply: {
        kind: 'designSystemVersions',
        versions: [{ version: 2, savedAt: '2026-10-31T12:00:00.000Z', savedBy: { actor: 'user' } }],
      },
    },
    {
      type: 'canvas.result',
      requestId: 'req_04',
      ok: false,
      error: {
        code: 'revision_conflict',
        message: 'This design system now has version 3.',
        latestVersion: 3,
      },
    },
    { type: 'canvas.designSystemsChanged', id: 'paper' },
    {
      type: 'canvas.result',
      requestId: 'req_03',
      ok: true,
      reply: {
        kind: 'designSystemSaved',
        ref: { id: 'paper', version: 1 },
        diagnostics: [{ code: 'single_mode_token', message: 'Both modes use it.', line: 4 }],
      },
    },
  ];
  for (const event of events) {
    const serialized: unknown = JSON.parse(JSON.stringify(event));
    assert.ok(
      isRecord(serialized) && isCanvasEvent(serialized),
      `rejected ${JSON.stringify(event).slice(0, 80)}`,
    );
  }
});
