import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConflictBar, ConflictCompare } from './CanvasSourceConflict';

const ENTRY = 'App.tsx';

test('the conflict bar offers comparison alongside the two resolutions', () => {
  const markup = renderToStaticMarkup(
    createElement(ConflictBar, {
      comparing: false,
      onCompare: () => undefined,
      onKeepMine: () => undefined,
      onTakeTheirs: () => undefined,
    }),
  );
  // Spec §4 asks for comparison as well as reapply: a user cannot choose between
  // two versions they have only been told about.
  assert.match(markup, /Compare/);
  assert.match(markup, /Keep mine/);
  assert.match(markup, /Take theirs/);
});

test('the comparison shows the agent’s own text, named by its revision', () => {
  const markup = renderToStaticMarkup(
    createElement(ConflictCompare, {
      path: ENTRY,
      revisionId: 'rev_2',
      text: 'by the agent\n',
      issues: new Map(),
    }),
  );
  assert.match(markup, /by the agent/);
  assert.match(markup, /rev_2/);
  // Read-only: the competing version is for inspecting, never for typing into.
  assert.equal(markup.includes('<textarea'), false);

  // With no textarea over it, this text is what the user has to read to choose,
  // so it stays in the accessibility tree and the region holding it is named and
  // reachable by keyboard. Hiding it leaves only the caption to decide from.
  assert.doesNotMatch(markup, /<pre[^>]*aria-hidden="true"/);
  const region = /<div[^>]*role="region"[^>]*>/.exec(markup)?.[0] ?? '';
  assert.match(region, /aria-label="App\.tsx competing source"/);
  assert.match(region, /tabindex="0"/);
});

test('a revision that deleted the file says so instead of showing nothing', () => {
  const markup = renderToStaticMarkup(
    createElement(ConflictCompare, {
      path: ENTRY,
      revisionId: 'rev_2',
      text: null,
      issues: new Map(),
    }),
  );
  assert.match(markup, /deleted this file/);
});
