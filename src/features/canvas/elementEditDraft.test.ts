import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  afterRevision,
  commitStyle,
  editDraft,
  previewStyle,
  settleCommit,
  type ElementEditDraft,
} from './elementEditDraft';

const element = { designId: 'design', revisionId: 'r1', elementId: 'el_1', instancePath: '0' };

function committed(property: string, value: string, mutationId: string) {
  const draft = previewStyle(editDraft('canvas', element), property, value);
  const commit = commitStyle(draft, property, mutationId);
  assert.ok(commit, property);
  return commit;
}

test('a committed preview sends its property as the kind the whitelist names', () => {
  for (const [property, value, kind] of [
    ['paddingTop', '0.5rem', 'spacing'],
    ['width', '320px', 'size'],
    ['backgroundColor', '#fff', 'colour'],
    ['lineHeight', '1.4', 'typography'],
    ['alignItems', 'center', 'layout'],
    ['opacity', '0.5', 'opacity'],
  ]) {
    const { draft, input } = committed(property, value, `m-${property}`);
    assert.deepEqual(input, {
      mutationId: `m-${property}`,
      edit: { element, change: { kind, property, value } },
    });
    assert.equal(draft.pendingMutationId, `m-${property}`);
  }
});

test('every refusal drops the draft, and a reply for another mutation changes nothing', () => {
  const { draft } = committed('gap', '4px', 'm-gap');
  assert.equal(settleCommit(draft, 'm-other', 'refused'), draft);
  assert.equal(settleCommit(draft, 'm-gap', 'refused'), null);
  const edited = settleCommit(draft, 'm-gap', 'edited');
  assert.deepEqual(edited, { ...draft, pendingMutationId: null });
});

test('one commit at a time, and only for a previewed whitelisted property', () => {
  const { draft } = committed('gap', '4px', 'm-gap');
  assert.equal(commitStyle(previewStyle(draft, 'width', '1px'), 'width', 'm-width'), null);
  const idle = editDraft('canvas', element);
  assert.equal(previewStyle(idle, 'backgroundImage', 'url(x)'), idle);
  assert.equal(commitStyle(idle, 'gap', 'm-unset'), null);
});

test('a newer revision of the same design drops the draft; another design keeps it', () => {
  const draft: ElementEditDraft = previewStyle(editDraft('canvas', element), 'gap', '4px');
  assert.equal(afterRevision(draft, 'design', 'r1'), draft);
  assert.equal(afterRevision(draft, 'other', 'r9'), draft);
  assert.equal(afterRevision(draft, 'design', 'r2'), null);
  assert.equal(afterRevision(draft, 'design', null), null);
});
