const test = require('node:test');
const assert = require('node:assert');
const { execFile, execFileSync } = require('node:child_process');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { branches, validBranchName } = require('./gitBranches.cjs');
const {
  adoptTurnBaseline,
  diffFiles,
  fileDiff,
  markTurnStart,
  workingTreeDiff,
} = require('./gitDiff.cjs');
const { matchRemote } = require('./gitEnvironment.cjs');
const { isWithin, repoStatus } = require('./gitRepository.cjs');
const {
  allowedWorktreeTarget,
  createWorktree,
  removeWorktree,
  sanitizeSegment,
  worktrees,
} = require('./gitWorktrees.cjs');

// Integration tests for the last_turn review scope, driven through the Git
// modules against real scratch repositories. Each scenario gets its own
// repo: the untracked-file scan is TTL-cached per repo root, so reusing one
// repo across scenarios could serve a stale scan.

const repos = [];

function git(dir, args) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: dir }, (err, stdout) => {
      if (err) reject(err);
      else resolve(String(stdout));
    });
  });
}

async function makeRepo() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'droid-git-test-'));
  repos.push(dir);
  await git(dir, ['init', '-q']);
  await git(dir, ['config', 'user.email', 'test@example.com']);
  await git(dir, ['config', 'user.name', 'Test']);
  await git(dir, ['config', 'commit.gpgsign', 'false']);
  return dir;
}

async function write(dir, rel, content) {
  await fsp.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
  await fsp.writeFile(path.join(dir, rel), content);
}

async function commitAll(dir, message) {
  await git(dir, ['add', '.']);
  await git(dir, ['commit', '-qm', message]);
}

const pathsOf = (res) => res.files.map((f) => f.path);

test.after(async () => {
  await Promise.all(repos.map((dir) => fsp.rm(dir, { recursive: true, force: true })));
});

test('review preserves untracked paths that Git quotes', async () => {
  const dir = await makeRepo();
  await git(dir, ['commit', '--allow-empty', '-qm', 'init']);
  await git(dir, ['config', 'core.quotePath', 'true']);
  const names = ['café.ts', 'with\ttab.ts', 'plain.ts', 'with space.ts'];
  for (const name of names) await write(dir, name, 'first\nsecond\n');

  const review = await diffFiles(dir, { mode: 'uncommitted' });
  assert.deepEqual(new Set(pathsOf(review)), new Set(names));
  for (const file of review.files) {
    assert.equal(file.additions, 2, file.path);
    const patch = await fileDiff(dir, { mode: 'uncommitted', path: file.path });
    assert.match(patch.diff, /\+first\n\+second/);
  }
});

test('fileDiff treats tracked filenames as literal pathspecs', async () => {
  const dir = await makeRepo();
  const names = ['star*.txt', 'star-other.txt', 'plain.txt'];
  for (const name of names) await write(dir, name, 'before\n');
  await commitAll(dir, 'init');
  for (const name of names) await write(dir, name, 'after\n');

  for (const name of names) {
    const patch = await fileDiff(dir, { mode: 'uncommitted', path: name });
    assert.deepEqual(patch.diff.match(/^diff --git .*$/gm), [`diff --git a/${name} b/${name}`]);
    assert.match(patch.diff, /\+after/);
  }
  await write(dir, 'star*.txt', 'before \n');
  const empty = await fileDiff(dir, {
    mode: 'uncommitted',
    path: 'star*.txt',
    ignoreWhitespace: true,
  });
  assert.equal(empty.diff, '');
});

test('fileDiff treats both rename paths as literal pathspecs', async () => {
  const dir = await makeRepo();
  for (const name of ['old*.txt', 'old-other.txt', 'new-other.txt']) {
    await write(dir, name, 'rename me\n');
  }
  await commitAll(dir, 'init');
  await git(dir, ['mv', 'old*.txt', 'new*.txt']);
  for (const name of ['old-other.txt', 'new-other.txt']) await write(dir, name, 'changed\n');

  const review = await diffFiles(dir, { mode: 'uncommitted' });
  const renamed = review.files.find((file) => file.path === 'new*.txt');
  assert.equal(renamed?.oldPath, 'old*.txt');
  const patch = await fileDiff(dir, { mode: 'uncommitted', ...renamed });
  assert.deepEqual(patch.diff.match(/^diff --git .*$/gm), ['diff --git a/old*.txt b/new*.txt']);
  assert.match(patch.diff, /^rename from old\*\.txt$/m);
  assert.match(patch.diff, /^rename to new\*\.txt$/m);
});

