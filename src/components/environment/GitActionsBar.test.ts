import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { GitActionsBar } from './GitActionsBar.js';
import { CreatePrSheet } from './CreatePrSheet.js';
import { canRenderPrSheet, reconcileGitActionSheet } from '../../lib/gitActionVisibility.js';
import type { GitEnvironment, PullRequest } from '../../types/vcs.js';

const env: GitEnvironment = {
  isRepo: true,
  isGitHub: true,
  branch: 'feature/setup-card',
  detached: false,
  ahead: 0,
};

const pr = (overrides: Partial<PullRequest> = {}): PullRequest => ({
  number: 7,
  title: 'Fix the thing',
  state: 'OPEN',
  url: 'https://example.com/pr/7',
  isDraft: false,
  headRefName: 'fix',
  baseRefName: 'main',
  mergeable: null,
  reviewDecision: null,
  additions: 0,
  deletions: 0,
  changedFiles: 0,
  ...overrides,
});

function render(
  overrides: Partial<Parameters<typeof GitActionsBar>[0]> = {},
  envOverrides: Partial<GitEnvironment> = {},
): string {
  return renderToStaticMarkup(
    createElement(GitActionsBar, {
      cwd: '/repo',
      env: { ...env, ...envOverrides },
      branches: null,
      isGitHub: true,
      githubReady: true,
      hasPr: false,
      pr: null,
      onOpenPr: () => undefined,
      onChanged: () => undefined,
      ...overrides,
    }),
  );
}

test('local git actions remain while Create pull request waits for GitHub setup', () => {
  const html = render({ githubReady: false });
  assert.match(html, />Commit or push</);
  assert.doesNotMatch(html, />Create pull request</);
  assert.match(render(), />Create pull request</);
});

test('a detected PR swaps into the create slot; a merged one leaves create available', () => {
  // The PR row replaces the create action in place, so the panel's height
  // does not change when detection resolves.
  const open = render({ hasPr: true, pr: pr() });
  assert.match(open, />#7 Fix the thing</);
  assert.doesNotMatch(open, />Create pull request</);

  // A merged PR is not open or draft, so the section reports no current PR
  // while the detection payload is still around.
  const merged = render({ pr: pr({ number: 212, title: 'Tool activity UI', state: 'MERGED' }) });
  assert.match(merged, />Create pull request</);
  assert.doesNotMatch(merged, /#212/);
});

test('the push pill appears only with commits to publish and somewhere to push them', () => {
  // The fixture branch has no upstream and no remotes, so a flat ahead=0 has
  // nothing to publish.
  assert.doesNotMatch(render({}, { ahead: 0 }), /aria-label="Push/);
  assert.match(render({}, { ahead: 2 }), /aria-label="Push 2 commits"/);
  assert.match(render({}, { ahead: 1 }), /aria-label="Push 1 commit"/);
  // Git reports ahead=0 until an upstream exists; the pill offers the push
  // that creates one, unless there is no remote to push to.
  assert.match(
    render({}, { upstream: null, remotes: ['origin'], ahead: 0 }),
    /aria-label="Push branch and set upstream"/,
  );
  assert.doesNotMatch(render({}, { upstream: null, remotes: [], ahead: 0 }), /aria-label="Push/);
});

test('the create-PR row exposes its disclosure state', () => {
  const html = render();
  const buttons = html.match(/<button[^>]*>.*?<\/button>/gs) ?? [];
  const prRow = buttons.find((button) => button.includes('Create pull request'));
  assert.ok(prRow?.includes('aria-expanded="false"'));
});

test('an open PR sheet closes when GitHub readiness is lost', () => {
  assert.equal(canRenderPrSheet('pr', true, true, false, false), true);
  assert.equal(canRenderPrSheet('pr', true, false, false, false), false);
  assert.equal(canRenderPrSheet('pr', false, true, false, false), false);
  assert.equal(canRenderPrSheet('pr', true, true, true, false), false);
  assert.equal(reconcileGitActionSheet('pr', true, false, false, false), 'none');
  assert.equal(reconcileGitActionSheet('commit', true, false, false, false), 'commit');
});

test('the PR form cannot target its own head when no other base exists', () => {
  const html = renderToStaticMarkup(
    createElement(CreatePrSheet, {
      cwd: '/repo',
      env: { ...env, branch: 'main', defaultBranch: 'main' },
      branches: null,
      onDone: () => undefined,
    }),
  );

  assert.match(html, /No base branch available/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>Open PR<\/button>/);
});
