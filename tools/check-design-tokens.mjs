// Design-token ratchet: counts the lint rule's violations per file and
// category (npm run quality:design-tokens) and compares them with the
// committed baseline in tools/design-token-baseline.json. The baseline only
// shrinks: a rise fails, and a fall fails until the baseline is lowered with
// `npm run quality:design-tokens -- --update-baseline` (the analogue of
// eslint's --prune-suppressions, which also refuses to write a rise).
// `--update-baseline --force` rewrites through a rise once, for a deliberate
// change to the matchers; the raise is printed so the pull request owns it.
// Surface steps of the design-system migration remove violations, run the
// update, and commit the lower numbers.

import { Linter } from 'eslint';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import tseslint from 'typescript-eslint';
import designTokensRule, { EXEMPT_FILES } from './eslint/design-tokens.mjs';

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
};
const updateBaseline = args.includes('--update-baseline');
const force = args.includes('--force');
const root = resolve(option('root') ?? repoRoot);
const baselinePath = resolve(option('baseline') ?? join(root, 'tools', 'design-token-baseline.json'));

function walkTsxFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return walkTsxFiles(path);
    return entry.endsWith('.tsx') && !/\.(test|spec)\.tsx$/.test(entry) ? [path] : [];
  });
}

const exempt = new Set(EXEMPT_FILES.map((file) => join(root, file)));
const files = walkTsxFiles(join(root, 'src'))
  .filter((file) => !exempt.has(file))
  .sort();

// Baseline keys use forward slashes on every platform.
const toKey = (file) => relative(root, file).replaceAll('\\', '/');

// Same rule as eslint.config.js, without the baseline option, so every
// violation is reported and the counts here can never drift from lint's.
// Reasoned inline disables for the spec's semantic edges apply in both scans.
// Unused-disable reports are off because inline directives for other rules
// never run in this minimal config.
const linter = new Linter({ configType: 'flat' });
const lintConfig = {
  plugins: { 'design-policy': { rules: { 'design-tokens': designTokensRule } } },
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { ecmaFeatures: { jsx: true }, ecmaVersion: 'latest', sourceType: 'module' },
  },
  linterOptions: { reportUnusedDisableDirectives: 'off' },
  rules: { 'design-policy/design-tokens': 'error' },
};

const counts = new Map();
const failures = [];
for (const file of files) {
  const messages = linter.verify(readFileSync(file, 'utf8'), lintConfig, { filePath: file });
  const parseError = messages.find((message) => message.ruleId === null);
  if (parseError) {
    failures.push(`${toKey(file)}: ${parseError.message}`);
    continue;
  }
  // Directive and unknown-rule notices from this minimal config carry other
  // rule ids; only this rule's reports are the violation count.
  const fileCounts = {};
  for (const message of messages.filter((m) => m.ruleId === 'design-policy/design-tokens')) {
    fileCounts[message.messageId] = (fileCounts[message.messageId] ?? 0) + 1;
  }
  if (Object.keys(fileCounts).length > 0) {
    counts.set(
      toKey(file),
      Object.fromEntries(Object.keys(fileCounts).sort().map((category) => [category, fileCounts[category]])),
    );
  }
}
if (failures.length > 0) {
  console.error('Could not parse these files while counting design-token violations:\n' + failures.join('\n'));
  process.exit(1);
}

const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : {};

const rises = [];
const falls = [];
for (const file of [...new Set([...Object.keys(baseline), ...counts.keys()])].sort()) {
  const fileBaseline = baseline[file] ?? {};
  const fileCounts = counts.get(file) ?? {};
  for (const category of [...new Set([...Object.keys(fileBaseline), ...Object.keys(fileCounts)])].sort()) {
    const was = fileBaseline[category] ?? 0;
    const now = fileCounts[category] ?? 0;
    if (now > was) rises.push(`${file}: ${category} ${was} → ${now} (+${now - was})`);
    if (now < was) falls.push(`${file}: ${category} ${was} → ${now} (-${was - now})`);
  }
}

const totals = {};
for (const fileCounts of counts.values()) {
  for (const [category, count] of Object.entries(fileCounts)) {
    totals[category] = (totals[category] ?? 0) + count;
  }
}
const totalsLine = Object.keys(totals)
  .sort()
  .map((category) => `${category} ${totals[category]}`)
  .join(', ');

if (updateBaseline) {
  if (rises.length > 0 && !force) {
    console.error(
      'Refusing to raise the design-token baseline:\n' +
        rises.join('\n') +
        '\nThe baseline only moves down. Fix the new violations, or pass --force for a deliberate matcher change.',
    );
    process.exit(1);
  }
  writeFileSync(
    baselinePath,
    JSON.stringify(Object.fromEntries([...counts.keys()].sort().map((file) => [file, counts.get(file)])), null, 2) +
      '\n',
  );
  for (const rise of rises) console.warn(`baseline raised: ${rise}`);
  for (const fall of falls) console.log(`baseline lowered: ${fall}`);
  console.log(`Wrote ${baselinePath}: ${counts.size} files, ${totalsLine}.`);
  process.exit(0);
}

if (rises.length > 0) {
  console.error('Design-token violations may only decrease:\n' + rises.join('\n'));
  process.exit(1);
}
if (falls.length > 0) {
  console.error(
    'The design-token baseline is stale (counts only fall):\n' +
      falls.join('\n') +
      '\nLower it with: npm run quality:design-tokens -- --update-baseline',
  );
  process.exit(1);
}
console.log(`Design-token baseline current: ${counts.size} files, ${totalsLine}.`);
