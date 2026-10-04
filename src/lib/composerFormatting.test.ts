import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyDraftFormat,
  insertBlock,
  insertLink,
  toggleHeading,
  toggleLinePrefix,
  toggleWrap,
} from './composerFormatting';

const selectionOf = (edit: { selectionStart: number; selectionEnd: number }) => [
  edit.selectionStart,
  edit.selectionEnd,
];

test('toggleWrap wraps, unwraps, and drops an empty caret between the markers', () => {
  assert.deepEqual(toggleWrap('fix the bug now', 8, 11, '**'), {
    text: 'fix the **bug** now',
    selectionStart: 10,
    selectionEnd: 13,
  });

  const unwrapped = toggleWrap('fix the **bug** now', 8, 15, '**');
  assert.equal(unwrapped.text, 'fix the bug now');
  assert.deepEqual(selectionOf(unwrapped), [8, 11]);

  const empty = toggleWrap('go here', 3, 3, '`');
  assert.equal(empty.text, 'go ``here');
  assert.deepEqual(selectionOf(empty), [4, 4]);
});

test('toggleLinePrefix toggles only the overlapped lines and numbers ordered lists', () => {
  const added = toggleLinePrefix('alpha\nbeta\ngamma', 0, 16, '- ');
  assert.equal(added.text, '- alpha\n- beta\n- gamma');
  assert.deepEqual(selectionOf(added), [0, 22]);

  // [text, start, end, prefix, ordered, expected]
  const cases: Array<[string, number, number, string, boolean, string]> = [
    ['- alpha\n- beta', 0, 14, '- ', false, 'alpha\nbeta'],
    ['alpha\nbeta\ngamma', 6, 10, '- ', false, 'alpha\n- beta\ngamma'],
    ['alpha\nbeta', 0, 10, '1. ', true, '1. alpha\n2. beta'],
    ['1. alpha\n22. beta', 0, 16, '1. ', true, 'alpha\nbeta'],
    // A blank draft starts a list; blank lines elsewhere are skipped.
    ['', 0, 0, '- ', false, '- '],
    ['', 0, 0, '1. ', true, '1. '],
    ['a\n\nb', 0, 4, '- ', false, '- a\n\n- b'],
    ['- ', 0, 2, '- ', false, ''],
  ];
  for (const [text, start, end, prefix, ordered, expected] of cases) {
    assert.equal(toggleLinePrefix(text, start, end, prefix, ordered).text, expected, text);
  }
});

test('toggleHeading sets, replaces, and removes a level without touching hashtags', () => {
  const set = toggleHeading('release notes', 8, 8, 2);
  assert.equal(set.text, '## release notes');
  assert.deepEqual(selectionOf(set), [11, 11]);
  assert.equal(toggleHeading('## release notes', 4, 4, 3).text, '### release notes');
  assert.equal(toggleHeading('## release notes', 4, 4, 2).text, 'release notes');
  assert.equal(toggleHeading('#release notes', 0, 0, 1).text, '# #release notes');
});

test('insertLink selects the url placeholder, or the label when nothing is selected', () => {
  const wrapped = insertLink('see the docs for more', 8, 12);
  assert.equal(wrapped.text, 'see the [docs](url) for more');
  assert.deepEqual(selectionOf(wrapped), [15, 18]);

  const empty = insertLink('see ', 4, 4);
  assert.equal(empty.text, 'see [label](url)');
  // Exactly the label, so typing over it keeps the closing bracket.
  assert.deepEqual(selectionOf(empty), [5, 10]);
});

test('insertBlock separates the snippet from surrounding prose', () => {
  const edit = insertBlock('beforeafter', 6, 6, '| a | b |', 2);
  assert.equal(edit.text, 'before\n| a | b |\nafter');
  assert.deepEqual(selectionOf(edit), [9, 9]);
  // At the very start no leading newline is needed.
  assert.equal(insertBlock('tail', 0, 0, '| a |', 0).text, '| a |\ntail');
});

test('applyDraftFormat routes each toolbar action', () => {
  assert.equal(applyDraftFormat('word', 0, 4, 'bold').text, '**word**');
  assert.equal(applyDraftFormat('word', 0, 4, 'italic').text, '*word*');
  assert.equal(applyDraftFormat('word', 0, 4, 'inlineCode').text, '`word`');
  assert.equal(applyDraftFormat('line', 0, 4, 'heading1').text, '# line');
  assert.equal(applyDraftFormat('line', 0, 4, 'bulletList').text, '- line');
  assert.equal(applyDraftFormat('line', 0, 4, 'taskList').text, '- [ ] line');
  assert.equal(applyDraftFormat('line', 0, 4, 'quote').text, '> line');
  assert.equal(
    applyDraftFormat('', 0, 0, 'table').text,
    '| Header | Header |\n| --- | --- |\n| Cell | Cell |',
  );
  assert.equal(applyDraftFormat('', 0, 0, 'codeBlock').text, '```\n\n```');
});
