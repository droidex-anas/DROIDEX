import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { PrCheck, PrComment, PrCommit, PullRequest } from '../../../types/vcs';
import { PrSummary } from '../components/PrSummary';

const samplePr: PullRequest = {
  number: 1,
  title: 'Ship it',
  state: 'open',
  url: '',
  isDraft: false,
  headRefName: 'f',
  baseRefName: 'main',
  mergeable: null,
  reviewDecision: null,
  additions: 1,
  deletions: 0,
  changedFiles: 1,
  createdAt: null,
  updatedAt: null,
  author: 'ana',
  reviewRequests: [],
  reviews: [],
};

const noop = () => undefined;

function comment(overrides: Partial<PrComment>): PrComment {
  return {
    id: 'comment-1',
    kind: 'comment',
    author: 'reviewer',
    body: '',
    createdAt: '2026-08-04T10:01:00Z',
    url: null,
    state: null,
    reactions: [],
    ...overrides,
  };
}

function commit(oid: string, headline: string): PrCommit {
  return { oid, headline, committedDate: '2026-08-04T09:00:00Z', author: 'ana' };
}

function renderSummary(
  overrides: {
    pr?: PullRequest | null;
    body?: string;
    checks?: PrCheck[];
    comments?: PrComment[];
    commits?: PrCommit[];
    commentsError?: string | null;
    checksError?: string | null;
    metaError?: string | null;
  } = {},
): string {
  return renderToStaticMarkup(
    createElement(PrSummary, {
      pr: overrides.pr === undefined ? samplePr : overrides.pr,
      number: 1,
      body: overrides.body ?? '',
      loaded: true,
      loading: false,
      metaError: overrides.metaError ?? null,
      checks: overrides.checks ?? [],
      checksError: overrides.checksError ?? null,
      comments: overrides.comments ?? [],
      commentsError: overrides.commentsError ?? null,
      commits: overrides.commits ?? [],
      viewerLogin: 'ana',
      draft: '',
      posting: false,
      onDraftChange: noop,
      onSubmit: noop,
    }),
  );
}

test('renders review and inline comments as a GitHub-style conversation', () => {
  const html = renderSummary({
    comments: [
      comment({
        id: 'review-1',
        kind: 'review',
        author: 'octocat',
        body: 'Looks **solid**.',
        state: 'approved',
      }),
      comment({
        id: 'inline-1',
        kind: 'inline',
        author: 'dev',
        body: 'Please rename this.',
        state: 'commented',
        path: 'src/a.ts',
        line: 12,
      }),
    ],
  });
  assert.match(html, /octocat/);
  assert.match(html, /approved these changes/);
  assert.match(html, /commented on a file/);
  assert.match(html, /src\/a\.ts:12/);
  assert.match(html, /solid/);
  assert.match(html, /Please rename this\./);
  assert.match(html, /Leave a comment/);
});

test('all-fail first load surfaces checks and comments errors, not empty-state copy', () => {
  const html = renderSummary({
    metaError: 'Could not load pull request',
    checksError: 'Could not load PR checks',
    commentsError: 'Could not load PR comments',
  });
  assert.match(html, /Could not load PR checks/);
  assert.match(html, /Could not load PR comments/);
  assert.doesNotMatch(html, /No checks reported/);
  assert.doesNotMatch(html, /No comments yet/);
});

test('PR comments expose reactions next to the composer', () => {
  const html = renderSummary({
    comments: [
      comment({
        body: 'Looks good to me',
        reactions: [
          { content: 'THUMBS_UP', count: 3 },
          { content: 'EYES', count: 1 },
        ],
      }),
    ],
  });
  assert.match(html, /Looks good to me/);
  assert.match(html, /👍/);
  assert.match(html, /👀/);
  assert.match(html, />3</);
});

test('partial comment failures stay visible beside successfully loaded comments', () => {
  const html = renderSummary({
    comments: [comment({ body: 'Loaded comment' })],
    commentsError: 'Some PR comments could not be loaded',
  });
  assert.match(html, /Some PR comments could not be loaded/);
  assert.match(html, /Loaded comment/);
});

