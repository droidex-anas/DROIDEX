import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  commitStyle,
  editDraft,
  followRevision,
  previewStyle,
  revertStyle,
  settleCommit,
  type ElementEditDraft,
} from './elementEditDraft';
import type { CanvasBuildOutcome, CanvasFrame, SourceElement } from './protocol';

const element = { designId: 'design', revisionId: 'r1', elementId: 'el_1', instancePath: '0' };
const site: SourceElement = {
  elementId: 'el_1',
  file: 'main.tsx',
  start: 40,
  end: 90,
  tagName: 'section',
  editability: 'literal',
};

function committed(property: string, value: string, mutationId: string) {
  const draft = previewStyle(editDraft('canvas', element, site), property, value);
  const commit = commitStyle(draft, property, mutationId);
  assert.ok(commit, property);
  return commit;
}

function frameAt(revisionId: string, build: CanvasBuildOutcome, designId = 'design'): CanvasFrame {
  return {
    designId,
    name: 'Design',
    rect: { x: 0, y: 0, width: 400, height: 300 },
    layoutVersion: 1,
    manifestVersion: 1,
    revisionId,
    designSystem: { id: 'droidex', version: 2, mode: 'dark' },
    build: { ...build, generation: 2 },
  };
}

function ready(revisionId: string, elements: SourceElement[]): CanvasBuildOutcome {
  return { status: 'ready', revisionId, artifactId: `a_${revisionId}`, elements, diagnostics: [] };
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
  const idle = editDraft('canvas', element, site);
  assert.equal(previewStyle(idle, 'backgroundImage', 'url(x)'), idle);
  assert.equal(commitStyle(idle, 'gap', 'm-unset'), null);
  const reverted = revertStyle(previewStyle(idle, 'gap', '4px'), 'gap');
  assert.deepEqual(reverted.values, {});
  assert.equal(commitStyle(reverted, 'gap', 'm-reverted'), null);
});

test('the selection follows its source site into the revision that built after it', () => {
  const draft: ElementEditDraft = committed('gap', '4px', 'm-gap').draft;
  const moved = { ...site, elementId: 'el_9', end: 104 };

  // Still building: the older revision is on show, and the draft stays on it.
  assert.equal(
    followRevision(draft, frameAt('r2', { status: 'building', revisionId: 'r2' })),
    draft,
  );
  assert.equal(followRevision(draft, frameAt('r9', ready('r9', []), 'other')), draft);

  assert.deepEqual(followRevision(draft, frameAt('r2', ready('r2', [moved]))), {
    ...draft,
    element: { ...element, revisionId: 'r2', elementId: 'el_9' },
    site: moved,
    values: {},
    pendingMutationId: null,
  });
});

test('a newer revision without the site, or one that did not build, drops the selection', () => {
  const draft = previewStyle(editDraft('canvas', element, site), 'gap', '4px');
  const shifted = { ...site, elementId: 'el_9', start: 52 };

  assert.equal(followRevision(draft, frameAt('r2', ready('r2', [shifted]))), null);
  assert.equal(
    followRevision(draft, frameAt('r2', ready('r2', [{ ...site, tagName: 'div' }]))),
    null,
  );
  assert.equal(
    followRevision(
      draft,
      frameAt('r2', {
        status: 'failed',
        revisionId: 'r2',
        diagnostics: [],
        lastWorkingRevisionId: 'r1',
      }),
    ),
    null,
  );
});
