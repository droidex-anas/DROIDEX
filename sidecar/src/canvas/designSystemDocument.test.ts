import assert from 'node:assert/strict';
import test from 'node:test';

import type * as Renderer from '../../../src/features/canvas/designSystemDocumentProtocol.js';
import { DROIDEX_DOCUMENT_SECTIONS } from '../testing/droidexDocument.js';
import {
  CANONICAL_SECTION_ORDER,
  documentSectionsSchema,
  insertSection,
  kitGuidance,
  kitModes,
  type DocumentSection,
} from './designSystemDocument.js';

type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

function emptySection(kind: DocumentSection['kind'], id: string = kind): DocumentSection {
  return { kind, id, title: kind, items: [] };
}

test('the renderer mirrors the document types exactly, and the DROIDEX fixture is a document', () => {
  const isExact: Equals<DocumentSection, Renderer.DocumentSection> = true;
  assert.ok(isExact);
  assert.deepEqual(
    documentSectionsSchema.parse(DROIDEX_DOCUMENT_SECTIONS),
    DROIDEX_DOCUMENT_SECTIONS,
  );
});

test('kit modes give a single-value token both modes and a split token each its own', () => {
  const radius: DocumentSection = {
    kind: 'radius',
    id: 'radius',
    title: 'Corner radius',
    items: [
      {
        kind: 'group',
        id: 'corners',
        title: 'Corners',
        tokens: [{ name: '--ds-radius', value: '8px' }],
      },
    ],
  };
  const { light, dark } = kitModes([...DROIDEX_DOCUMENT_SECTIONS, radius]);

  assert.equal(light['--ds-accent'], '#8a5a1f');
  assert.equal(dark['--ds-accent'], '#e3a857');
  assert.equal(light['--ds-radius'], '8px');
  assert.equal(dark['--ds-radius'], '8px');
  assert.deepEqual(Object.keys(light), Object.keys(dark));
});

test('kit guidance reads titles, notes and usage notes in document order', () => {
  const guidance = kitGuidance('DROIDEX', DROIDEX_DOCUMENT_SECTIONS);
  const positions = [
    '# DROIDEX',
    '### 1-rules.md',
    '- --ds-surface: The reading area of a window.',
    '## Shadows',
    '### button.md',
    '- Button: Primary, secondary and ghost',
  ].map((line) => guidance.indexOf(line));

  assert.ok(positions.every((position, index) => position > (positions[index - 1] ?? -1)));
  // Tokens without a usage note are already in the brief's name list.
  assert.equal(guidance.includes('--ds-canvas'), false);
});

test("kit guidance keeps a section's usage notes where they sit between its notes", () => {
  const note = (label: string) => ({
    kind: 'note' as const,
    id: label.slice(0, -3),
    label,
    body: label,
    author: 'user' as const,
  });
  const preview = (title: string) => ({
    kind: 'preview' as const,
    id: title.toLowerCase(),
    title,
    example: `${title}.tsx`,
    width: 480,
    height: 320,
    note: `Use ${title}.`,
  });
  const components: DocumentSection = {
    kind: 'components',
    id: 'components',
    title: 'Components',
    items: [preview('Button'), note('forms.md'), preview('Input'), preview('Card'), note('end.md')],
  };

  assert.equal(
    kitGuidance('Kit', [components]),
    [
      '# Kit',
      '## Components',
      '- Button: Use Button.',
      '### forms.md\n\nforms.md',
      '- Input: Use Input.\n- Card: Use Card.',
      '### end.md\n\nend.md',
    ].join('\n\n'),
  );
});

test('a section added later goes to its canonical place, even after the user reordered', () => {
  const kinds = (sections: DocumentSection[]) => sections.map((section) => section.kind);
  const built = [...CANONICAL_SECTION_ORDER]
    .reverse()
    .reduce<DocumentSection[]>((sections, kind) => insertSection(sections, emptySection(kind)), []);
  assert.deepEqual(kinds(built), CANONICAL_SECTION_ORDER);

  const withSecondNotes = insertSection(DROIDEX_DOCUMENT_SECTIONS, emptySection('notes', 'more'));
  assert.deepEqual(kinds(withSecondNotes).slice(0, 3), ['notes', 'notes', 'colors']);

  const reordered = [emptySection('colors'), emptySection('notes')];
  assert.deepEqual(kinds(insertSection(reordered, emptySection('typography'))), [
    'colors',
    'notes',
    'typography',
  ]);
});
