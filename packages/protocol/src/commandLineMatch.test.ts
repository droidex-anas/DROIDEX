import assert from 'node:assert/strict';
import test from 'node:test';
import { commandLineContains } from './commandLineMatch.js';

const cases: [string, string, string, boolean][] = [
  ['exact command', 'npm run dev', 'npm run dev', true],
  ['leading token boundary', '/usr/bin/env npm run dev', 'npm run dev', true],
  ['trailing token boundary', 'npm run dev --host', 'npm run dev', true],
  ['whitespace boundaries', '\tnpm run dev\n', 'npm run dev', true],
  ['command absent', 'node server.js', 'npm run dev', false],
  ['partial leading token', 'my-npm run dev', 'npm run dev', false],
  ['partial trailing token', 'npm run dev:api', 'npm run dev', false],
  ['MCP command suffix', 'npx -y some-mcp-two', 'npx -y some-mcp', false],
  ['later whole-token occurrence', 'npm run dev:api && npm run dev', 'npm run dev', true],
  ['literal metacharacters', 'node app.js --pattern .*', '--pattern .*', true],
  ['case sensitive', 'NPM run dev', 'npm run dev', false],
  ['internal whitespace is literal', 'npm\trun dev', 'npm run dev', false],
  ['empty command line', '', 'npm run dev', false],
  ['empty needle at a token', 'npm', '', false],
  ['empty needle at whitespace', ' npm', '', true],
  ['both empty', '', '', true],
];

for (const [name, commandLine, needle, expected] of cases) {
  test(name, () => {
    assert.equal(commandLineContains(commandLine, needle), expected);
  });
}