test('fileDiff does not mistake an untracked glob filename for a tracked match', async () => {
  const dir = await makeRepo();
  await write(dir, 'star-other.txt', 'tracked\n');
  await commitAll(dir, 'init');
  await write(dir, 'star*.txt', 'untracked\n');

  const patch = await fileDiff(dir, { mode: 'uncommitted', path: 'star*.txt' });
  assert.deepEqual(patch.diff.match(/^diff --git .*$/gm), ['diff --git a/star*.txt b/star*.txt']);
  assert.match(patch.diff, /\+untracked/);
});

test('last_turn includes edited quoted untracked paths but excludes unchanged files', async () => {
  const dir = await makeRepo();
  await write(dir, 'seed.txt', 'seed\n');
  await commitAll(dir, 'init');
  await git(dir, ['config', 'core.quotePath', 'true']);
  for (const name of ['café.ts', 'with\ttab.ts', 'plain.ts', 'with space.ts']) {
    await write(dir, name, 'before\n');
  }
  assert.equal((await markTurnStart(dir, 'quoted-session')).ok, true);
  for (const name of ['café.ts', 'with\ttab.ts']) await write(dir, name, 'after\nextra\n');
  const review = await diffFiles(dir, { mode: 'last_turn', appSessionId: 'quoted-session' });
  assert.deepEqual(new Set(pathsOf(review)), new Set(['café.ts', 'with\ttab.ts']));
});

test('workingTreeDiff exports a quoted untracked file as the only change', async () => {
  const dir = await makeRepo();
  await write(dir, 'seed.txt', 'seed\n');
  await commitAll(dir, 'init');
  await git(dir, ['config', 'core.quotePath', 'true']);
  assert.equal(await workingTreeDiff(dir), '');
  await write(dir, 'café.ts', 'first\nsecond\n');
  assert.match(await workingTreeDiff(dir), /\+first\n\+second/);
});

test('last_turn with a baseline lists the turn changes and hides preexisting untracked files', async () => {
  const dir = await makeRepo();
  await write(dir, 'tracked.txt', 'v1\n');
  await commitAll(dir, 'init');
  // Untracked before the turn begins: must not be attributed to the turn.
  await write(dir, 'notes.txt', 'preexisting\n');

  const mark = await markTurnStart(dir, 'session-a');
  assert.equal(mark.ok, true);

  await write(dir, 'tracked.txt', 'v2\n');
  await write(dir, 'new.txt', 'created this turn\n');

  const res = await diffFiles(dir, { mode: 'last_turn', appSessionId: 'session-a' });
  const paths = pathsOf(res);
  assert.ok(paths.includes('tracked.txt'), `tracked edit missing from ${paths}`);
  assert.ok(paths.includes('new.txt'), `turn-created file missing from ${paths}`);
  assert.ok(!paths.includes('notes.txt'), `preexisting untracked file leaked into ${paths}`);
});

test('last_turn without a baseline falls back to HEAD without flooding untracked files', async () => {
  const dir = await makeRepo();
  await write(dir, 'tracked.txt', 'v1\n');
  await commitAll(dir, 'init');
  await write(dir, 'notes.txt', 'preexisting\n');
  await write(dir, 'tracked.txt', 'v2\n');

  // No markTurnStart for this session (app restarted, session restored from
  // history). The HEAD approximation keeps tracked work visible, but without
  // a turn-start snapshot every untracked file would look like a turn change.
  const res = await diffFiles(dir, { mode: 'last_turn', appSessionId: 'never-marked' });
  const paths = pathsOf(res);
  assert.ok(paths.includes('tracked.txt'), `tracked change missing from ${paths}`);
  assert.ok(!paths.includes('notes.txt'), `untracked flood: ${paths}`);
});

test('last_turn follows the latest baseline once a newer turn begins', async () => {
  const dir = await makeRepo();
  await write(dir, 'a.txt', '1\n');
  await commitAll(dir, 'init');

  await markTurnStart(dir, 'session-a');
  await write(dir, 'a.txt', '2\n');
  let res = await diffFiles(dir, { mode: 'last_turn', appSessionId: 'session-a' });
  assert.ok(pathsOf(res).includes('a.txt'));

  // The next turn starts: the baseline advances past the previous turn's
  // edits, so they no longer appear as last-turn changes.
  await markTurnStart(dir, 'session-a');
  res = await diffFiles(dir, { mode: 'last_turn', appSessionId: 'session-a' });
  assert.deepEqual(pathsOf(res), []);
});