test('a resolved inline comment folds behind its status and preview', () => {
  const html = renderSummary({
    comments: [
      comment({
        id: 'inline-1',
        kind: 'inline',
        author: 'dev',
        body: '## Naming\n\nPlease rename this helper.',
        state: 'commented',
        path: 'src/a.ts',
        line: 12,
        resolved: true,
        outdated: false,
        resolvedBy: 'ana',
      }),
    ],
  });
  assert.match(html, /Resolved by ana/);
  assert.match(html, /Expand comment/);
  // The preview stands in for the body until the card opens.
  assert.match(html, /a\.ts:12 · Naming/);
  assert.doesNotMatch(html, /Please rename this helper\./);
});

test('the header states the rolled-up check state and the merge status', () => {
  const check = (name: string, bucket: PrCheck['bucket']): PrCheck => ({
    name,
    workflow: 'ci',
    bucket,
    state: bucket,
    description: '',
    link: null,
    startedAt: null,
    completedAt: null,
  });

  const passing = renderSummary({ checks: [check('build', 'pass'), check('lint', 'pass')] });
  assert.match(passing, /2\/2 passed/);
  assert.match(passing, /Ready for review/);

  const failing = renderSummary({ checks: [check('build', 'fail'), check('lint', 'pass')] });
  assert.match(failing, /1 failing/);

  assert.match(renderSummary(), /No checks reported/);
  // A failed load must not read as a pull request without checks.
  const failed = renderSummary({ checksError: 'Could not load PR checks' });
  assert.match(failed, /Unavailable/);
  assert.doesNotMatch(failed, /No checks reported/);
});

test('a bot review shows its findings and hides the agent prompt behind a disclosure', () => {
  const html = renderSummary({
    comments: [
      comment({
        author: 'cubic-dev-ai[bot]',
        body: `<!-- cubic:review-summary:start -->
**1 issue found** across 4 files
<!-- cubic:review-summary:end -->
<details><summary>Prompt for AI agents</summary>

\`\`\`text
<file name="src/App.tsx">Fix it.</file>
\`\`\`
</details>`,
      }),
    ],
  });
  assert.match(html, /1 issue found/);
  assert.match(html, /Prompt for AI agents/);
  assert.doesNotMatch(html, /cubic:review-summary|&lt;details|&lt;summary/);
});

test('pushed commits fold into one group, while a single commit shows outright', () => {
  const folded = renderSummary({
    commits: [commit('aaaaaaaaaaaaaaaa', 'Add the inbox'), commit('bbbbbbbbbbbbbbbb', 'Polish')],
  });
  assert.match(folded, /2 commits/);
  assert.doesNotMatch(folded, /Add the inbox/);
  assert.doesNotMatch(folded, /No comments yet/);

  const single = renderSummary({ commits: [commit('cccccccdddddddd', 'Fix the merge gate')] });
  assert.match(single, /1 commit/);
  assert.match(single, /Fix the merge gate/);
  assert.match(single, /ccccccc/);
});

test('a refresh failure is reported next to the description it could not update', () => {
  const html = renderSummary({
    body: 'Ships the inbox.',
    metaError: 'Could not load pull request',
  });
  assert.match(html, /Ships the inbox\./);
  assert.match(html, /Could not load pull request/);
});

test('a just-posted comment reads "now" without an "ago" suffix', () => {
  const now = new Date().toISOString();
  const html = renderSummary({
    pr: { ...samplePr, updatedAt: now },
    comments: [comment({ body: 'Ship it', createdAt: now })],
  });
  assert.match(html, /updated now/);
  assert.doesNotMatch(html, /now ago/);
});

test('the loading header states the pull request number once', () => {
  const html = renderSummary({ pr: null });
  assert.match(html, /Pull request #1/);
  assert.equal((html.match(/#1/g) ?? []).length, 1);
});
