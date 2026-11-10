import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  commitStyles,
  commitText,
  editDraft,
  followRevision,
  previewStyle,
  previewText,
  revertStyle,
  revertText,
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
  line: 2,
  tagName: 'section',
  component: 'Card',
  editability: 'literal',
};

function committed(entries: [property: string, value: string][], mutationId: string) {
  let draft = editDraft('canvas', element, site);
  for (const [property, value] of entries) draft = previewStyle(draft, property, value);
  const commit = commitStyles(draft, mutationId);
  assert.ok(commit);
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
    variantOf: null,
    seededRevisionId: null,
    hidden: false,
    build: { ...build, generation: 2 },
  };
}

function ready(revisionId: string, elements: SourceElement[]): CanvasBuildOutcome {
  return { status: 'ready', revisionId, artifactId: `a_${revisionId}`, elements, diagnostics: [] };
}

test('a commit sends every previewed property as one style edit', () => {
  const { draft, input } = committed(
    [
      ['fontSize', '28px'],
      ['color', '#fff'],
    ],
    'm-both',
  );
  assert.deepEqual(input, {
    mutationId: 'm-both',
    edit: {
      element,
      change: {
        kind: 'style',
        styles: [
          { property: 'fontSize', value: '28px' },
          { property: 'color', value: '#fff' },
        ],
      },
    },
  });
  assert.deepEqual(draft.pending, { mutationId: 'm-both', change: 'style', revisionId: null });
});

test('a value is sent the way the grammar reads it: lowercase and single-spaced', () => {
  for (const [property, value, sent] of [
    ['backgroundColor', '  #FFF ', '#fff'],
    ['paddingTop', '0.5REM  ', '0.5rem'],
  ]) {
    const { input } = committed([[property, value]], 'm');
    assert.deepEqual(
      input.edit.change,
      { kind: 'style', styles: [{ property, value: sent }] },
      property,
    );
  }
});

test('every refusal drops the draft, and a reply for another mutation changes nothing', () => {
  const { draft } = committed([['gap', '4px']], 'm-gap');
  assert.equal(settleCommit(draft, 'm-other', { status: 'refused' }), draft);
  assert.equal(settleCommit(draft, 'm-gap', { status: 'refused' }), null);
  // The edit's own revision has not built yet: nothing can be committed against the old one.
  assert.deepEqual(settleCommit(draft, 'm-gap', { status: 'edited', revisionId: 'r2' }), {
    ...draft,
    pending: { mutationId: 'm-gap', change: 'style', revisionId: 'r2' },
  });
  assert.deepEqual(settleCommit(draft, 'm-gap', { status: 'edited', revisionId: 'r1' }), {
    ...draft,
    pending: null,
  });
});

test('one commit at a time, and only with a previewed whitelisted property', () => {
  const { draft } = committed([['gap', '4px']], 'm-gap');
  assert.equal(commitStyles(previewStyle(draft, 'width', '1px'), 'm-width'), null);
  const idle = editDraft('canvas', element, site);
  assert.equal(previewStyle(idle, 'backgroundImage', 'url(x)'), idle);
  assert.equal(commitStyles(idle, 'm-unset'), null);
  const reverted = revertStyle(previewStyle(idle, 'gap', '4px'), 'gap');
  assert.deepEqual(reverted.values, {});
  assert.equal(commitStyles(reverted, 'm-reverted'), null);
});

test('the selection follows its source site into the revision that built after it', () => {
  const draft: ElementEditDraft = committed([['gap', '4px']], 'm-gap').draft;
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
    pending: null,
  });
});

test('text commits apart from styles, and each keeps the other’s previews into its revision', () => {
  const idle = editDraft('canvas', element, site);
  assert.equal(commitText(idle, 'm-none'), null);
  assert.equal(revertText(previewText(idle, 'Hi')).text, null);
  const typed = previewStyle(previewText(idle, 'Welcome & bye'), 'gap', '4px');
  const text = commitText(typed, 'm-text');
  assert.ok(text);
  assert.deepEqual(text.input, {
    mutationId: 'm-text',
    edit: { element, change: { kind: 'text', value: 'Welcome & bye' } },
  });
  assert.equal(commitStyles(text.draft, 'm-gap'), null, 'one commit at a time');

  const built = frameAt('r2', ready('r2', [{ ...site, elementId: 'el_2' }]));
  const edited = { status: 'edited', revisionId: 'r2' } as const;
  const afterText = followRevision(settleCommit(text.draft, 'm-text', edited), built);
  assert.equal(afterText?.text, null);
  assert.deepEqual(afterText?.values, { gap: '4px' });
  const styles = commitStyles(typed, 'm-gap');
  assert.ok(styles);
  const afterStyles = followRevision(settleCommit(styles.draft, 'm-gap', edited), built);
  assert.equal(afterStyles?.text, 'Welcome & bye');
  assert.deepEqual(afterStyles?.values, {});
  // A revision this draft did not commit, the agent's or an undo, leaves no preview standing,
  // even while its own commit is still waiting for the reply that names its revision.
  for (const draft of [typed, styles.draft]) {
    const elsewhere = followRevision(draft, built);
    assert.equal(elsewhere?.text, null);
    assert.deepEqual(elsewhere?.values, {});
  }
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