test('concurrent first turns adopt separate client baselines', async () => {
  const dir = await makeRepo();
  await write(dir, 'seed.txt', 'seed\n');
  await commitAll(dir, 'init');

  await markTurnStart(dir, 'client-a');
  await write(dir, 'a.txt', 'a\n');
  await markTurnStart(dir, 'client-b');
  await write(dir, 'b.txt', 'b\n');

  assert.deepEqual(await adoptTurnBaseline(dir, 'client-a', 'session-a'), { ok: true });
  assert.deepEqual(await adoptTurnBaseline(dir, 'client-b', 'session-b'), { ok: true });
  assert.deepEqual(
    pathsOf(await diffFiles(dir, { mode: 'last_turn', appSessionId: 'session-a' })),
    ['a.txt', 'b.txt'],
  );
  assert.deepEqual(
    pathsOf(await diffFiles(dir, { mode: 'last_turn', appSessionId: 'session-b' })),
    ['b.txt'],
  );

  // Adoption moves rather than copies the provisional entry.
  assert.deepEqual(await adoptTurnBaseline(dir, 'client-a', 'session-c'), { ok: false });
});

test('last_turn fileDiff renders a file created during the turn', async () => {
  const dir = await makeRepo();
  await write(dir, 'seed.txt', 'seed\n');
  await commitAll(dir, 'init');

  await markTurnStart(dir, 'session-a');
  await write(dir, 'new.txt', 'hello turn\n');

  const res = await fileDiff(dir, {
    mode: 'last_turn',
    appSessionId: 'session-a',
    path: 'new.txt',
  });
  assert.ok(res.diff.includes('hello turn'), 'turn-created file diff should show its content');
});

test('last_turn shows new files in an empty unborn repo', async () => {
  const dir = await makeRepo();
  const mark = await markTurnStart(dir, 'session-a');
  assert.equal(mark.ok, true);

  await write(dir, 'first.txt', 'x\n');
  const res = await diffFiles(dir, { mode: 'last_turn', appSessionId: 'session-a' });
  assert.ok(pathsOf(res).includes('first.txt'));
});

test('last_turn excludes pre-turn working-tree edits in an unborn repo', async () => {
  const dir = await makeRepo();
  const file = 'notes.txt';
  await git(dir, ['config', 'core.splitIndex', 'true']);
  await git(dir, ['config', 'core.autocrlf', 'true']);
  await git(dir, ['config', 'core.safecrlf', 'true']);
  await write(dir, file, 'staged\r\n');
  await git(dir, ['add', '--', file]);
  await write(dir, file, 'staged\r\npre-turn\n');
  const indexPath = path.join(dir, '.git', 'index');
  const indexBefore = await fsp.readFile(indexPath);
  const options = { mode: 'last_turn', appSessionId: 'session-a' };

  assert.equal((await markTurnStart(dir, options.appSessionId)).ok, true);
  const indexAfter = await fsp.readFile(indexPath);
  assert.deepEqual((await diffFiles(dir, options)).files, []);
  assert.equal((await fileDiff(dir, { ...options, path: file })).diff, '');
  assert.ok(indexBefore.equals(indexAfter), 'turn marker rewrote the index');
  await assert.rejects(git(dir, ['rev-parse', '--verify', 'HEAD']));
  assert.equal(await fsp.readFile(path.join(dir, file), 'utf8'), 'staged\r\npre-turn\n');

  await write(dir, file, 'staged\r\npre-turn\nin-turn\n');
  const checkTurnEdit = async () => {
    const { files } = await diffFiles(dir, options);
    assert.deepEqual(
      files.map(({ path, status, additions, deletions }) => ({
        path,
        status,
        additions,
        deletions,
      })),
      [{ path: file, status: 'modified', additions: 1, deletions: 0 }],
    );
    const { diff } = await fileDiff(dir, { ...options, path: file });
    assert.match(diff, /^\+in-turn$/m);
    assert.doesNotMatch(diff, /^\+pre-turn$/m);
  };
  await checkTurnEdit();
  await write(dir, file, 'staged\r\npre-turn\r\nin-turn\r\n');
  await commitAll(dir, 'initial commit');
  await checkTurnEdit();
});

