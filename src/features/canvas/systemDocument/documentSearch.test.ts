import assert from 'node:assert/strict';
import test from 'node:test';
import type { DocumentSection } from '../designSystemDocumentProtocol';
import type { CatalogListing } from '../protocol';
import { CATALOG_SECTION_ID, itemCount, searchSections } from './documentSearch';

const COLORS: DocumentSection = {
  kind: 'colors',
  id: 'colors',
  title: 'Colors',
  items: [
    { kind: 'group', id: 'brand', title: 'Brand', tokens: [{ name: 'accent', value: '#f60' }] },
  ],
};
const ASSETS: DocumentSection = {
  kind: 'assets',
  id: 'assets',
  title: 'Assets',
  items: [{ kind: 'asset', id: 'logo', name: 'Logo', assetId: 'a1' }],
};
const COMPONENTS: DocumentSection = {
  kind: 'components',
  id: 'components',
  title: 'Components',
  items: [
    {
      kind: 'preview',
      id: 'sidebar',
      title: 'Sidebar',
      example: 'Sidebar',
      width: 320,
      height: 480,
    },
  ],
};
const CATALOG: CatalogListing[] = [
  { name: 'Button', module: 'components/ui/button.tsx', note: null },
  { name: 'Alert dialog', module: 'components/ui/alert-dialog.tsx', note: 'Asks before deleting' },
];
const NOTHING_REMOVED = () => false;

function shown(sections: DocumentSection[], query: string) {
  return searchSections(sections, CATALOG, query).map((section) => ({
    id: section.id,
    items: section.items.map((item) => item.id),
    catalog: section.catalog?.map((entry) => entry.name),
  }));
}

test('a kit without a Components section lists its catalog in one before its assets', () => {
  const sections = searchSections([COLORS, ASSETS], CATALOG, '');
  assert.deepEqual(
    sections.map((section) => section.id),
    ['colors', CATALOG_SECTION_ID, 'assets'],
  );
  assert.equal(itemCount(sections[1], NOTHING_REMOVED), 2);
  assert.deepEqual(
    searchSections([COLORS, ASSETS], [], '').map((section) => section.id),
    ['colors', 'assets'],
  );
});

test('search finds catalog entries by name, module or note, and keeps a section they alone match', () => {
  assert.deepEqual(shown([COLORS, COMPONENTS], 'button'), [
    { id: 'components', items: [], catalog: ['Button'] },
  ]);
  assert.deepEqual(shown([COMPONENTS], 'alert-dialog'), [
    { id: 'components', items: [], catalog: ['Alert dialog'] },
  ]);
  assert.deepEqual(shown([COLORS, ASSETS], 'deleting'), [
    { id: CATALOG_SECTION_ID, items: [], catalog: ['Alert dialog'] },
  ]);
  assert.deepEqual(shown([COLORS, COMPONENTS], 'sidebar'), [
    { id: 'components', items: ['sidebar'], catalog: [] },
  ]);
  assert.deepEqual(shown([COLORS, ASSETS], 'nothing like it'), []);
});
