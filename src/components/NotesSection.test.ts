import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NotesPanel } from './NotesSection';
import type { NoteTag } from '../lib/notesTags';
import type { SessionNote } from '../lib/sessionNotes';

const noop = () => undefined;

const note = (id: string, text: string, usedAt: number | null = null): SessionNote => ({
  id,
  text,
  createdAt: 1,
  usedAt,
});

// The pad is collapsed by default in the app; tests that exercise its content
// opt into the open state explicitly.
const render = (notes: SessionNote[], draft = '', tag: NoteTag | null = null, defaultOpen = true) =>
  renderToStaticMarkup(
    createElement(NotesPanel, {
      notes,
      draft,
      onDraftChange: noop,
      onSave: noop,
      onUse: noop,
      onRemove: noop,
      tag,
      onTagSelect: noop,
      onTagClear: noop,
      defaultOpen,
    }),
  );

test('the pad starts collapsed so mounting it never reshuffles the panel', () => {
  const html = render([note('a', 'Ask about the rollout')], '', null, false);
  assert.match(html, /aria-expanded="false"/);
  // The header stays informative; the pad and the list mount only on open.
  assert.match(html, /0\/1 sent/);
  assert.doesNotMatch(html, /Write a note to use later/);
  assert.doesNotMatch(html, /Ask about the rollout/);
});

test('shows the empty checklist state when no notes are parked', () => {
  const html = render([]);
  assert.match(html, /No notes yet/);
  // With no notes there is no checklist fraction trailing the header.
  assert.doesNotMatch(html, /sent/);
  // The notepad box carries the save hint in its placeholder, no send button.
  assert.match(html, /Write a note to use later/);
  assert.match(html, /Enter to save/);
  assert.doesNotMatch(html, /Send to composer/);
});

test('saved notes stack as checklist lines and the header counts the sent ones', () => {
  const html = render([
    note('a', 'Ask about the rollout', 123),
    note('b', 'Check migration drift'),
  ]);
  assert.match(html, /Ask about the rollout/);
  assert.match(html, /Check migration drift/);
  // One send-to-composer target and one delete button per note.
  assert.equal(html.match(/Send to composer/g)?.length, 2);
  assert.equal(html.match(/Delete note/g)?.length, 2);
  assert.match(html, /1\/2 sent/);
  assert.doesNotMatch(html, /No notes yet/);
});

test('a note starting with a known @tag shows a chip and stripped text', () => {
  const html = render([note('a', '@bug Login crashes on save')]);
  assert.match(html, />bug</);
  assert.match(html, /Login crashes on save/);
  // The raw token is not duplicated next to the chip.
  assert.doesNotMatch(html, /@bug/);
  // Untagged notes render their text untouched.
  const plain = render([note('b', 'plain note')]);
  assert.match(plain, /plain note/);
  assert.doesNotMatch(plain, />bug</);
});

test('typing @ in the pad opens the tag menu with every option and hint', () => {
  const html = render([], '@');
  assert.match(html, />bug</);
  assert.match(html, />next</);
  assert.match(html, />idea</);
  assert.match(html, />constraint</);
  assert.match(html, /something broken/);
  // The menu sits in flow directly below the pad: an absolute overlay is
  // clipped by the collapse container's overflow-hidden whenever the note
  // list is shorter than the menu (the empty first-run state).
  assert.ok(html.indexOf('Write a note to use later') < html.indexOf('something broken'));

  // The menu narrows as the @query grows.
  const narrowed = render([], '@n');
  assert.match(narrowed, />next</);
  assert.doesNotMatch(narrowed, />idea</);
  assert.doesNotMatch(narrowed, />bug</);
});

test('a selected tag chips inside the pad and swaps the placeholder', () => {
  const html = render([], '', 'bug');
  assert.match(html, />bug</);
  assert.match(html, /aria-label="Remove tag"/);
  assert.match(html, /Add the detail/);
  // A chipped tag keeps the @ menu closed even with an empty draft.
  assert.doesNotMatch(html, /something broken/);
});