test('last_turn still shows new files when Git cannot snapshot a tracked file', async () => {
  const dir = await makeRepo();
  await write(dir, '.gitattributes', 'notes.txt filter=unavailable\n');
  await write(dir, 'notes.txt', 'staged\n');
  await git(dir, ['add', '--', '.gitattributes', 'notes.txt']);
  await git(dir, ['config', 'filter.unavailable.clean', 'exit 1']);
  await git(dir, ['config', 'filter.unavailable.required', 'true']);
  await write(dir, 'notes.txt', 'pre-turn edit\n');

  await markTurnStart(dir, 'session-a');
  await write(dir, 'new.txt', 'in-turn\n');
  const review = await diffFiles(dir, { mode: 'last_turn', appSessionId: 'session-a' });
  assert.ok(pathsOf(review).includes('new.txt'));
});

test('last_turn captures conflict content before an unborn cherry-pick is resolved', async () => {
  const source = await makeRepo();
  const dir = await makeRepo();
  const file = 'notes.txt';
  await write(source, file, 'base\n');
  await commitAll(source, 'base');
  await write(source, file, 'incoming\n');
  await commitAll(source, 'incoming change');
  await git(dir, ['fetch', source, 'HEAD']);
  await assert.rejects(git(dir, ['cherry-pick', 'FETCH_HEAD']));
  const conflictsBefore = await git(dir, ['ls-files', '--unmerged']);
  assert.match(conflictsBefore, /notes\.txt/);

  const options = { mode: 'last_turn', appSessionId: 'session-a' };
  assert.equal((await markTurnStart(dir, options.appSessionId)).ok, true);
  assert.equal(await git(dir, ['ls-files', '--unmerged']), conflictsBefore);
  await write(dir, file, 'incoming\nresolved\n');
  await git(dir, ['add', '--', file]);
  await write(dir, 'new.txt', 'new during turn\n');

  assert.deepEqual(pathsOf(await diffFiles(dir, options)).sort(), ['new.txt', file].sort());
  const { diff } = await fileDiff(dir, { ...options, path: file });
  assert.match(diff, /^\+resolved$/m);
  assert.doesNotMatch(diff, /^\+incoming$/m);
});

test('worktree listing preserves newline-containing paths', async () => {
  const dir = await makeRepo();
  await git(dir, ['commit', '--allow-empty', '-qm', 'init']);
  const root = await fsp.realpath(dir);
  const target = path.join(root, 'line\nbreak');
  await git(dir, ['worktree', 'add', '-b', 'newline', target]);

  const entries = await worktrees(root);
  assert.deepEqual(
    entries.map(({ path, isMain, isCurrent }) => ({ path, isMain, isCurrent })),
    [
      { path: root, isMain: true, isCurrent: true },
      { path: target, isMain: false, isCurrent: false },
    ],
  );
  const linkedEntries = await worktrees(target);
  assert.deepEqual(
    linkedEntries.map(({ path, isMain, isCurrent }) => ({ path, isMain, isCurrent })),
    [
      { path: root, isMain: true, isCurrent: false },
      { path: target, isMain: false, isCurrent: true },
    ],
  );
});

test('worktree listing preserves paths and detached and locked states', async () => {
  const dir = await makeRepo();
  await git(dir, ['commit', '--allow-empty', '-qm', 'init']);
  const root = await fsp.realpath(dir);
  const ordinary = path.join(root, 'ordinary');
  const spaced = path.join(root, ' with space ');
  const unicode = path.join(root, 'café');
  await git(root, ['worktree', 'add', '--detach', ordinary]);
  await git(root, ['worktree', 'add', '--detach', spaced]);
  await git(root, ['worktree', 'lock', spaced]);
  await git(root, ['worktree', 'add', '--detach', unicode]);
  await git(root, ['worktree', 'lock', '--reason', 'first\n\nsecond', unicode]);

  const entries = await worktrees(root);
  assert.deepEqual(
    entries.map(({ path, isMain, isCurrent, detached, locked }) => ({
      path,
      isMain,
      isCurrent,
      detached,
      locked,
    })),
    [
      { path: root, isMain: true, isCurrent: true, detached: false, locked: false },
      { path: spaced, isMain: false, isCurrent: false, detached: true, locked: true },
      { path: unicode, isMain: false, isCurrent: false, detached: true, locked: true },
      { path: ordinary, isMain: false, isCurrent: false, detached: true, locked: false },
    ],
  );
});

