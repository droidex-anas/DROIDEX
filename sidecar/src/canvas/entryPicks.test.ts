import assert from 'node:assert/strict';
import test from 'node:test';
import type { CatalogEntry, PropPick } from './kitCatalog.js';
import { SourceElementError } from './sourceElementError.js';
import { withPicks } from './entryPicks.js';

const TOGGLE: CatalogEntry = {
  name: 'Toggle',
  module: 'index.tsx',
  uses: ['Button'],
  icons: [],
  jsx: '<div>\n  <p>Bold</p>\n  <Button variant="outline" onClick={undefined}>B</Button>\n  <Button>I</Button>\n</div>',
  note: null,
  props: [
    { name: 'variant', options: ['default', 'outline', 'ghost'], default: 'outline' },
    { name: 'size', options: ['default', 'sm'], default: 'default' },
    { name: 'title', options: ['alpha', 'beta'], default: 'alpha' },
  ],
};

function refusal(entry: CatalogEntry, picks: PropPick[]): string {
  try {
    withPicks(entry, picks);
  } catch (error) {
    assert.ok(error instanceof SourceElementError);
    return error.message;
  }
  assert.fail('the picks were not refused');
}

test('picked props are written on the first element written with a used component', () => {
  const picks = [
    { name: 'variant', value: 'ghost' },
    { name: 'size', value: 'sm' },
  ];
  assert.equal(
    withPicks(TOGGLE, picks),
    '<div>\n  <p>Bold</p>\n  <Button size="sm" variant="ghost" onClick={undefined}>B</Button>\n  <Button>I</Button>\n</div>',
  );
  assert.equal(
    refusal(TOGGLE, [{ name: 'variant', value: 'link' }]),
    'This entry has no option link for variant. Pick one it lists.',
  );
  const inCode = { ...TOGGLE, jsx: '<Button variant={"outline"}>B</Button>' };
  assert.equal(
    refusal(inCode, [{ name: 'variant', value: 'ghost' }]),
    'This entry writes variant in code, so it cannot be picked.',
  );
  const twice = { ...TOGGLE, jsx: '<Button title="alpha" title="beta">Hi</Button>' };
  assert.equal(
    refusal(twice, [{ name: 'title', value: 'beta' }]),
    'This entry writes title more than once, so it cannot be picked.',
  );
});
