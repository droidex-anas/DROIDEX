import { createIcon } from './Icon.js';

// Stroked node circles joined by rails with one soft elbow, Codex style.
export const GitBranch = createIcon(
  'git-branch',
  <>
    <circle cx="6.5" cy="5.5" r="2.5" />
    <circle cx="6.5" cy="17" r="2.5" />
    <circle cx="17.5" cy="6.5" r="2.5" />
    <path d="M6.5 8v6.5" />
    <path d="M17.5 9v3a5 5 0 0 1-5 5H9" />
  </>,
);

export const GitCommit = createIcon(
  'git-commit',
  <>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M3.5 12h5.3" />
    <path d="M15.2 12h5.3" />
  </>,
);

// Pull request family: a shared source rail on the left, state on the right.
// Status glyphs tint their state node; navigation and action glyphs stay outline.
const SOURCE_RAIL = (
  <>
    <circle cx="6.5" cy="5.5" r="2.5" />
    <circle cx="6.5" cy="18.5" r="2.5" />
    <path d="M6.5 8v8" />
  </>
);
const TINT = { fill: 'currentColor', fillOpacity: 0.3 };
const BODY_TINT = { fill: 'currentColor', fillOpacity: 0.12 };

export const GitPullRequest = createIcon(
  'git-pull-request',
  <>
    {SOURCE_RAIL}
    <circle cx="17.5" cy="18.5" r="2.5" />
    <path d="M17.5 16v-6a4.5 4.5 0 0 0-4.5-4.5h-1" />
    <path d="m14.25 3-2.5 2.5 2.5 2.5" />
  </>,
);

export const GitPullRequestDraft = createIcon(
  'git-pull-request-draft',
  <>
    {SOURCE_RAIL}
    <circle cx="17.5" cy="18.5" r="2.5" {...TINT} />
    <circle cx="17.5" cy="12" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="17.5" cy="6.5" r="0.9" fill="currentColor" stroke="none" />
  </>,
);

export const GitPullRequestMerged = createIcon(
  'git-pull-request-merged',
  <>
    {SOURCE_RAIL}
    <circle cx="17.5" cy="15" r="2.5" {...TINT} />
    <path d="M6.5 8a7 7 0 0 0 7 7h1.5" />
  </>,
);

export const GitPullRequestClosed = createIcon(
  'git-pull-request-closed',
  <>
    {SOURCE_RAIL}
    <circle cx="17.5" cy="18.5" r="2.5" {...TINT} />
    <path d="M17.5 16v-4.5" />
    <path d="m15.5 4.5 4 4m0-4-4 4" />
  </>,
);

export const GitPullRequestCreate = createIcon(
  'git-pull-request-create',
  <>
    {SOURCE_RAIL}
    <path d="M17.5 14.5V10a4.5 4.5 0 0 0-4.5-4.5h-1" />
    <path d="m14.25 3-2.5 2.5 2.5 2.5" />
    <path d="M17.5 17v4.5m-2.25-2.25h4.5" />
  </>,
);

export const GitFork = createIcon(
  'git-fork',
  <>
    <circle cx="6.5" cy="5.5" r="2.5" />
    <circle cx="17.5" cy="5.5" r="2.5" />
    <circle cx="12" cy="18.5" r="2.5" />
    <path d="M6.5 8v1a3.5 3.5 0 0 0 3.5 3.5h4A3.5 3.5 0 0 0 17.5 9V8" />
    <path d="M12 12.5V16" />
  </>,
);

export const Issue = createIcon(
  'issue',
  <>
    <circle cx="12" cy="12" r="8.5" {...BODY_TINT} />
    <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
  </>,
);

export const IssueClosed = createIcon(
  'issue-closed',
  <>
    <circle cx="12" cy="12" r="8.5" {...BODY_TINT} />
    <path d="m8.75 12.25 2.25 2.25 4.25-4.5" />
  </>,
);

export const CodeReview = createIcon(
  'code-review',
  <>
    <path d="M8 17.5h-.5a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4h9a4 4 0 0 1 4 4v5.5a4 4 0 0 1-4 4h-4L8 21Z" />
    <path d="m10 8.5-2.25 2.25L10 13m4-4.5 2.25 2.25L14 13" />
  </>,
);

export const Repository = createIcon(
  'repository',
  <>
    <path d="M5 18.5V6.5a3 3 0 0 1 3-3h10.5v13" />
    <path d="M18.5 16.5H7.25a2.25 2.25 0 0 0 0 4.5H18.5" />
    <path d="M9.5 8h4.5" />
  </>,
);

export const GitCompareArrows = createIcon(
  'git-compare-arrows',
  <>
    <circle cx="6" cy="18" r="2.4" />
    <circle cx="18" cy="6" r="2.4" />
    <path d="M6 15.6V9a3.5 3.5 0 0 1 3.5-3.5H14" />
    <path d="m11.5 3 2.5 2.5-2.5 2.5" />
    <path d="M18 8.4V15a3.5 3.5 0 0 1-3.5 3.5H10" />
    <path d="m12.5 21-2.5-2.5 2.5-2.5" />
  </>,
);
