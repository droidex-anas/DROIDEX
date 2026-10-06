import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import {
  createAutomationWorkspace,
  releaseAutomationWorkspace,
  resolveAutomationWorkspace,
  type PrepareAutomationWorkspaceInput,
} from './workspace.js';

const execFileAsync = promisify(execFile);

test('release removes a clean linked worktree', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'droidex-workspace-'));
  const repository = join(directory, 'repository');

  try {
    await initializeRepository(repository);
    const input: PrepareAutomationWorkspaceInput = {
      cwd: repository,
      executionMode: 'worktree',
      title: 'Clean worktree',
      runId: 'run-123456',
    };
    const target = await resolveAutomationWorkspace(input);
    await createAutomationWorkspace(input, target);
    assert.equal(existsSync(target), true);

    await releaseAutomationWorkspace({ resolvedCwd: target, executionMode: 'worktree' });
    assert.equal(existsSync(target), false);
    assert.doesNotMatch(await git(repository, ['worktree', 'list', '--porcelain']), /run-123456/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('release preserves a main worktree, a submodule, and a linked worktree it did not lay out', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'droidex-workspace-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const release = (resolvedCwd: string) =>
    releaseAutomationWorkspace({ resolvedCwd, executionMode: 'worktree' });

  // A main worktree whose Git directory lives beside it.
  const repository = join(directory, 'repository');
  const gitDirectory = join(directory, 'repository.git');
  await git(directory, ['init', `--separate-git-dir=${gitDirectory}`, repository]);
  await release(repository);
  assert.equal(existsSync(repository), true);
  assert.equal(existsSync(gitDirectory), true);

  // A submodule's working tree.
  const parent = join(directory, 'parent');
  const child = join(directory, 'child');
  const submodule = join(parent, 'modules', 'child');
  await initializeRepository(parent);
  await initializeRepository(child);
  await git(parent, [
    '-c',
    'protocol.file.allow=always',
    'submodule',
    'add',
    child,
    'modules/child',
  ]);
  await release(submodule);
  assert.equal(existsSync(submodule), true);
  assert.equal(await git(submodule, ['rev-parse', '--show-toplevel']), await realpath(submodule));

  // A clean linked worktree outside the automation layout.
  const unrelated = join(directory, 'unrelated');
  await git(parent, ['worktree', 'add', '--detach', unrelated, 'HEAD']);
  await release(unrelated);
  assert.equal(existsSync(unrelated), true);
  assert.match(await git(parent, ['worktree', 'list', '--porcelain']), /unrelated/);
});

async function initializeRepository(repository: string): Promise<void> {
  await git(tmpdir(), ['init', repository]);
  const empty = join(repository, 'empty');
  await writeFile(empty, '');
  const tree = await git(repository, ['hash-object', '-t', 'tree', '-w', empty]);
  const commitFile = join(repository, 'commit');
  await writeFile(
    commitFile,
    [
      `tree ${tree}`,
      'author Test Fixture <fixture@example.invalid> 0 +0000',
      'committer Test Fixture <fixture@example.invalid> 0 +0000',
      '',
      'fixture',
      '',
    ].join('\n'),
  );
  const commit = await git(repository, ['hash-object', '-t', 'commit', '-w', commitFile]);
  await git(repository, ['update-ref', 'HEAD', commit]);
  await rm(empty);
  await rm(commitFile);
}

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync('git', ['-C', cwd, ...args]);
  return result.stdout.trim();
}
