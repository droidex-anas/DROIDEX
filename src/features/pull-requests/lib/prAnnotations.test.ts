import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { PullRequest } from '../../../types/vcs';
import {
  addAnnotation,
  ANNOTATION_LIMIT,
  emptyPrReviewDraft,
  formatAnnotationsForPrompt,
  orderedAnnotations,
  removeAnnotation,
  toggleViewedFile,
  updateAnnotationBody,
} from './prAnnotations';

function note(overrides: Partial<Parameters<typeof addAnnotation>[1]> = {}) {
  return {
    path: 'src/foo.ts',
    side: 'new' as const,
    line: 42,
    code: 'const x = 1',
    body: 'why?',
    ...overrides,
  };
}

describe('prAnnotations', () => {
  it('adds an annotation with a stable id and trimmed body', () => {
    const draft = addAnnotation(emptyPrReviewDraft, note({ body: '  why?  ' }));
    assert.equal(draft.annotations.length, 1);
    assert.equal(draft.annotations[0].body, 'why?');
    assert.ok(draft.annotations[0].id.length > 0);
  });

  it('rejects empty and overlong bodies without changing the draft', () => {
    assert.equal(addAnnotation(emptyPrReviewDraft, note({ body: '  ' })), emptyPrReviewDraft);
    assert.equal(
      addAnnotation(emptyPrReviewDraft, note({ body: 'x'.repeat(4001) })),
      emptyPrReviewDraft,
    );
  });

  it('edits rather than duplicates when the same line is annotated twice', () => {
    let draft = addAnnotation(emptyPrReviewDraft, note({ body: 'first' }));
    draft = addAnnotation(draft, note({ body: 'second' }));
    assert.equal(draft.annotations.length, 1);
    assert.equal(draft.annotations[0].body, 'second');
  });

  it('keeps notes on the same line number apart when sides differ', () => {
    let draft = addAnnotation(emptyPrReviewDraft, note());
    draft = addAnnotation(draft, note({ side: 'old', body: 'old side note' }));
    assert.equal(draft.annotations.length, 2);
  });

  it('caps the draft at the annotation limit', () => {
    let draft = emptyPrReviewDraft;
    for (let line = 1; line <= ANNOTATION_LIMIT; line += 1) {
      draft = addAnnotation(draft, note({ line }));
    }
    const full = addAnnotation(draft, note({ line: ANNOTATION_LIMIT + 1 }));
    assert.equal(full.annotations.length, ANNOTATION_LIMIT);
  });

  it('updates and removes by id', () => {
    let draft = addAnnotation(emptyPrReviewDraft, note());
    const id = draft.annotations[0].id;
    draft = updateAnnotationBody(draft, id, 'revised');
    assert.equal(draft.annotations[0].body, 'revised');
    draft = removeAnnotation(draft, id);
    assert.equal(draft.annotations.length, 0);
    assert.equal(removeAnnotation(draft, id), draft);
  });

  it('toggles viewed files on and off', () => {
    let draft = toggleViewedFile(emptyPrReviewDraft, 'src/foo.ts');
    assert.deepEqual(draft.viewedFiles, ['src/foo.ts']);
    draft = toggleViewedFile(draft, 'src/foo.ts');
    assert.deepEqual(draft.viewedFiles, []);
  });

  it('orders annotations by path then line for the prompt', () => {
    let draft = addAnnotation(emptyPrReviewDraft, note({ path: 'src/b.ts', line: 9 }));
    draft = addAnnotation(draft, note({ path: 'src/a.ts', line: 30 }));
    draft = addAnnotation(draft, note({ path: 'src/a.ts', line: 4 }));
    const ordered = orderedAnnotations(draft.annotations).map(
      (item) => `${item.path}:${String(item.line)}`,
    );
    assert.deepEqual(ordered, ['src/a.ts:4', 'src/a.ts:30', 'src/b.ts:9']);
  });

  it('formats the prompt with path:line refs, code, and notes', () => {
    const pr = {
      number: 228,
      title: 'Add tabs',
      url: 'https://github.com/o/r/pull/228',
    } as PullRequest;
    let draft = addAnnotation(emptyPrReviewDraft, note());
    draft = addAnnotation(draft, note({ side: 'old', line: 7, path: 'src/old.ts', body: 'gone?' }));
    const prompt = formatAnnotationsForPrompt(pr, orderedAnnotations(draft.annotations));
    assert.ok(prompt.includes('Pull request #228: Add tabs'));
    assert.ok(prompt.includes('https://github.com/o/r/pull/228'));
    assert.ok(prompt.includes('1. src/foo.ts:42'));
    assert.ok(prompt.includes('`const x = 1`'));
    assert.ok(prompt.includes('why?'));
    assert.ok(prompt.includes('src/old.ts line 7 (removed side)'));
    assert.ok(!prompt.includes('src/old.ts:7'));
  });
});
