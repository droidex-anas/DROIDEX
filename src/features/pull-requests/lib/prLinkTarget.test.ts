import assert from 'node:assert/strict';
import test from 'node:test';

import {
  gitHubRemoteRepoKey,
  parsePullRequestLink,
  resolvePullRequestPaneTarget,
} from './prLinkTarget';

test('parsePullRequestLink reads the owner, repository, and number', () => {
  assert.deepEqual(parsePullRequestLink('https://github.com/owner/repo/pull/42'), {
    repoKey: 'owner/repo',
    number: 42,
  });
  // Deeper paths and anchors still name the same pull request.
  assert.equal(
    parsePullRequestLink('https://github.com/owner/repo/pull/42/files#diff-1')?.number,
    42,
  );
  // Owner and repository case-fold so the remote comparison is stable.
  assert.equal(parsePullRequestLink('https://github.com/Owner/Repo/pull/7')?.repoKey, 'owner/repo');
});

test('parsePullRequestLink rejects non-pull links and other hosts', () => {
  assert.equal(parsePullRequestLink('https://github.com/owner/repo/issues/42'), null);
  assert.equal(parsePullRequestLink('https://github.com/owner/repo'), null);
  assert.equal(parsePullRequestLink('https://gitlab.com/owner/repo/pull/42'), null);
  assert.equal(parsePullRequestLink('https://github.com/owner/repo/pull/abc'), null);
  assert.equal(parsePullRequestLink('not a url'), null);
});

test('gitHubRemoteRepoKey reads the ssh and https remote forms', () => {
  assert.equal(gitHubRemoteRepoKey('git@github.com:owner/repo.git'), 'owner/repo');
  assert.equal(gitHubRemoteRepoKey('git@github.com:owner/repo'), 'owner/repo');
  assert.equal(gitHubRemoteRepoKey('https://github.com/owner/repo.git'), 'owner/repo');
  assert.equal(gitHubRemoteRepoKey('https://github.com/owner/repo'), 'owner/repo');
  assert.equal(gitHubRemoteRepoKey('ssh://git@github.com/owner/repo.git'), 'owner/repo');
  assert.equal(gitHubRemoteRepoKey('https://gitlab.com/owner/repo.git'), null);
  assert.equal(gitHubRemoteRepoKey(null), null);
  assert.equal(gitHubRemoteRepoKey(''), null);
});

test('resolvePullRequestPaneTarget matches the link against the chat repository', () => {
  assert.deepEqual(
    resolvePullRequestPaneTarget(
      'https://github.com/owner/repo/pull/42',
      '/workspace/app',
      'git@github.com:owner/repo.git',
    ),
    { cwd: '/workspace/app', number: 42 },
  );
  // A pull request of another repository cannot open in this checkout's pane.
  assert.equal(
    resolvePullRequestPaneTarget(
      'https://github.com/other/repo/pull/42',
      '/workspace/app',
      'git@github.com:owner/repo.git',
    ),
    null,
  );
  // Without a loaded remote there is nothing to match against.
  assert.equal(
    resolvePullRequestPaneTarget('https://github.com/owner/repo/pull/42', '/workspace/app', null),
    null,
  );
  assert.equal(
    resolvePullRequestPaneTarget(
      'https://github.com/owner/repo/pull/42',
      null,
      'git@github.com:owner/repo.git',
    ),
    null,
  );
});
