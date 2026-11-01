import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyDocumentChanges,
  documentChangesSchema,
  type DocumentChange,
} from './designSystemEdits.js';
import type { DocumentSection } from './designSystemDocument.js';
import { OPENAI_INSPIRED_DESIGN_SYSTEM } from './presets/openai-inspired.js';

const base = OPENAI_INSPIRED_DESIGN_SYSTEM.sections;

function apply(...changes: DocumentChange[]): DocumentSection[] {
  return applyDocumentChanges(base, changes);
}

function items(sections: DocumentSection[]) {
  return sections.flatMap((section) => section.items.map((item) => ({ section, item })));
}

function token(sections: DocumentSection[], name: string) {
  for (const { section, item } of items(sections)) {
    if (item.kind !== 'group') continue;
    const found = item.tokens.find((entry) => entry.name === name);
    if (found) return { section: section.id, group: item.title, token: found };
  }
  return null;
}

test('changes find tokens, notes and previews by their natural keys and keep their ids', () => {
  const before = items(base);
  const note = before.find(({ item }) => item.kind === 'note')?.item;
  const preview = before.find(({ item }) => item.kind === 'preview')?.item;
  assert.ok(note?.kind === 'note' && preview?.kind === 'preview');
  const accent = token(base, '--ds-accent');
  assert.ok(accent);

  const changed = apply(
    { set: 'token', name: '--ds-accent', light: '#c2410c' },
    { set: 'token', name: '--ds-accent', note: 'Primary actions only.' },
    { set: 'note', label: note.label, body: 'Shorter rules.' },
    { set: 'preview', title: preview.title, example: preview.example, width: 640, height: 320 },
  );

  const darkBefore = 'value' in accent.token ? accent.token.value : accent.token.dark;
  assert.deepEqual(token(changed, '--ds-accent'), {
    section: accent.section,
    group: accent.group,
    token: {
      name: '--ds-accent',
      note: 'Primary actions only.',
      light: '#c2410c',
      dark: darkBefore,
    },
  });
  const after = items(changed).map(({ item }) => item);
  assert.deepEqual(
    after.find((item) => item.id === note.id),
    { ...note, body: 'Shorter rules.' },
  );
  assert.deepEqual(
    after.find((item) => item.id === preview.id),
    { ...preview, width: 640, height: 320 },
  );
  assert.equal(after.length, before.length);
  assert.deepEqual(base, OPENAI_INSPIRED_DESIGN_SYSTEM.sections, 'the base is not changed');
});

test('Size and Z index sections are created between Shadows and Motion', () => {
  const changed = apply(
    { set: 'token', name: '--ds-z-popover', value: '1000', section: 'z-index', group: 'Layers' },
    { set: 'token', name: '--ds-control-md', value: '32px', section: 'size', group: 'Controls' },
  );
  const titles = changed.map((section) => section.title);
  assert.deepEqual(titles.slice(titles.indexOf('Shadows'), titles.indexOf('Motion') + 1), [
    'Shadows',
    'Size',
    'Z index',
    'Motion',
  ]);
});

test('a new token needs its section and group; other new items go to the first section of their kind', () => {
  assert.throws(() => apply({ set: 'token', name: '--ds-glow', value: '#fff' }), {
    code: 'invalid_input',
    message: /section and group/,
  });
  assert.throws(
    () => apply({ set: 'token', name: '--ds-glow', section: 'colors', group: 'Glow' }),
    {
      code: 'invalid_input',
    },
  );

  const changed = apply(
    { set: 'token', name: '--ds-glow', value: '#fff', section: 'tokens', group: 'Brand' },
    {
      set: 'token',
      name: '--ds-glow-soft',
      light: '#eee',
      dark: '#111',
      section: 'tokens',
      group: 'Brand',
    },
    { set: 'note', label: 'voice.md', body: 'Plain words.' },
    { set: 'preview', title: 'Pricing', example: 'Pricing.tsx', width: 960, height: 640 },
    {
      set: 'preview',
      title: 'Settings demo',
      example: 'Settings.tsx',
      width: 960,
      height: 640,
      section: 'overview',
    },
  );

  // Other tokens is created at its canonical place: after Motion, before Components.
  const kinds = changed.map((section) => section.kind);
  assert.equal(kinds.indexOf('tokens'), kinds.indexOf('components') - 1);
  const other = changed.find((section) => section.kind === 'tokens');
  assert.equal(other?.title, 'Other tokens');
  assert.deepEqual(other?.items, [
    {
      kind: 'group',
      id: 'brand',
      title: 'Brand',
      tokens: [
        { name: '--ds-glow', value: '#fff' },
        { name: '--ds-glow-soft', light: '#eee', dark: '#111' },
      ],
    },
  ]);
  const [notes] = changed;
  assert.equal(notes.kind, 'notes');
  assert.deepEqual(notes.items.at(-2), {
    kind: 'note',
    id: 'voice-note',
    label: 'voice.md',
    body: 'Plain words.',
    author: 'agent',
  });
  assert.equal(notes.items.at(-1)?.id, 'settings-demo');
  const components = changed.find((section) => section.kind === 'components');
  assert.equal(components?.items.at(-1)?.id, 'pricing');

  assert.throws(
    () =>
      apply({
        set: 'preview',
        title: 'X',
        example: 'X.tsx',
        width: 400,
        height: 300,
        section: 'colors',
      }),
    { code: 'invalid_input', message: /cannot go in the Colors section/ },
  );
});

test('a change moves an existing token, and removals take items out by key', () => {
  const moved = apply({ set: 'token', name: '--ds-accent', section: 'colors', group: 'Brand' });
  assert.equal(token(moved, '--ds-accent')?.group, 'Brand');

  const status = token(base, '--ds-positive');
  assert.ok(status);
  const statusGroup = items(base).find(
    ({ item }) => item.kind === 'group' && item.title === status.group,
  )?.item;
  assert.ok(statusGroup?.kind === 'group');
  const note = items(base).find(({ item }) => item.kind === 'note')?.item;
  assert.ok(note?.kind === 'note');

  const removed = apply(
    ...statusGroup.tokens.map((entry): DocumentChange => ({ remove: 'token', key: entry.name })),
    { remove: 'note', key: note.label },
  );
  assert.equal(token(removed, '--ds-positive'), null);
  assert.equal(
    items(removed).some(({ item }) => item.id === statusGroup.id || item.id === note.id),
    false,
    'an emptied group goes with its last token',
  );
  assert.throws(() => apply({ remove: 'preview', key: 'Nothing' }), {
    code: 'invalid_input',
    message: /no preview Nothing/,
  });
});

test('a save carries at most 200 changes, and an agent cannot bring an image of its own', () => {
  const change = { set: 'token', name: '--ds-accent', value: '#000' };
  assert.equal(documentChangesSchema.safeParse(Array(200).fill(change)).success, true);
  assert.equal(documentChangesSchema.safeParse(Array(201).fill(change)).success, false);
  assert.throws(() => apply({ set: 'asset', name: 'Logo', assetId: 'a'.repeat(64) }), {
    code: 'invalid_input',
    message: /Only images the user added/,
  });
});
