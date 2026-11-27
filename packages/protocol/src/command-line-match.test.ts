import assert from 'node:assert/strict';
import test from 'node:test';
import { commandLineContains } from './command-line-match.js';

const cases: [string, string, string, boolean][] = [
  [
    'whole-token match inside a longer line',
    '/usr/bin/env npm run dev --host',
    'npm run dev',
    true,
  ],
  ['whitespace boundaries', '\tnpm run dev\n', 'npm run dev', true],
  ['partial leading token', 'my-npm run dev', 'npm run dev', false],
  ['partial trailing token', 'npm run dev:api', 'npm run dev', false],
  ['later whole-token occurrence', 'npm run dev:api && npm run dev', 'npm run dev', true],
];

for (const [name, commandLine, needle, expected] of cases) {
  test(name, () => {
    assert.equal(commandLineContains(commandLine, needle), expected);
  });
}
