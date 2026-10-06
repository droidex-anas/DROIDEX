import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyOpenReviewAt,
  clearReviewFocus,
  exhaustedReviewFocus,
  openReviewAt,
  planReviewFocus,
} from './reviewFocus';

const change = {
  path: 'src/app.ts',
  verb: 'edit' as const,
  ops: [{ type: 'add' as const, text: 'hello' }],
  added: 1,
  removed: 0,
};

test('a review focus request carries the captured change until the focus is cleared', () => {
  assert.deepEqual(openReviewAt('src/app.ts', change), {
    type: 'OPEN_REVIEW_AT',
    scope: 'last_turn',
    path: 'src/app.ts',
    change,
  });
  assert.equal(openReviewAt('src/app.ts', change, 'uncommitted').scope, 'uncommitted');

  const opened = applyOpenReviewAt(
    { reviewFocusPath: null, reviewFocusChange: null, reviewFocusRequestId: 0 },
    openReviewAt('src/app.ts', change),
  );
  assert.equal(opened.reviewFocusPath, 'src/app.ts');
  assert.equal(opened.reviewFocusChange, change);
  assert.equal(opened.reviewFocusRequestId, 1);

  const cleared = clearReviewFocus(opened);
  assert.equal(cleared.reviewFocusPath, null);
  assert.equal(cleared.reviewFocusChange, null);
});

test('exhaustedReviewFocus prefers the captured transcript change over a disk preview', () => {
  assert.deepEqual(exhaustedReviewFocus(change, 'src/app.ts'), { kind: 'change', change });
  assert.deepEqual(exhaustedReviewFocus(null, 'src/app.ts'), {
    kind: 'preview',
    path: 'src/app.ts',
    content: null,
  });
});

test('planReviewFocus shows a captured change while loading, when listed, and when no scope lists it', () => {
  const request = {
    focusPath: 'src/app.ts',
    focusChange: change,
    files: [] as { path: string }[],
    loadingList: false,
    currentScope: 'last_turn' as const,
    requestId: 1,
    alreadyTriedKey: null as string | null,
  };
  for (const input of [
    { ...request, loadingList: true },
    // The captured edit is preserved even when Git lists the file.
    { ...request, files: [{ path: 'src/app.ts' }] },
    {
      ...request,
      currentScope: 'commit' as const,
      requestId: 4,
      alreadyTriedKey: '4:commit→src/app.ts',
    },
  ]) {
    assert.deepEqual(planReviewFocus(input), {
      kind: 'detached',
      focus: { kind: 'change', change },
    });
  }
});

test('planReviewFocus advances Git scopes for a path-only request', () => {
  const plan = planReviewFocus({
    focusPath: 'src/app.ts',
    focusChange: null,
    files: [],
    loadingList: false,
    currentScope: 'last_turn',
    requestId: 4,
    alreadyTriedKey: null,
  });
  assert.equal(plan.kind, 'advance');
  if (plan.kind !== 'advance') return;
  assert.equal(plan.scope, 'uncommitted');
});
