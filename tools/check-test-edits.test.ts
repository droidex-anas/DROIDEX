import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

const checker = fileURLToPath(new URL('./check-test-edits.mjs', import.meta.url));

function createRepository(t: TestContext) {
  const cwd = mkdtempSync(join(tmpdir(), 'droidex-test-edits-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  const write = (file: string, text: string) => {
    mkdirSync(dirname(join(cwd, file)), { recursive: true });
    writeFileSync(join(cwd, file), text);
  };
  const commit = () => {
    git('add', '.');
    git(
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      '-c',
      'commit.gpgSign=false',
      'commit',
      '-qm',
      'fixture',
    );
  };
  git('init', '-q');
  return { cwd, git, write, commit };
}

test('advisory follows renamed tests and flags added disable syntax without matching quoted text', (t) => {
  const { cwd, git, write, commit } = createRepository(t);
  write('src/app.ts', 'export const value = 1;\n');
  write(
    'src/moved.test.ts',
    'test("kept", () => {\n  assert.equal(value, 1);\n  assert.ok(value);\n});\n',
  );
  write('src/quoted.test.ts', 'test("kept", () => {});\n');
  write('src/discovered.test.ts', 'test("discovered", () => {});\n');
  commit();
  const base = git('rev-parse', 'HEAD');
  write('src/app.ts', 'export const value = 2;\n');
  write('src/moved.test.ts', 'test("kept", () => {\n  assert.equal(value, 1);\n});\n');
  renameSync(join(cwd, 'src/moved.test.ts'), join(cwd, 'src/moved.ts'));
  renameSync(join(cwd, 'src/discovered.test.ts'), join(cwd, 'src/discovered.ts'));
  write(
    'src/disabled.test.ts',
    [
      'test.skipIf(condition)("conditional", () => {});',
      'test.skip.each(cases)("chained", () => {});',
      'test.only.each(cases)("focused", () => {});',
      'test.todo.each(cases)("pending", () => {});',
      'test("option", { skip: condition }, () => {});',
      'test("enabled", { skip: false }, () => {});',
      '',
    ].join('\n'),
  );
  write(
    'src/quoted.test.ts',
    'test("kept", () => {});\nconst example = "test.skip( and skip: true";\n// test.only("example")\n',
  );
  commit();
  const result = spawnSync(process.execPath, [checker, base], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GITHUB_STEP_SUMMARY: '' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /::warning file=src\/discovered\.ts::.*renamed outside test discovery/,
  );
  assert.match(
    result.stdout,
    /::warning file=src\/moved\.ts::.*1 line\(s\) removed, 1 on an assertion line.*renamed from src\/moved\.test\.ts/,
  );
  assert.match(
    result.stdout,
    /::warning file=src\/disabled\.test\.ts::.*5 potential skip\/only\/todo added/,
  );
  assert.doesNotMatch(result.stdout, /::warning file=src\/quoted\.test\.ts::/);
});
