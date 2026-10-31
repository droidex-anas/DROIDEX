import assert from 'node:assert/strict';
import test from 'node:test';

import { documentSectionsSchema } from '../../../sidecar/src/canvas/designSystemDocument.js';
import { DROIDEX_DOCUMENT_SECTIONS } from '../../../sidecar/src/testing/droidexDocument.js';
import type { DocumentSection } from './designSystemDocumentProtocol';
import { isDocumentSections } from './designSystemDocumentValidation';

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
