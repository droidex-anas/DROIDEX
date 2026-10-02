// Flags pull requests that change source code and also remove assertions from
// tests that already existed on the base branch. Rewriting an existing test in
// the same change as the code it guards can hide a regression, so a reviewer
// should confirm each flagged edit is an intended behaviour change.
//
// Usage: node tools/check-test-edits.mjs [base-ref]   (default: origin/main)
// Reports only; it never fails the build.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const base = process.argv[2] ?? process.env.TEST_EDITS_BASE ?? 'origin/main';
const TEST_FILE = /\.(test|spec)\.(ts|tsx|cjs|mjs)$|(^|\/)regression\//;
const SOURCE_FILE = /^(src|sidecar\/src|electron|packages\/[^/]+\/src)\/.*\.(ts|tsx|cjs|mjs)$/;
const ASSERTION = /\bassert\b|\bexpect\(|\bt\.(equal|deepEqual|ok|throws|rejects)\b/;

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

const mergeBase = git('merge-base', base, 'HEAD').trim();
const changes = git('diff', '--name-status', '--no-renames', mergeBase, 'HEAD')
  .split('\n')
  .filter(Boolean)
  .map((line) => {
    const [status, file] = line.split('\t');
    return { status, file };
  });

const sourceChanged = changes.some(({ file }) => SOURCE_FILE.test(file) && !TEST_FILE.test(file));
const flagged = [];

for (const { status, file } of changes) {
  if (!TEST_FILE.test(file) || status === 'A') continue;
  const removed = git('diff', '--unified=0', mergeBase, 'HEAD', '--', file)
    .split('\n')
    .filter((line) => line.startsWith('-') && !line.startsWith('---') && ASSERTION.test(line)).length;
  if (removed > 0) flagged.push({ file, removed, deleted: status === 'D' });
}

if (!sourceChanged || flagged.length === 0) {
  console.log('No existing test assertions were removed alongside source changes.');
  process.exit(0);
}

const lines = flagged.map(
  ({ file, removed, deleted }) => `${file}: ${removed} assertion line(s) removed${deleted ? ' (file deleted)' : ''}`,
);
for (const { file, removed } of flagged) {
  console.log(
    `::warning file=${file}::${removed} existing assertion line(s) removed in a change that also edits source. Confirm the behaviour change is intended.`,
  );
}
console.log(`Existing test assertions removed alongside source changes:\n${lines.join('\n')}`);

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    [
      '### Existing test assertions changed',
      '',
      'This change edits source and removes assertions from tests that already existed.',
      'Reviewers: confirm each one is an intended behaviour change, not a test rewritten to pass.',
      '',
      ...lines.map((line) => `- ${line}`),
      '',
    ].join('\n'),
  );
}
