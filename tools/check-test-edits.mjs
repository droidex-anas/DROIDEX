// Guards the regression record against agents rewriting tests to make a code
// change pass.
//
// Default mode reports, and never fails: when a change edits source and also
// removes lines from tests that already existed, or adds a skip, only, or todo,
// each such test file gets a warning annotation and a job summary line so a
// reviewer can confirm the behaviour change was intended.
//
// `--regression-gate` fails when the change touches the held-out suite in
// `sidecar/regression/`, unless ALLOW_REGRESSION_EDITS is "true" (CI sets it
// from the `regression-approved` label a maintainer adds after reviewing).
//
// Usage: node tools/check-test-edits.mjs [base-ref] [--regression-gate]
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const args = process.argv.slice(2);
const regressionGate = args.includes('--regression-gate');
const base = args.find((arg) => !arg.startsWith('--')) ?? process.env.TEST_EDITS_BASE ?? 'origin/main';

const REGRESSION_DIR = /^sidecar\/regression\//;
const TEST_FILE = /\.(test|spec)\.(ts|tsx|cjs|mjs)$|^sidecar\/src\/testing\/|^sidecar\/regression\//;
const SOURCE_FILE = /^(src|sidecar\/src|electron|packages\/[^/]+\/src)\/.*\.(ts|tsx|cjs|mjs)$/;
const ASSERTION = /\bassert\b|\bexpect\(|\bt\.(equal|deepEqual|ok|throws|rejects)\b/;
const SKIP = /\.(skip|only|todo)\(|\b(skip|only|todo)\s*:\s*(true|['"`])/;

function git(...gitArgs) {
  return execFileSync('git', gitArgs, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function summarize(title, intro, lines) {
  console.log(`${title}:\n${lines.join('\n')}`);
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    [`### ${title}`, '', intro, '', ...lines.map((line) => `- ${line}`), ''].join('\n'),
  );
}

const mergeBase = git('merge-base', base, 'HEAD').trim();
// Renames count as edits of an existing file, so a moved-and-rewritten test is
// still compared against its old content.
const changes = git('diff', '--name-status', '-M', mergeBase, 'HEAD')
  .split('\n')
  .filter(Boolean)
  .map((line) => {
    const [status, ...paths] = line.split('\t');
    return { status: status[0], oldPath: paths[0], file: paths.at(-1) };
  });

if (regressionGate) {
  const touched = changes.filter(({ oldPath, file }) => REGRESSION_DIR.test(oldPath) || REGRESSION_DIR.test(file));
  if (touched.length === 0) {
    console.log('The held-out regression suite is unchanged.');
    process.exit(0);
  }
  const lines = touched.map(({ status, oldPath, file }) =>
    oldPath === file ? `${status} ${file}` : `${status} ${oldPath} -> ${file}`,
  );
  if (process.env.ALLOW_REGRESSION_EDITS === 'true') {
    summarize(
      'Held-out regression suite changed (approved)',
      'A maintainer approved these changes with the `regression-approved` label.',
      lines,
    );
    process.exit(0);
  }
  for (const { file } of touched) {
    console.log(`::error file=${file}::The held-out regression suite changed. A maintainer must review it and add the regression-approved label.`);
  }
  summarize(
    'Held-out regression suite changed',
    'Only a human changes `sidecar/regression/`. Review these diffs, then add the `regression-approved` label.',
    lines,
  );
  process.exit(1);
}

const sourceChanged = changes.some(({ file }) => SOURCE_FILE.test(file) && !TEST_FILE.test(file));
const flagged = [];

for (const { status, oldPath, file } of changes) {
  if (!TEST_FILE.test(file) || status === 'A') continue;
  const diff = git('diff', '--unified=0', '-M', mergeBase, 'HEAD', '--', oldPath, file).split('\n');
  const removed = diff.filter((line) => line.startsWith('-') && !line.startsWith('---') && line.slice(1).trim());
  const skips = diff.filter((line) => line.startsWith('+') && !line.startsWith('+++') && SKIP.test(line));
  if (removed.length === 0 && skips.length === 0) continue;
  const assertions = removed.filter((line) => ASSERTION.test(line)).length;
  flagged.push({ file, removed: removed.length, assertions, skips: skips.length, deleted: status === 'D' });
}

if (!sourceChanged || flagged.length === 0) {
  console.log('No existing test lines were removed or skipped alongside source changes.');
  process.exit(0);
}

const lines = flagged.map(({ file, removed, assertions, skips, deleted }) => {
  const parts = [`${removed} line(s) removed, ${assertions} on an assertion line`];
  if (skips > 0) parts.push(`${skips} skip/only/todo added`);
  if (deleted) parts.push('file deleted');
  return `${file}: ${parts.join(', ')}`;
});
for (const line of lines) {
  const [file, detail] = line.split(': ');
  console.log(`::warning file=${file}::Existing test edited in a change that also edits source (${detail}). Confirm the behaviour change is intended.`);
}
summarize(
  'Existing tests edited alongside source changes',
  'Reviewers: confirm each one is an intended behaviour change, not a test rewritten to pass.',
  lines,
);