test(
  'worktree listing supports old Git and returns no entries on failure',
  {
    skip: process.platform === 'win32',
  },
  async () => {
    const dir = await makeRepo();
    await git(dir, ['commit', '--allow-empty', '-qm', 'init']);
    const root = await fsp.realpath(dir);
    const target = path.join(root, ' with space ');
    await git(root, ['worktree', 'add', '--detach', target]);
    const denied = await fsp.realpath(await makeRepo());
    const unrelated = await fsp.realpath(await makeRepo());
    const shimDir = path.join(dir, 'bin');
    await fsp.mkdir(shimDir);
    const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
    await fsp.writeFile(
      path.join(shimDir, 'git'),
      `#!${process.execPath}
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
if (args.includes('worktree') && args.includes('list')) {
  if (args[1] === ${JSON.stringify(denied)}) {
    process.stderr.write('fatal: permission denied\\n');
    process.exit(128);
  }
  if (args[1] === ${JSON.stringify(unrelated)}) {
    process.stderr.write('fatal: unable to read worktrees\\n');
    process.exit(128);
  }
  if (args.includes('-z')) {
    process.stderr.write("Fehler: Unbekannter Schalter \\x60z'\\n");
    process.exit(129);
  }
}
const result = spawnSync(${JSON.stringify(realGit)}, args, { stdio: 'inherit' });
process.exit(result.status ?? 1);
`,
      { mode: 0o755 },
    );
    const originalPath = process.env.PATH;
    process.env.PATH = shimDir + path.delimiter + originalPath;
    try {
      assert.deepEqual(
        (await worktrees(root)).map(({ path, isMain, isCurrent }) => ({ path, isMain, isCurrent })),
        [
          { path: root, isMain: true, isCurrent: true },
          { path: target, isMain: false, isCurrent: false },
        ],
      );
      assert.deepEqual(await worktrees(denied), []);
      assert.deepEqual(await worktrees(unrelated), []);
    } finally {
      process.env.PATH = originalPath;
    }
  },
);

test('a created worktree keeps its review diff after its base branch merges it', async () => {
  const dir = await makeRepo();
  await write(dir, 'seed.txt', 'seed\n');
  await commitAll(dir, 'init');
  const baseCommit = (await git(dir, ['rev-parse', 'HEAD'])).trim();
  const baseBranch = (await git(dir, ['branch', '--show-current'])).trim();

  const created = await createWorktree(dir, {
    branch: 'feature/review-after-merge',
    base: baseBranch,
    newBranch: true,
  });
  assert.equal(created.ok, true);
  assert.equal(
    created.path,
    path.join(await fsp.realpath(dir), '.worktrees', 'feature-review-after-merge'),
  );

  await write(created.path, 'feature.txt', 'kept for historical review\n');
  await commitAll(created.path, 'feature');
  const featureCommit = (await git(created.path, ['rev-parse', 'HEAD'])).trim();

  // Simulate main fast-forwarding when the branch is merged. The worktree
  // remains open on the feature branch, and Review must still show what that
  // session produced rather than comparing two refs that now point together.
  await git(dir, ['update-ref', `refs/heads/${baseBranch}`, featureCommit, baseCommit]);

  for (const mode of ['branch', 'worktree']) {
    const files = await diffFiles(created.path, { mode });
    assert.deepEqual(pathsOf(files), ['feature.txt'], `${mode} scope lost the merged change`);

    const rendered = await fileDiff(created.path, { mode, path: 'feature.txt' });
    assert.match(rendered.diff, /\+kept for historical review/);
  }
});

test('detached worktree creation uses the selected base without creating a branch', async () => {
  const dir = await makeRepo();
  await write(dir, 'seed.txt', 'seed\n');
  await commitAll(dir, 'init');
  const baseCommit = (await git(dir, ['rev-parse', 'HEAD'])).trim();

  const created = await createWorktree(dir, {
    detached: true,
    base: 'HEAD',
    name: 'chat-client123',
  });

  assert.equal(created.ok, true);
  const root = await fsp.realpath(dir);
  assert.equal(created.path, path.join(root, '.worktrees', 'chat-client123', path.basename(root)));
  assert.equal((await git(created.path, ['rev-parse', 'HEAD'])).trim(), baseCommit);
  assert.equal((await git(created.path, ['branch', '--show-current'])).trim(), '');
});

