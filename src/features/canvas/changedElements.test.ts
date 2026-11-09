import assert from 'node:assert/strict';
import test from 'node:test';
import { changedElements } from './changedElements';
import type { SourceElement } from './protocol';

const BEFORE = `export default function Card() {
  return (
    <section>
      <h1>Plans</h1>
      <p>Pick one.</p>
    </section>
  );
}
`;

/** The elements of `source` as the build reports them, one per tag named, outermost first. */
function elementsOf(source: string, file = 'main.tsx'): SourceElement[] {
  return ['section', 'h1', 'p'].flatMap((tagName) => {
    const start = source.indexOf(`<${tagName}>`);
    if (start < 0) return [];
    const end = source.indexOf(`</${tagName}>`) + tagName.length + 3;
    return [
      {
        elementId: `${file}:${tagName}`,
        file,
        start,
        end,
        line: 1,
        tagName,
        component: 'Card',
        editability: 'literal',
      },
    ];
  });
}

const ids = (elements: SourceElement[]) => elements.map((element) => element.elementId);

test('a write changed the innermost elements whose source is new', () => {
  const after = BEFORE.replace('Plans', 'Pricing').replace('Pick one.', 'Pick a plan.');

  // The section holds both, so it changed with them and is left out.
  assert.deepEqual(
    ids(changedElements(elementsOf(after), { 'main.tsx': BEFORE }, { 'main.tsx': after })),
    ['main.tsx:h1', 'main.tsx:p'],
  );
});

test('markup kept or moved to another file is no change, and a removed element changes its holder', () => {
  const removed = BEFORE.replace('      <p>Pick one.</p>\n', '');
  const before = { 'main.tsx': BEFORE };

  assert.deepEqual(ids(changedElements(elementsOf(BEFORE), before, before)), []);
  // The paragraph went, so only the section that held it changed.
  assert.deepEqual(ids(changedElements(elementsOf(removed), before, { 'main.tsx': removed })), [
    'main.tsx:section',
  ]);
  // The same markup now written in another file is where it was before.
  const moved = { 'card.tsx': BEFORE };
  assert.deepEqual(ids(changedElements(elementsOf(BEFORE, 'card.tsx'), before, moved)), []);
});
