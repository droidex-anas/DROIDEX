import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { initialState, StaticStoreProvider } from '../../../hooks/useStore';
import { applyCommentPostSettlement, CodePane, PrDetail } from './PrDetail';

function renderCodePane(diff: string | null, diffError: string | null): string {
  return renderToStaticMarkup(
    createElement(
      StaticStoreProvider,
      { state: initialState, dispatch: () => undefined },
      createElement(CodePane, { diff, diffError }),
    ),
  );
}

test('the Summary and Code views are an accessible tab list', () => {
  const html = renderToStaticMarkup(
    createElement(PrDetail, {
      cwd: '/repo',
      number: 4,
      pr: null,
      viewerLogin: null,
      onOpenChat: () => undefined,
      onReviewWithDroid: () => undefined,
    }),
  );
  assert.match(html, /role="tablist" aria-label="Pull request views"/);
  assert.match(html, /role="tab"[^>]*aria-selected="true"[^>]*>Summary</);
  assert.match(html, /role="tab"[^>]*aria-selected="false"[^>]*>Code</);
  assert.match(html, /id="pull-request-summary-tab" aria-controls="pull-request-summary-tabpanel"/);
  assert.match(
    html,
    /role="tabpanel" id="pull-request-summary-tabpanel" aria-labelledby="pull-request-summary-tab"/,
  );
});

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

test('the code pane keeps its skeleton until a patch arrives, and a refresh error replaces the patch', () => {
  // The loading skeleton is the only element carrying this surface tone.
  const skeleton = /bg-droid-elevated\/40/;
  const loading = renderCodePane(null, null);
  assert.match(loading, skeleton);
  assert.doesNotMatch(loading, /No file changes\./);

  const empty = renderCodePane('', null);
  assert.match(empty, /No file changes\./);
  assert.doesNotMatch(empty, skeleton);

  const stalePatch = [
    'diff --git a/a.ts b/a.ts',
    '--- a/a.ts',
    '+++ b/a.ts',
    '@@ -1 +1 @@',
    '-old',
    '+new',
  ].join('\n');
  const failed = renderCodePane(stalePatch, 'Could not refresh diff');
  assert.match(failed, /Could not refresh diff/);
  assert.doesNotMatch(failed, /a\.ts/);
});