test('detached worktree names cannot escape the default worktree directory', async () => {
  const dir = await makeRepo();
  await write(dir, 'seed.txt', 'seed\n');
  await commitAll(dir, 'init');

  const created = await createWorktree(dir, {
    detached: true,
    base: 'HEAD',
    name: '..',
  });

  assert.equal(created.ok, false);
  assert.equal(created.reason, 'invalid_name');
});

test('worktree removal deletes only a branch Git confirms is merged', async () => {
  const unmergedRoot = await makeRepo();
  await write(unmergedRoot, 'base.txt', 'base\n');
  await commitAll(unmergedRoot, 'base');
  const unmerged = await createWorktree(unmergedRoot, {
    branch: 'unmerged-feature',
    base: 'HEAD',
    newBranch: true,
  });
  assert.equal(unmerged.ok, true);
  await write(unmerged.path, 'feature.txt', 'feature\n');
  await commitAll(unmerged.path, 'feature');
  assert.equal(
    (await branches(unmergedRoot)).local.find((branch) => branch.name === 'unmerged-feature')
      ?.merged,
    false,
  );

  const kept = await removeWorktree(unmergedRoot, {
    path: unmerged.path,
    deleteBranch: true,
  });
  assert.equal(kept.ok, true);
  assert.equal(kept.branchDeleted, false);
  assert.match(kept.message, /branch was kept/i);
  assert.equal(
    (await git(unmergedRoot, ['branch', '--list', 'unmerged-feature'])).trim(),
    'unmerged-feature',
  );

  const mergedRoot = await makeRepo();
  await write(mergedRoot, 'base.txt', 'base\n');
  await commitAll(mergedRoot, 'base');
  const merged = await createWorktree(mergedRoot, {
    branch: 'merged-feature',
    base: 'HEAD',
    newBranch: true,
  });
  assert.equal(merged.ok, true);
  await write(merged.path, 'feature.txt', 'feature\n');
  await commitAll(merged.path, 'feature');
  await git(mergedRoot, ['merge', '--ff-only', 'merged-feature']);
  assert.equal(
    (await branches(mergedRoot)).local.find((branch) => branch.name === 'merged-feature')?.merged,
    true,
  );

  const deleted = await removeWorktree(mergedRoot, {
    path: merged.path,
    deleteBranch: true,
  });
  assert.equal(deleted.ok, true);
  assert.equal(deleted.branchDeleted, true);
  assert.equal((await git(mergedRoot, ['branch', '--list', 'merged-feature'])).trim(), '');
});

test('dirty worktree removal requires force and still keeps an unmerged branch', async () => {
  const root = await makeRepo();
  await write(root, 'base.txt', 'base\n');
  await commitAll(root, 'base');
  const created = await createWorktree(root, {
    branch: 'dirty-feature',
    base: 'HEAD',
    newBranch: true,
  });
  assert.equal(created.ok, true);
  await write(created.path, 'feature.txt', 'committed feature\n');
  await commitAll(created.path, 'feature');
  await write(created.path, 'unsaved.txt', 'do not discard without confirmation\n');

  const blocked = await removeWorktree(root, {
    path: created.path,
    deleteBranch: true,
  });
  assert.equal(blocked.ok, false);
  assert.equal(
    (await fsp.readFile(path.join(created.path, 'unsaved.txt'), 'utf8')).trim(),
    'do not discard without confirmation',
  );

  const removed = await removeWorktree(root, {
    path: created.path,
    deleteBranch: true,
    force: true,
  });
  assert.equal(removed.ok, true);
  assert.equal(removed.branchDeleted, false);
  assert.equal((await git(root, ['branch', '--list', 'dirty-feature'])).trim(), 'dirty-feature');
});

