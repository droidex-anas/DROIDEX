import assert from 'node:assert/strict';
import test from 'node:test';
import type { CatalogListing } from '../protocol';
import { paletteRows, propPicks } from './paletteRows';

const entry = (name: string, module: string | null = null, note: string | null = null) => ({
  name,
  module,
  note,
  props: [],
});

const CATALOG: CatalogListing[] = [
  entry('Alert dialog', 'alert-dialog.tsx'),
  entry('Button', 'button.tsx'),
  entry('Tabs', 'components/ui/tabs.tsx'),
  entry('Data table', 'table.tsx', 'Sortable rows'),
  entry('TabBar'),
  entry('Stable list', null, 'Holds a table of tabs'),
  entry('Lexicon'),
  entry('SVGIcon'),
];

test('a search finds names starting with it first, then words, then names, then files and notes', () => {
  const names = (query: string) => paletteRows(CATALOG, query).map((each) => each.name);
  assert.deepEqual(
    names(''),
    CATALOG.map((each) => each.name),
  );
  assert.deepEqual(names(' tab'), ['Tabs', 'TabBar', 'Data table', 'Stable list']);
  // "Bar" is a word of TabBar; "dialog" one of Alert dialog's.
  assert.deepEqual(names('bar'), ['TabBar']);
  assert.deepEqual(names('DIALOG'), ['Alert dialog']);
  // "Icon" is a word of SVGIcon, so it goes before a name only holding it.
  assert.deepEqual(names('icon'), ['SVGIcon', 'Lexicon']);
  assert.deepEqual(names('sortable'), ['Data table']);
  assert.deepEqual(names('menu'), []);
  // A file matches by its name, not the folder or extension every entry shares.
  assert.deepEqual(names('ui'), []);
  assert.deepEqual(names('tsx'), []);
});

test('a row sends the picks that change what its entry writes, and none the entry no longer lists', () => {
  const button: CatalogListing = {
    ...entry('Button'),
    props: [
      { name: 'variant', options: ['default', 'outline', 'ghost'], default: 'outline' },
      { name: 'size', options: ['default', 'sm'], default: 'default' },
    ],
  };
  assert.deepEqual(propPicks(button, {}), []);
  assert.deepEqual(propPicks(button, { size: 'sm', variant: 'ghost' }), [
    { name: 'variant', value: 'ghost' },
    { name: 'size', value: 'sm' },
  ]);
  // The entry's own default, and an option a re-read catalog dropped, send nothing.
  assert.deepEqual(propPicks(button, { variant: 'outline', size: 'lg' }), []);
});
