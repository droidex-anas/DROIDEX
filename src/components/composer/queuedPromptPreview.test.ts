import test from 'node:test';
import assert from 'node:assert/strict';
import { queuedPromptPreview } from './queuedPromptPreview';

test('a preview collapses whitespace and cuts long prompts at a word boundary', () => {
  assert.equal(queuedPromptPreview('Fix the login redirect'), 'Fix the login redirect');
  assert.equal(
    queuedPromptPreview('Fix the bug\n\n  then   add a test\n'),
    'Fix the bug then add a test',
  );
  assert.equal(queuedPromptPreview('word '.repeat(60), 20), 'word word word word…');
  // A long unbroken run has no boundary, so it is cut at the limit.
  assert.equal(queuedPromptPreview('x'.repeat(200), 20), `${'x'.repeat(20)}…`);
});
