import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { initialState, StaticStoreProvider } from '../../../hooks/useStore';
import { PrDiff } from './PrDiff';

const patch = [
  'diff --git a/src/app/main.ts b/src/app/main.ts',
  '--- a/src/app/main.ts',
  '+++ b/src/app/main.ts',
  '@@ -1 +1,2 @@',
  ' keep',
  '+added',
  'diff --git a/README.md b/README.md',
  '--- a/README.md',
  '+++ b/README.md',
  '@@ -1 +1 @@',
  '-old',
  '+new',
].join('\n');

function renderDiff(): string {
  return renderToStaticMarkup(
    createElement(
      StaticStoreProvider,
      { state: initialState, dispatch: () => undefined },
      createElement(PrDiff, {
        diff: patch,
        cwd: '/repo',
        number: 4,
        comments: [],
        onSendReview: () => undefined,
      }),
    ),
  );
}

test('the pull-request diff has a hideable hierarchical file tree on the right', () => {
  const html = renderDiff();
  assert.match(html, /Hide file tree/);
  assert.match(html, /aria-label="Filter files"/);
  assert.match(html, /role="tree" aria-label="Changed files"/);
  assert.match(html, /data-tree-path="src"/);
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /data-tree-path="src\/app\/main.ts"/);
  assert.match(html, /role="checkbox" aria-checked="false"/);
  assert.match(html, /Wrap long lines|Scroll long lines/);
});