test('uncommitted file entries all render a current diff', async () => {
  const dir = await makeRepo();
  await write(dir, 'edited.txt', 'before\n');
  await write(dir, 'deleted.txt', 'remove me\n');
  await write(dir, 'renamed.txt', 'rename me\n');
  await commitAll(dir, 'init');

  await write(dir, 'edited.txt', 'after\n');
  await fsp.rm(path.join(dir, 'deleted.txt'));
  await git(dir, ['mv', 'renamed.txt', 'moved.txt']);
  await write(dir, 'untracked.txt', 'brand new\n');

  const result = await diffFiles(dir, { mode: 'uncommitted' });
  assert.deepEqual(pathsOf(result), ['deleted.txt', 'edited.txt', 'moved.txt', 'untracked.txt']);
  assert.equal(result.files.find((file) => file.path === 'moved.txt')?.status, 'renamed');

  for (const file of result.files) {
    const rendered = await fileDiff(dir, {
      mode: 'uncommitted',
      path: file.path,
      oldPath: file.oldPath,
    });
    assert.notEqual(rendered.diff, '', `${file.status} ${file.path} had no diff`);
  }
  const moved = await fileDiff(dir, {
    mode: 'uncommitted',
    path: 'moved.txt',
    oldPath: 'renamed.txt',
  });
  assert.match(moved.diff, /^rename from renamed\.txt\nrename to moved\.txt$/m);
});

