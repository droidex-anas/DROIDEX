import assert from 'node:assert/strict';
import test from 'node:test';
import { ESLint } from 'eslint';

test('test lint rejects resolving delays while preserving rejection deadlines and event-loop yields', async () => {
  const eslint = new ESLint();
  const [result] = await eslint.lintText(
    `
      new Promise((finish, resolve) => setTimeout(resolve, 50));
      new Promise((finish) => setTimeout(finish, 0));
      new Promise((finish) => globalThis.setTimeout(function () { finish(); }, 50, 'value'));
      new Promise((finish, reject) => { function deadline() { reject(); } setTimeout(deadline, 50); });
      new Promise((finish) => { function done(finish) { finish(); } setTimeout(done, 50); });
      new Promise((finish) => { function done() { finish(); } setTimeout(done, 50); });
      new Promise((finish) => { const done = () => finish(); setTimeout(done, 50); });
    `,
    { filePath: 'tools/eslint/delay.spec.ts' },
  );
  assert.deepEqual(
    result.messages
      .filter((message) => message.ruleId === 'test-policy/no-sleep')
      .map((message) => message.line),
    [4, 7, 8],
  );
});
