import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  commitPath,
  commitStyles,
  commitText,
  editDraft,
  followRevision,
  previewedStyles,
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
  for (const [property, value] of entries) draft = previewStyle(draft, property, value, '');
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
  assert.equal(commitStyles(previewStyle(draft, 'width', '1px', ''), 'm-width'), null);
  const idle = editDraft('canvas', element, site);
  assert.equal(previewStyle(idle, 'backgroundImage', 'url(x)', ''), idle);
  assert.equal(commitStyles(idle, 'm-unset'), null);
  const reverted = revertStyle(previewStyle(idle, 'gap', '4px', ''), 'gap');
  assert.deepEqual(reverted.values, {});
  assert.equal(commitStyles(reverted, 'm-reverted'), null);
});

test('a previewed blur keeps the rest of the filter the element drew, and None takes only the blur', () => {
  const idle = editDraft('canvas', element, site);
  const drawn = 'blur(4px) grayscale(1)';
  const md = previewStyle(idle, 'filter', 'blur(12px)', drawn);
  assert.equal(previewedStyles(md).filter, 'blur(12px) grayscale(1)');
  // The element now draws the preview, which the next pick must not build on.
  const soft = previewStyle(md, 'filter', '--ds-blur-soft', 'blur(12px) grayscale(1)');
  assert.equal(previewedStyles(soft).filter, 'blur(var(--ds-blur-soft)) grayscale(1)');
  assert.equal(previewedStyles(previewStyle(idle, 'filter', 'none', drawn)).filter, 'grayscale(1)');
  assert.equal(previewedStyles(previewStyle(idle, 'filter', 'none', 'blur(4px)')).filter, 'none');
  // Filter functions apply in order, so the blur keeps its place among them.
  const dimmed = 'brightness(0.5) blur(4px) contrast(1.2)';
  assert.equal(
    previewedStyles(previewStyle(idle, 'filter', 'blur(12px)', dimmed)).filter,
    'brightness(0.5) blur(12px) contrast(1.2)',
  );
  assert.equal(
    previewedStyles(previewStyle(idle, 'filter', 'none', dimmed)).filter,
    'brightness(0.5) contrast(1.2)',
  );
  assert.equal(
    previewedStyles(previewStyle(idle, 'filter', 'blur(8px)', 'grayscale(1)')).filter,
    'blur(8px) grayscale(1)',
  );
  // Two blurs read as raw, so a pick previews nothing over them.
  const twice = 'blur(4px) blur(2px)';
  assert.equal(previewedStyles(previewStyle(idle, 'filter', 'blur(12px)', twice)).filter, twice);
  const backdrop = previewStyle(idle, 'backdropFilter', 'blur(8px)', 'none');
  assert.equal(previewedStyles(backdrop).backdropFilter, 'blur(8px)');
  const shadows = previewStyle(idle, 'boxShadow', '--ds-shadow-sm, --ds-shadow-md', 'none');
  assert.equal(previewedStyles(shadows).boxShadow, 'var(--ds-shadow-sm), var(--ds-shadow-md)');
  // Taken back, the next preview starts from what the element draws then.
  assert.deepEqual(revertStyle(md, 'filter').drawn, {});
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
    drawn: {},
    pending: null,
  });
});

test('text, styles and a path commit apart, and each keeps the others’ previews into its revision', () => {
  const idle = editDraft('canvas', element, site);
  assert.equal(commitText(idle, 'm-none'), null);
  assert.equal(revertText(previewText(idle, 'Hi')).text, null);
  const typed = previewStyle(previewText(idle, 'Welcome & bye'), 'gap', '4px', '');
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
  // A path's commit keeps both, and drops only the data it previewed while it saved.
  const path = commitPath(typed, 'm-path', 'M0 0 L1 1');
  assert.ok(path);
  const afterPath = followRevision(settleCommit(path.draft, 'm-path', edited), built);
  assert.equal(afterPath?.text, 'Welcome & bye');
  assert.deepEqual(afterPath?.values, { gap: '4px' });
  assert.equal(afterPath?.d, null);
  // A revision this draft did not commit, the agent's or an undo, leaves no preview standing,
  // even while its own commit is still waiting for the reply that names its revision.
  for (const draft of [typed, styles.draft]) {
    const elsewhere = followRevision(draft, built);
    assert.equal(elsewhere?.text, null);
    assert.deepEqual(elsewhere?.values, {});
  }
});

test('a newer revision without the site, or one that did not build, drops the selection', () => {
  const draft = previewStyle(editDraft('canvas', element, site), 'gap', '4px', '');
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