for (const mode of [
  'unstaged',
  'staged',
  'uncommitted',
  'worktree',
  'branch',
  'commit',
  'last_turn',
]) {
  test(`${mode} fingerprints track same-count scoped changes and stay stable on idle reads`, async () => {
    const dir = await makeRepo();
    await write(dir, 'example.txt', 'original\n');
    await commitAll(dir, 'base');
    await git(dir, ['remote', 'add', 'origin', 'https://example.com/repo.git']);
    await git(dir, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
    await git(dir, ['checkout', '-qb', 'feature']);
    if (mode === 'last_turn') await markTurnStart(dir, 'session');
    await write(dir, 'example.txt', 'change-A\n');
    if (mode === 'staged') await git(dir, ['add', 'example.txt']);
    if (mode === 'branch' || mode === 'commit') await commitAll(dir, 'change A');
    const options = { mode, appSessionId: 'session' };
    const first = (await diffFiles(dir, options)).files.find((file) => file.path === 'example.txt');
    assert.ok(first?.fingerprint);
    assert.deepEqual(
      (await diffFiles(dir, options)).files.find((file) => file.path === 'example.txt'),
      first,
    );
    await write(dir, 'example.txt', 'change-B\n');
    if (mode === 'staged' || mode === 'branch' || mode === 'commit') {
      const unstaged = (await diffFiles(dir, options)).files.find(
        (file) => file.path === 'example.txt',
      );
      assert.equal(
        unstaged.fingerprint,
        first.fingerprint,
        'unstaged edits must not invalidate immutable scopes',
      );
      if (mode === 'staged') await git(dir, ['add', 'example.txt']);
      else await commitAll(dir, 'change B');
    }
    const next = (await diffFiles(dir, options)).files.find((file) => file.path === 'example.txt');
    assert.equal(next.additions, first.additions);
    assert.equal(next.deletions, first.deletions);
    assert.notEqual(next.fingerprint, first.fingerprint);
    assert.match((await fileDiff(dir, { ...options, path: 'example.txt' })).diff, /\+change-B/);
  });
}

test('deleted-file fingerprints follow HEAD even when the worktree file stays absent', async () => {
  const dir = await makeRepo();
  await write(dir, 'example.txt', 'change-A\n');
  await commitAll(dir, 'first');
  await fsp.rm(path.join(dir, 'example.txt'));
  const first = (await diffFiles(dir, { mode: 'uncommitted' })).files[0];
  await write(dir, 'example.txt', 'change-B\n');
  await commitAll(dir, 'second');
  await fsp.rm(path.join(dir, 'example.txt'));
  const next = (await diffFiles(dir, { mode: 'uncommitted' })).files[0];
  assert.equal(next.deletions, first.deletions);
  assert.notEqual(next.fingerprint, first.fingerprint);
});

test('fileDiff rejects a Git failure instead of reporting a successful empty patch', async () => {
  const dir = await makeRepo();
  await write(dir, 'example.txt', 'original\n');
  await write(dir, '.gitattributes', 'example.txt diff=broken\n');
  await commitAll(dir, 'base');
  await git(dir, ['config', 'diff.broken.command', `"${process.execPath}" -e "process.exit(2)"`]);
  await write(dir, 'example.txt', 'changed\n');
  await assert.rejects(fileDiff(dir, { mode: 'unstaged', path: 'example.txt' }), /Command failed/);
});

test('repoStatus counts what the repository line shows, and is null outside one', async () => {
  const dir = await makeRepo();
  await write(dir, 'tracked.txt', 'one\n');
  await commitAll(dir, 'first');
  await write(dir, 'tracked.txt', 'two\n');
  await write(dir, 'new.txt', 'new\n');
  await git(dir, ['add', 'new.txt']);
  await write(dir, 'loose.txt', 'loose\n');

  const status = await repoStatus(dir);
  assert.equal(status?.repoRoot, await fsp.realpath(dir));
  const { changed, staged, unstaged, untracked } = status ?? {};
  assert.deepEqual(
    { changed, staged, unstaged, untracked },
    {
      changed: 3,
      staged: 1,
      unstaged: 1,
      untracked: 1,
    },
  );
  assert.equal(await repoStatus(path.join(dir, 'missing')), null);
});

test('validBranchName accepts normal names and rejects option-like or malformed ones', () => {
  for (const name of ['main', 'feature/foo', 'fix/issue-27/part.2', 'v1.0', 'HEAD-2']) {
    assert.equal(validBranchName(name), true, name);
  }
  const bad = [
    null,
    undefined,
    '',
    42,
    '-D', // leading dash would be parsed as a git option
    '--force',
    '@',
    'a..b',
    'a@{1}',
    'name.',
    'a b',
    'a\tb',
    'a\nb',
    'a~1',
    'a^b',
    'a:b',
    'a?b',
    'a*b',
    'a[b',
    'a\\b',
    'a\x00b',
    'a\x1fb',
    'a\x7fb',
    '/leading',
    'trailing/',
    'a//b',
    '.hidden',
    'nested/.hidden',
    'name.lock',
    'nested/name.lock/x',
  ];
  for (const name of bad) {
    assert.equal(validBranchName(name), false, String(name));
  }
});

test('sanitizeSegment collapses unsafe characters and trims dashes', () => {
  assert.equal(sanitizeSegment('feature/foo bar'), 'feature-foo-bar');
  assert.equal(sanitizeSegment('--weird--'), 'weird');
  assert.equal(sanitizeSegment('a.b-c_d'), 'a.b-c_d');
  assert.equal(sanitizeSegment(''), '');
  assert.equal(sanitizeSegment(null), '');
  assert.equal(sanitizeSegment('///'), '');
  assert.equal(sanitizeSegment('x'.repeat(200)).length, 80);
});

test('isWithin matches exact paths and children on a separator boundary', () => {
  const base = path.join(path.sep, 'repo');
  assert.equal(isWithin(base, base), true);
  assert.equal(isWithin(base, path.join(base, 'sub', 'file')), true);
  // "/repo-evil" shares the prefix but is not inside "/repo"
  assert.equal(isWithin(base, `${base}-evil`), false);
  assert.equal(isWithin(base, path.join(path.sep, 'other')), false);
});

test('allowedWorktreeTarget keeps targets inside repo, parent, or home', () => {
  const root = path.join(path.sep, 'private', 'srv', 'repo');
  assert.equal(allowedWorktreeTarget(root, path.join(root, '.worktrees', 'wt')), true);
  assert.equal(allowedWorktreeTarget(root, path.join(path.dirname(root), 'sibling')), true);
  assert.equal(allowedWorktreeTarget(root, path.join(os.homedir(), 'worktrees', 'wt')), true);
  assert.equal(allowedWorktreeTarget(root, path.join(path.sep, 'etc', 'planted')), false);
  assert.equal(allowedWorktreeTarget(root, path.join(path.sep, 'tmp', 'planted')), false);
  // nesting inside the .git dir would corrupt the repo
  assert.equal(allowedWorktreeTarget(root, path.join(root, '.git', 'wt')), false);
  // prefix sibling of root is only allowed because it sits in root's parent
  assert.equal(allowedWorktreeTarget(root, `${root}-evil`), true);
});

test('matchRemote prefers the longest configured remote name', () => {
  assert.equal(matchRemote('origin/main', ['origin']), 'origin');
  assert.equal(matchRemote('foo/bar/feature', ['foo', 'foo/bar']), 'foo/bar');
  assert.equal(matchRemote('origin', ['origin']), 'origin');
  assert.equal(matchRemote('originals/x', ['origin']), null);
  assert.equal(matchRemote('dev', ['origin']), null);
  assert.equal(matchRemote('origin/main', []), null);
  assert.equal(matchRemote(null, ['origin']), null);
  assert.equal(matchRemote('origin/main', null), null);
});
