import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { initialState, StaticStoreProvider } from '../../../hooks/useStore';
import { applyCommentPostSettlement, CodePane } from './PrDetail';

function renderCodePane(diff: string | null, diffError: string | null): string {
  return renderToStaticMarkup(
    createElement(
      StaticStoreProvider,
      { state: initialState, dispatch: () => undefined },
      createElement(CodePane, { diff, diffError }),
    ),
  );
}

test('comment submit settlement applies only to the pull request it was posted on', () => {
  const submitted = { cwd: '/repo', number: 1 };
  // Switching to another PR while posting must not clear its draft or posting flag.
  assert.equal(applyCommentPostSettlement(submitted, { cwd: '/repo', number: 2 }, true), null);
  assert.deepEqual(applyCommentPostSettlement(submitted, submitted, true), {
    clearDraft: true,
    posting: false,
  });
  assert.deepEqual(applyCommentPostSettlement(submitted, submitted, false), {
    clearDraft: false,
    posting: false,
  });
});

test('diff-success with an empty remote patch shows no file changes, not the skeleton', () => {
  const html = renderCodePane('', null);
  assert.match(html, /No file changes\./);
  assert.doesNotMatch(html, /bg-droid-elevated\/40/);
});

test('unset diff still shows the loading skeleton until a patch arrives', () => {
  const html = renderCodePane(null, null);
  assert.match(html, /bg-droid-elevated\/40/);
  assert.doesNotMatch(html, /No file changes\./);
});

test('a refresh error replaces a stale cached diff with the failure', () => {
  const html = renderCodePane(
    ['diff --git a/a.ts b/a.ts', '--- a/a.ts', '+++ b/a.ts', '@@ -1 +1 @@', '-old', '+new'].join(
      '\n',
    ),
    'Could not refresh diff',
  );
  assert.match(html, /Could not refresh diff/);
  assert.doesNotMatch(html, /a\.ts/);
});
