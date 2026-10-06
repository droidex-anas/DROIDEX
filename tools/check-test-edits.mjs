// Guards the regression record against agents rewriting tests to make a code
// change pass.
//
// Reports, and never fails on findings: when a change edits source and also
// removes lines from tests that already existed, or adds a skip, only, or todo,
// each such test file gets a warning annotation and a job summary line so a
// reviewer can confirm the behaviour change was intended.
//
// Skip detection is advisory syntax matching, not evaluation. Aliases,
// computed methods, and template interpolations can evade it.
// Regex literals can produce false positives.
//
// Usage: node tools/check-test-edits.mjs <base-ref> (or set TEST_EDITS_BASE)
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const args = process.argv.slice(2);
const base = args[0] ?? process.env.TEST_EDITS_BASE;
if (args.length > 1 || !base?.trim() || base.startsWith('-')) {
  console.error(
    'Pass the actual PR base: npm run quality:test-edits -- <base-ref>, or set TEST_EDITS_BASE.',
  );
  process.exit(1);
}

const TEST_FILE =
  /\.(test|spec)\.(ts|tsx|cjs|mjs)$|^sidecar\/src\/testing\/|^sidecar\/regression\//;
const SOURCE_FILE = /^(src|sidecar\/src|electron|packages\/[^/]+\/src)\/.*\.(ts|tsx|cjs|mjs)$/;
const ASSERTION = /\bassert\b|\bexpect\(|\bt\.(equal|deepEqual|ok|throws|rejects)\b/;
const NON_CODE =
  /'(?:\\[\s\S]|[^'\\])*'|"(?:\\[\s\S]|[^"\\])*"|`(?:\\[\s\S]|[^`\\])*`|\/\/[^\n]*|\/\*[\s\S]*?\*\//g;
const SKIP =
  /\.(?:skip|only|todo|skipIf|runIf)\s*(?=[.(])|\b(?:skip|only|todo)\s*:\s*(?!(?:false|null|undefined|0)\s*[,}])(?=\S)/g;

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

let mergeBase;
try {
  mergeBase = git('merge-base', '--', base, 'HEAD').trim();
} catch {
  console.error(
    `Cannot compare with ${base}. Pass an existing base ref that shares history with HEAD.`,
  );
  process.exit(1);
}
// Renames count as edits of an existing file, so a moved-and-rewritten test is
// still compared against its old content.
const fields = git('diff', '--name-status', '-z', '-M', mergeBase, 'HEAD').split('\0');
const changes = [];
for (let index = 0; index < fields.length - 1; ) {
  const status = fields[index++];
  const oldPath = fields[index++];
  const file = status.startsWith('R') ? fields[index++] : oldPath;
  changes.push({ status: status[0], oldPath, file });
}

const sourceChanged = changes.some(({ oldPath, file }) =>
  [oldPath, file].some((path) => SOURCE_FILE.test(path) && !TEST_FILE.test(path)),
);
const flagged = [];

for (const { status, oldPath, file } of changes) {
  if (!sourceChanged || (!TEST_FILE.test(oldPath) && !TEST_FILE.test(file))) continue;
  const renamedOutOfTests = status === 'R' && TEST_FILE.test(oldPath) && !TEST_FILE.test(file);
  const diff = git('diff', '--unified=0', '-M', mergeBase, 'HEAD', '--', oldPath, file).split('\n');
  const removed = diff.filter(
    (line) => line.startsWith('-') && !line.startsWith('---') && line.slice(1).trim(),
  );
  const addedLines = new Set();
  let lineNumber = 0;
  for (const line of diff) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) lineNumber = Number(hunk[1]);
    else if (line.startsWith('+') && !line.startsWith('+++')) addedLines.add(lineNumber++);
    else if (line.startsWith(' ')) lineNumber++;
  }
  let skips = 0;
  if (status !== 'D' && addedLines.size > 0) {
    const contents = git('show', `HEAD:${file}`);
    const code = contents.replace(NON_CODE, (text) => text.replace(/[^\n]/g, ' '));
    for (const match of code.matchAll(SKIP)) {
      const firstLine = code.slice(0, match.index).split('\n').length;
      const lastLine = firstLine + match[0].split('\n').length - 1;
      for (let line = firstLine; line <= lastLine; line++) {
        if (!addedLines.has(line)) continue;
        skips++;
        break;
      }
    }
  }
  if (removed.length === 0 && skips === 0 && !renamedOutOfTests) continue;
  const assertions = removed.filter((line) => ASSERTION.test(line)).length;
  flagged.push({
    file,
    oldPath,
    removed: removed.length,
    assertions,
    skips,
    deleted: status === 'D',
    renamedOutOfTests,
  });
}

if (!sourceChanged || flagged.length === 0) {
  console.log(
    'No existing test lines were removed or potential skips added alongside source changes.',
  );
  process.exit(0);
}

const lines = flagged.map(
  ({ file, oldPath, removed, assertions, skips, deleted, renamedOutOfTests }) => {
    const parts = [`${removed} line(s) removed, ${assertions} on an assertion line`];
    if (skips > 0) parts.push(`${skips} potential skip/only/todo added`);
    if (deleted) parts.push('file deleted');
    if (renamedOutOfTests) parts.push('renamed outside test discovery');
    if (oldPath !== file) parts.push(`renamed from ${oldPath}`);
    return { file, detail: parts.join(', ') };
  },
);
for (const { file, detail } of lines) {
  console.log(
    `::warning file=${file}::Test edited in a change that also edits source (${detail}). Confirm the behaviour change is intended.`,
  );
}
summarize(
  'Tests edited alongside source changes',
  'Reviewers: confirm each one is an intended behaviour change, not a test rewritten to pass.',
  lines.map(({ file, detail }) => `${file}: ${detail}`),
);
