import assert from 'node:assert/strict';
import test from 'node:test';
import { lastLines } from './textTail';

test('lastLines matches split for edge lines and lines longer than one search window', () => {
  const long = 'x'.repeat(5_000);
  const texts = [
    '',
    'one line',
    '\n',
    '\nleading',
    'a\n\nb\n',
    'crlf\r\nlines\r\n',
    `${long}\n${long}`,
    `short\n${long}`,
    `${'line\n'.repeat(500)}${long}`,
  ];
  for (const text of texts) {
    for (const count of [1, 3, 600]) {
      assert.deepEqual(
        lastLines(text, count),
        text.split('\n').slice(-count),
        JSON.stringify([text.slice(0, 20), count]),
      );
    }
  }
});
