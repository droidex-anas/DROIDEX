import assert from 'node:assert/strict';
import test from 'node:test';
import { chipNamedBy, composerMenu, composerTrigger, type MenuEntry } from './menuItems';
import { VISUALIZE_COMMAND } from '../../lib/composePrompt';
import type { SlashCommand } from '../ComposerMenu';
import type { ProviderKind, SkillInfo } from '../../types/bridge';

const command = (cmd: string): SlashCommand => ({
  cmd,
  desc: '',
  icon: () => null,
  run: () => undefined,
});

const commands = [command('/compact'), command('/model'), command('/review')];

const row = (
  name: string,
  overrides: Partial<SkillInfo> & { provider?: ProviderKind } = {},
): SkillInfo => ({
  provider: 'droid',
  kind: 'skill',
  name,
  description: '',
  execution: 'harness',
  location: 'personal',
  filePath: `/skills/${name}/SKILL.md`,
  ...overrides,
});

// Labels read as "Section:" so a section's presence and order are part of the
// assertion; rows read as their own name.
const painted = (entries: MenuEntry[]) =>
  entries.map((entry) => {
    if (entry.kind !== 'row') return `${entry.text}:`;
    switch (entry.item.type) {
      case 'command':
        return entry.item.command.cmd;
      case 'catalog':
        return entry.item.item.name;
      case 'file':
        return entry.item.path;
    }
  });

const menuFor = (text: string, catalog: SkillInfo[] = [], files: string[] = []) => {
  const trigger = composerTrigger(text, text.length);
  assert.ok(trigger, `expected a trigger in ${JSON.stringify(text)}`);
  return composerMenu(trigger, { commands, catalog, files });
};

const rowsFor = (text: string, catalog: SkillInfo[] = [], files: string[] = []) =>
  painted(menuFor(text, catalog, files).entries).filter((label) => !label.endsWith(':'));

test('a slash token opens the menu on what follows it', () => {
  assert.deepEqual(composerTrigger('/rev', 4), {
    kind: 'slash',
    query: 'rev',
    start: 0,
    end: 4,
  });
  assert.deepEqual(composerTrigger('fix the bug @src/ma', 19), {
    kind: 'file',
    query: 'src/ma',
    start: 12,
    end: 19,
  });
  // Only the token the caret is inside opens a menu.
  assert.equal(composerTrigger('/review the diff', 16), null);
  assert.equal(composerTrigger('an email@example.com', 20), null);
});

test('the section holding the better match leads, and each section stays ranked', () => {
  const catalog = [
    row('roast', { description: 'Review code and roast it' }),
    row('review', { description: 'Review code changes' }),
  ];
  // Prefixed by both kinds, commands keep the lead they have always had, and
  // the skill named for the query leads the ones that only mention it.
  assert.deepEqual(rowsFor('/rev', catalog), ['/review', 'review', 'roast']);
  // Commands match on their name alone, so a description mentioning the query
  // does not put a command in the list.
  assert.deepEqual(rowsFor('/comp', catalog), ['/compact']);
});

test('a fully typed name narrows the menu to it, and a space stages a named skill', () => {
  const catalog = [
    row('roast', { description: 'Review code and roast it' }),
    row('mod', { description: 'Modify a file' }),
  ];
  assert.deepEqual(rowsFor('/mod', catalog), ['mod']);
  assert.deepEqual(rowsFor('/Model', catalog), ['/model']);

  const chipFor = (text: string, extra: SlashCommand[] = []) => {
    const trigger = composerTrigger(text, text.length);
    assert.ok(trigger);
    const menu = composerMenu(trigger, { commands: [...commands, ...extra], catalog, files: [] });
    return chipNamedBy(trigger, menu);
  };
  assert.deepEqual(chipFor('/mod'), { type: 'catalog', item: catalog[1] });
  const visualize = command(VISUALIZE_COMMAND.cmd);
  assert.deepEqual(chipFor('/visualize', [visualize]), { type: 'command', command: visualize });
  // Other commands keep the space as text, and a partial name is not a choice yet.
  assert.equal(chipFor('/model'), null);
  assert.equal(chipFor('/roa'), null);
});

test("a harness's commands follow the app's own, and skills read by scope", () => {
  const catalog = [
    row('security-review', { kind: 'command', provider: 'claude', scope: 'system' }),
    row('deploy', { scope: 'repo' }),
    row('notes', { scope: 'user' }),
    row('atomic-agents:create', { scope: 'atomic-agents' }),
    row('atomic-agents', {
      kind: 'plugin',
      scope: 'system',
      displayName: 'Atomic Agents',
      filePath: 'plugin://atomic-agents',
    }),
  ];
  assert.deepEqual(painted(menuFor('/', catalog).entries), [
    'Commands:',
    '/compact',
    '/model',
    '/review',
    'security-review',
    'Skills:',
    'deploy',
    'notes',
    'Atomic Agents:',
    'atomic-agents:create',
  ]);
});

test('a row the harness will not let a prompt invoke is not offered', () => {
  const catalog = [
    row('hidden', { userInvocable: false }),
    row('off', { enabled: false }),
    row('usable'),
  ];
  assert.deepEqual(rowsFor('/', catalog), ['/compact', '/model', '/review', 'usable']);
});

test('mentions list files, then the apps and plugins the harness published', () => {
  const catalog = [
    row('linear', { kind: 'app', displayName: 'Linear', filePath: 'app://linear' }),
    row('greptile', { kind: 'plugin', filePath: 'plugin://greptile' }),
  ];
  assert.deepEqual(painted(menuFor('@', catalog, ['src/main.ts']).entries), [
    'Files:',
    'src/main.ts',
    'Apps:',
    'linear',
    'Plugins:',
    'greptile',
  ]);
  // An app named exactly for the query leads the files that merely contain it.
  assert.deepEqual(rowsFor('@linear', catalog, ['src/linear-notes.ts']), [
    'linear',
    'src/linear-notes.ts',
  ]);
});

test('a query that matches nothing offers no rows, which closes the menu', () => {
  assert.deepEqual(rowsFor('/zzz', [row('review')]), []);
});

test('file rows lead with a matching name and stay within the row cap', () => {
  const files = ['src/lib/other/main.ts', 'src/main.ts', 'docs/mainframe.md'];
  assert.deepEqual(rowsFor('@main', [], files), [
    'src/main.ts',
    'docs/mainframe.md',
    'src/lib/other/main.ts',
  ]);
  const many = Array.from({ length: 80 }, (_, i) => `src/file${String(i)}.ts`);
  assert.equal(rowsFor('@file', [], many).length, 50);
});

test('catalog rows stay within the row cap', () => {
  const many = Array.from({ length: 60 }, (_, i) => row(`skill-${String(i)}`));
  const rows = rowsFor('/skill-', many);
  assert.equal(rows.filter((label) => label.startsWith('skill-')).length, 40);
});
