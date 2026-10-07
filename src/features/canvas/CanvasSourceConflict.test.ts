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
