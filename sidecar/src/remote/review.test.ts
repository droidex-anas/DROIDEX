import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseDiff, readWorkspaceDiff } from './diff.js';
import { RemoteReview } from './review.js';

const execute = promisify(execFile);
const patch = 'diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n@@ -4,2 +4,2 @@\n---literal\n+++literal\n retained\n';

test('diff hunks preserve actual line numbers and header-looking content', () => {
  const file = parseDiff(patch)[0]!;
  assert.equal(file.path, 'file.ts');
  assert.deepEqual(file.lines, [
    { kind: 'hunk', text: '@@ -4,2 +4,2 @@' },
    { kind: 'deletion', text: '--literal', oldLine: 4 },
    { kind: 'addition', text: '++literal', newLine: 4 },
    { kind: 'context', text: 'retained', oldLine: 5, newLine: 5 },
  ]);
});

test('working-tree review handles unborn repositories, real edited files, binaries and private paths', async (context) => {
  const cwd = await mkdtemp(join(tmpdir(), 'droidex-review-'));
  context.after(() => rm(cwd, { recursive: true, force: true }));
  await execute('git', ['init', '--quiet'], { cwd });
  await writeFile(join(cwd, 'new.ts'), 'staged\n');
  await writeFile(join(cwd, '.env'), 'SECRET=not-for-mobile\n');
  await execute('git', ['add', 'new.ts', '.env'], { cwd });
  await writeFile(join(cwd, 'new.ts'), 'working tree\n');
  await writeFile(join(cwd, 'asset.bin'), Buffer.from([0, 1, 2]));
  await symlink('/etc/passwd', join(cwd, 'outside'));
  const result = await readWorkspaceDiff(cwd);
  assert.equal(result.changes.find((file) => file.path === 'new.ts')?.lines[0]?.text, 'working tree');
  assert.equal(result.changes.find((file) => file.path === 'asset.bin')?.note, 'Binary file');
  assert.ok(!result.changes.some((file) => file.path === '.env' || file.path === 'outside'));
  assert.ok(!JSON.stringify(result).includes('not-for-mobile'));
  await execute('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture'], { cwd });
  const tracked = await readWorkspaceDiff(cwd);
  assert.ok(tracked.changes.find((file) => file.path === 'new.ts')?.lines.some((line) => line.kind === 'deletion' && line.text === 'staged'));
});

const pullRequest = { number: 3, title: 'A real PR', state: 'OPEN', url: 'https://github.com/example/project/pull/3',
  headRefName: 'topic', baseRefName: 'main', isDraft: false, updatedAt: '2026-09-15T00:00:00Z', body: '# Review\nActual body' };

test('PR review is a bounded read with argument arrays and no merge/checkout operations', async () => {
  const commands: string[][] = [];
  const review = new RemoteReview('/chosen/project', async (args) => {
    commands.push(args);
    if (args[1] === 'list') return JSON.stringify([pullRequest]);
    if (args[1] === 'view') return JSON.stringify(pullRequest);
    return patch;
  });
  assert.equal((await review.pullRequests())[0]?.number, 3);
  const detail = await review.pullRequest(3);
  assert.equal(detail.body, '# Review\nActual body');
  assert.equal(detail.review.changes[0]?.path, 'file.ts');
  assert.deepEqual(commands.map((args) => args[1]), ['list', 'view', 'diff']);
  assert.throws(() => review.pullRequest(NaN), /Invalid/);
  assert.throws(() => review.pullRequest(-1), /Invalid/);
  assert.throws(() => review.pullRequest(3.5), /Invalid/);
});

test('concurrent review requests share a read and failed requests can be retried', async () => {
  let complete!: (result: string) => void;
  let calls = 0;
  const review = new RemoteReview('/project', () => {
    calls += 1;
    return new Promise<string>((resolve) => { complete = resolve; });
  });
  const first = review.pullRequests();
  const second = review.pullRequests();
  assert.equal(first, second);
  complete('invalid json');
  await assert.rejects(first);
  const retry = review.pullRequests();
  complete(JSON.stringify([pullRequest]));
  assert.equal((await retry).length, 1);
  assert.equal(calls, 2);
});
