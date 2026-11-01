import assert from 'node:assert/strict';
import { test } from 'node:test';
import type {
  DocumentNote,
  DocumentSection,
  DocumentToken,
  TokenGroup,
} from '../designSystemDocumentProtocol';
import {
  changeCount,
  currentDraft,
  discardDraft,
  editDraft,
  type DocumentDraft,
} from './documentDraft';
import {
  changedTokenValues,
  changeSummary,
  draftDiff,
  tokenKey,
  withItems,
  withRemoved,
} from './documentSections';
import type { DesignSystemDocumentView } from '../protocol';

const base: DocumentSection[] = [
  {
    kind: 'notes',
    id: 'notes',
    title: 'Notes',
    items: [
      { kind: 'note', id: 'rules', label: '1-rules.md', body: 'Calm.', author: 'user' },
      { kind: 'note', id: 'feel', label: '2-feel.md', body: 'Quiet.', author: 'agent' },
      { kind: 'note', id: 'voice', label: '3-voice.md', body: 'Plain.', author: 'user' },
    ],
  },
  {
    kind: 'colors',
    id: 'colors',
    title: 'Colors',
    items: [
      {
        kind: 'group',
        id: 'surfaces',
        title: 'Surfaces',
        tokens: [
          { name: '--ds-bg', light: '#fff', dark: '#111' },
          { name: '--ds-accent', value: '#36f' },
        ],
      },
    ],
  },
];

const extraNote: DocumentNote = {
  kind: 'note',
  id: 'note-4',
  label: 'note-4.md',
  body: '',
  author: 'user',
};

function kitAt(id: string, version: number): DesignSystemDocumentView {
  return {
    id,
    version,
    latestVersion: version,
    name: 'Kit',
    kind: 'user',
    cover: null,
    sections: base,
    examples: [],
    unmapped: [],
    provenance: null,
    savedAt: null,
    savedBy: null,
    proposal: null,
  };
}

function draftOfKit(id: string): DocumentDraft {
  const draft = currentDraft(id);
  assert.ok(draft, `${id} has a draft`);
  return draft;
}

function noteIds(sections: DocumentSection[]): string[] {
  return sections[0].items.map((item) => item.id);
}

test('edits are marked against the base, and a removed group is one mark', () => {
  const opened = kitAt('marks', 3);
  editDraft(opened, { kind: 'setToken', token: { name: '--ds-accent', value: '#f60' } });
  editDraft(opened, {
    kind: 'addToken',
    groupId: 'surfaces',
    token: { name: '--ds-line', value: '#ddd' },
  });
  editDraft(opened, { kind: 'remove', key: 'feel' });
  editDraft(opened, { kind: 'retitle', id: 'notes', title: 'Rules' });
  const edited = draftOfKit('marks');
  assert.deepEqual(
    draftDiff(base, edited.sections),
    new Map([
      ['notes', 'changed'],
      ['feel', 'removed'],
      [tokenKey('--ds-accent'), 'changed'],
      [tokenKey('--ds-line'), 'added'],
    ]),
  );
  assert.equal(changeCount(edited), 4);

  editDraft(opened, { kind: 'remove', key: 'surfaces' });
  assert.deepEqual(
    draftDiff(base, draftOfKit('marks').sections),
    new Map([
      ['notes', 'changed'],
      ['feel', 'removed'],
      ['surfaces', 'removed'],
    ]),
  );
  discardDraft('marks');
});

test('a note or token moved to another holder, and reordered tokens, are marked changed', () => {
  const [notes, colors] = base;
  const feel = notes.items[1];
  const bg: DocumentToken = { name: '--ds-bg', light: '#fff', dark: '#111' };
  const accent: DocumentToken = { name: '--ds-accent', value: '#36f' };
  const surfaces = (tokens: DocumentToken[]): TokenGroup => ({
    kind: 'group',
    id: 'surfaces',
    title: 'Surfaces',
    tokens,
  });

  const movedNote = [
    withItems(
      notes,
      notes.items.filter((item) => item !== feel),
    ),
    withItems(colors, [surfaces([accent, bg]), feel]),
  ];
  assert.deepEqual(
    draftDiff(base, movedNote),
    new Map([
      ['feel', 'changed'],
      ['surfaces', 'changed'],
    ]),
  );

  const accents: TokenGroup = { kind: 'group', id: 'accents', title: 'Accents', tokens: [accent] };
  const movedToken = [notes, withItems(colors, [surfaces([bg]), accents])];
  assert.deepEqual(
    draftDiff(base, movedToken),
    new Map([
      ['accents', 'added'],
      [tokenKey('--ds-accent'), 'changed'],
    ]),
  );
});

