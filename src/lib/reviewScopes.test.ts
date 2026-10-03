import test from 'node:test';
import assert from 'node:assert';
import { diffModeToReviewScope, matchReviewFocusPath, nextReviewFocusScope } from './reviewScopes';

test('diffModeToReviewScope maps a summary mode to the matching review scope', () => {
  // Each summary mode has an exactly-corresponding review scope.
  assert.equal(diffModeToReviewScope('branch'), 'branch');
  assert.equal(diffModeToReviewScope('worktree'), 'worktree');
  // 'uncommitted' must include staged files, so it maps to its own scope.
  assert.equal(diffModeToReviewScope('uncommitted'), 'uncommitted');
});

test('nextReviewFocusScope walks current changes through branch history and stops off-chain', () => {
  assert.equal(nextReviewFocusScope('last_turn'), 'uncommitted');
  assert.equal(nextReviewFocusScope('uncommitted'), 'worktree');
  assert.equal(nextReviewFocusScope('worktree'), 'branch');
  assert.equal(nextReviewFocusScope('branch'), 'commit');
  assert.equal(nextReviewFocusScope('commit'), null);
  // A focus request always starts at 'last_turn'; any other current scope
  // means the user navigated away mid-flight, so the chain must not resume.
  assert.equal(nextReviewFocusScope('staged'), null);
  assert.equal(nextReviewFocusScope('unstaged'), null);
});

test('matchReviewFocusPath maps a transcript path to the changed git path', () => {
  const app = ['src/app.ts'];
  // [why, git paths, transcript path, session cwd, expected match]
  const cases: Array<[string, string[], string, string | undefined, string | null]> = [
    [
      'exact repo-relative path',
      ['src/app.ts', 'README.md'],
      'src/app.ts',
      undefined,
      'src/app.ts',
    ],
    ['exact repo-relative path', ['src/app.ts', 'README.md'], 'README.md', undefined, 'README.md'],
    ['absolute path under the repo', app, '/Users/dev/repo/src/app.ts', undefined, 'src/app.ts'],
    ['Windows separators are normalized', app, 'C:\\repo\\src\\app.ts', undefined, 'src/app.ts'],
    [
      'absolute path outside the session repo',
      app,
      '/elsewhere/repo/src/app.ts',
      '/Users/dev/repo',
      null,
    ],
    [
      'absolute path above a cwd subdirectory',
      app,
      '/Users/dev/repo/src/app.ts',
      '/Users/dev/repo/packages/web',
      'src/app.ts',
    ],
    ['repo at a POSIX filesystem root', app, '/src/app.ts', '/', 'src/app.ts'],
    ['repo at a drive root', app, 'C:/src/app.ts', 'C:/', 'src/app.ts'],
    ['repo at a drive root, cwd below it', app, 'C:/src/app.ts', 'C:/packages/web', 'src/app.ts'],
    // The session cwd is apps/web, so the transcript reports src/app.ts while
    // git reports the repo-root-relative path.
    [
      'cwd-relative path in a subdirectory',
      ['apps/web/src/app.ts'],
      'src/app.ts',
      undefined,
      'apps/web/src/app.ts',
    ],
    [
      'dot-prefixed cwd-relative path',
      ['apps/web/src/app.ts'],
      './src/app.ts',
      undefined,
      'apps/web/src/app.ts',
    ],
    [
      'exact match beats an earlier suffix match',
      ['packages/a/src/app.ts', 'src/app.ts'],
      'src/app.ts',
      undefined,
      'src/app.ts',
    ],
    // Edit tools resolve 'src/app.ts' in the session cwd, not in the
    // alphabetically first package or at the repo root.
    [
      'cwd resolution beats the first package',
      ['packages/api/src/app.ts', 'packages/web/src/app.ts'],
      'src/app.ts',
      '/repo/packages/web',
      'packages/web/src/app.ts',
    ],
    [
      'cwd resolution beats a root-level exact match',
      ['packages/web/src/app.ts', 'src/app.ts'],
      'src/app.ts',
      '/repo/packages/web',
      'packages/web/src/app.ts',
    ],
    // Both git paths suffix-match; the longer one pins the repo root at /repo.
    [
      'longest suffix wins for absolute paths',
      ['web/src/app.ts', 'packages/web/src/app.ts'],
      '/repo/packages/web/src/app.ts',
      undefined,
      'packages/web/src/app.ts',
    ],
    // Without canonicalizing '..', the suffix match never lands and the click
    // ends in the no-diff toast.
    [
      'dot segments are canonicalized',
      ['packages/shared/foo.ts'],
      '../shared/foo.ts',
      '/repo/packages/web',
      'packages/shared/foo.ts',
    ],
    ['unrelated relative path', app, 'src/other.ts', undefined, null],
    ['near-miss absolute path', app, '/elsewhere/repo/src/app.tsx', undefined, null],
    ['no changed files', [], 'src/app.ts', undefined, null],
    ['empty transcript path', app, '', undefined, null],
  ];
  for (const [why, paths, path, cwd, expected] of cases) {
    const files = paths.map((filePath) => ({ path: filePath }));
    assert.equal(matchReviewFocusPath(files, path, cwd), expected, why);
  }
});
