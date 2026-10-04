import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { GitWorktree } from '../types/vcs.js';
import { WorktreeRemovalDialogContent } from './WorktreeRemovalDialog.js';

const WORKTREE: GitWorktree = {
  path: '/repo/.worktrees/feature',
  head: 'abc123',
  branch: 'feature',
  bare: false,
  detached: false,
  locked: false,
  isMain: false,
  isCurrent: false,
};

function renderDialog({
  changedFileCount = 0,
  linkedSessionCount = 0,
  isMerged = false,
  isChecking = false,
} = {}): string {
  return renderToStaticMarkup(
    createElement(WorktreeRemovalDialogContent, {
      worktree: WORKTREE,
      changedFileCount,
      linkedSessionCount,
      isMerged,
      isChecking,
      isRemoving: false,
      onCancel: () => undefined,
      onConfirm: () => undefined,
    }),
  );
}

test('dialog opens in a responsive checking state', () => {
  const html = renderDialog({ isChecking: true });
  assert.match(html, /Checking for unsaved changes/);
  assert.match(html, />Checking…</);
  assert.match(html, /disabled=""/);
});

test('only a dirty worktree warns that removal discards its changes', () => {
  const dirty = renderDialog({ changedFileCount: 3 });
  assert.match(dirty, /role="alertdialog"/);
  assert.match(dirty, /3 changed files will be permanently discarded/);
  assert.match(dirty, /This action cannot be undone/);
  assert.match(dirty, />Delete anyway</);

  const clean = renderDialog();
  assert.match(clean, /role="dialog"/);
  assert.match(clean, />Delete worktree</);
  assert.doesNotMatch(clean, /permanently discarded/);
});

test('dialog explains conversation and branch outcomes', () => {
  const html = renderDialog({ linkedSessionCount: 2, isMerged: true });
  assert.match(html, /2 idle conversations will move to the main checkout/);
  assert.match(html, /Git will also delete the merged local branch/);
});
