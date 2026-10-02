import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NOTE_TAGS,
  composeNoteText,
  exactNoteTag,
  matchingNoteTags,
  noteTagMenu,
  noteTextWithoutTag,
  parseNoteTag,
} from './notesTags';

test('a note tag is only a leading known @token followed by text, and round-trips', () => {
  assert.equal(parseNoteTag('@bug Login crashes on save'), 'bug');
  assert.equal(parseNoteTag('@NEXT ship the panel'), 'next');
  assert.equal(parseNoteTag('@john review this'), null);
  assert.equal(parseNoteTag('ping me @bug later'), null);
  assert.equal(parseNoteTag('plain note'), null);
  assert.equal(parseNoteTag('@bug'), null);

  assert.equal(noteTextWithoutTag('@idea make notes float'), 'make notes float');
  assert.equal(noteTextWithoutTag('plain note'), 'plain note');

  assert.equal(composeNoteText(null, 'plain note'), 'plain note');
  assert.equal(composeNoteText('bug', 'fix the redirect'), '@bug fix the redirect');
  assert.equal(parseNoteTag(composeNoteText('idea', 'make notes float')), 'idea');
});

test('the tag menu matches by prefix for a lone @token and chips only an exact tag', () => {
  assert.deepEqual(matchingNoteTags(''), [...NOTE_TAGS]);
  assert.deepEqual(matchingNoteTags('CON'), ['constraint']);
  assert.deepEqual(matchingNoteTags('zzz'), []);

  assert.deepEqual(noteTagMenu('@', null), { query: '', matching: [...NOTE_TAGS] });
  assert.deepEqual(noteTagMenu('@b', null), { query: 'b', matching: ['bug'] });
  // A draft with a body is no longer a tag query, and a chipped tag closes the menu.
  assert.deepEqual(noteTagMenu('@bug with body', null), { query: undefined, matching: [] });
  assert.deepEqual(noteTagMenu('@', 'idea'), { query: undefined, matching: [] });
  assert.deepEqual(noteTagMenu('plain', null), { query: undefined, matching: [] });

  assert.equal(exactNoteTag('BUG', ['bug']), 'bug');
  assert.equal(exactNoteTag('b', ['bug']), null);
  assert.equal(exactNoteTag(undefined, []), null);
});
