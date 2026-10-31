import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DocumentNote, DocumentSection } from '../designSystemDocumentProtocol';
import {
  changeCount,
  currentDraft,
  discardDraft,
  editDraft,
  type DocumentDraft,
} from './documentDraft';
import { draftDiff, tokenKey, withRemoved } from './documentSections';
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