test("a version's summary names a few tokens and counts everything else", () => {
  const before = kitAt('summary', 1);
  const [notes, colors] = base;
  const surfaces = colors.items[0] as TokenGroup;
  const recoloured = (tokens: DocumentToken[]) => [
    withItems(notes, [...notes.items.slice(1), extraNote]),
    withItems(colors, [{ ...surfaces, tokens }]),
  ];
  const accent: DocumentToken = { name: '--ds-accent', value: '#f60' };
  assert.equal(
    changeSummary(before, { ...before, sections: recoloured([surfaces.tokens[0], accent]) }),
    'Accent, 2 notes',
  );
  const many = ['a', 'b', 'c', 'd'].map((name) => ({ name: `--ds-${name}`, value: '1px' }));
  assert.equal(
    changeSummary(before, {
      ...before,
      name: 'Calm kit',
      sections: recoloured([...surfaces.tokens, ...many]),
    }),
    'Name, 4 tokens, 2 notes',
  );
  assert.equal(changeSummary(before, before), 'No changes');
});

test('live previews get only the draft values that differ in their mode and a save would accept', () => {
  const opened = kitAt('tokens', 1);
  editDraft(opened, {
    kind: 'setToken',
    token: { name: '--ds-bg', light: '#fff', dark: '#000' },
  });
  editDraft(opened, {
    kind: 'addToken',
    groupId: 'surfaces',
    token: { name: '--ds-line', value: 'red; color: blue' },
  });
  const { sections } = draftOfKit('tokens');
  assert.equal(draftDiff(base, sections).get(tokenKey('--ds-line')), 'added');
  assert.deepEqual(changedTokenValues(base, sections, 'light'), {});
  assert.deepEqual(changedTokenValues(base, sections, 'dark'), { '--ds-bg': '#000' });
  discardDraft('tokens');
});

test('a removed note shows where it was, Undo puts it back there, and undoing every edit ends the draft', () => {
  const opened = kitAt('undo', 1);
  editDraft(opened, { kind: 'remove', key: 'feel' });
  editDraft(opened, { kind: 'addItem', sectionId: 'notes', item: extraNote });
  const edited = draftOfKit('undo').sections;
  assert.deepEqual(noteIds(edited), ['rules', 'voice', 'note-4']);
  assert.deepEqual(noteIds(withRemoved(base, edited, draftDiff(base, edited))), [
    'rules',
    'feel',
    'voice',
    'note-4',
  ]);

  editDraft(opened, { kind: 'restore', key: 'feel' });
  assert.deepEqual(noteIds(draftOfKit('undo').sections), ['rules', 'feel', 'voice', 'note-4']);
  editDraft(opened, { kind: 'remove', key: 'note-4' });
  assert.equal(currentDraft('undo'), null);
});

test('an item added before another lands in its gap; an unknown anchor appends', () => {
  const opened = kitAt('gaps', 1);
  editDraft(opened, { kind: 'addItem', sectionId: 'notes', item: extraNote, before: 'voice' });
  editDraft(opened, {
    kind: 'addItem',
    sectionId: 'notes',
    item: { ...extraNote, id: 'note-5', label: 'note-5.md' },
    before: 'no-such',
  });
  assert.deepEqual(noteIds(draftOfKit('gaps').sections), [
    'rules',
    'feel',
    'note-4',
    'voice',
    'note-5',
  ]);
  discardDraft('gaps');
});

test('a newer read keeps the draft on its base until Discard', () => {
  editDraft(kitAt('refresh', 2), { kind: 'setName', name: 'Calm kit' });
  const newer = kitAt('refresh', 3);
  editDraft(newer, { kind: 'setToken', token: { name: '--ds-accent', value: '#f60' } });
  const kept = draftOfKit('refresh');
  assert.equal(kept.base.version, 2);
  assert.equal(kept.name, 'Calm kit');
  assert.equal(changeCount(kept), 2);

  discardDraft('refresh');
  assert.equal(currentDraft('refresh'), null);
  editDraft(newer, { kind: 'remove', key: 'rules' });
  const fresh = draftOfKit('refresh');
  assert.equal(fresh.base.version, 3);
  assert.equal(fresh.name, 'Kit');
  discardDraft('refresh');
});
