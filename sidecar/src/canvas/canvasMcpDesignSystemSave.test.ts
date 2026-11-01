import assert from 'node:assert/strict';
import test from 'node:test';
import { openTurn } from '../testing/canvasMcpSupport.js';
import { pinScratchProfile } from '../testing/canvasStorageSupport.js';
import { readProposal } from './designSystemProposals.js';
import {
  listDesignSystemVersions,
  readDesignSystem,
  saveDesignSystem,
  setDesignSystemDeleted,
  type DesignSystem,
} from './designSystems.js';
import { DROIDEX_DESIGN_SYSTEM } from './presets/droidex.js';

pinScratchProfile();

const accent = { set: 'token', name: '--ds-accent', value: '#c2410c' };

async function userKit(id: string, version = 1): Promise<void> {
  for (let next = 1; next <= version; next += 1)
    await saveDesignSystem(
      { ...DROIDEX_DESIGN_SYSTEM, id, name: `Studio ${String(next)}` },
      {
        mutationId: `${id}-v${String(next)}`,
        baseVersion: next - 1 || null,
        savedBy: { actor: 'user' },
      },
    );
}

function tokenValue(sections: DesignSystem['sections'], name: string) {
  for (const section of sections)
    for (const item of section.items)
      if (item.kind === 'group') {
        const token = item.tokens.find((entry) => entry.name === name);
        if (token) return 'value' in token ? token.value : token;
      }
  return undefined;
}

test('a new kit saves as version 1 by the agent, from blank or from a copy', async (t) => {
  const { scopeId, call } = await openTurn(t);
  const save = (mutationId: string, input: Record<string, unknown>) =>
    call('canvas_theme', { scopeId, operation: 'save', mutationId, ...input });

  const saved = await save('new-acme', {
    kit: { id: 'acme', from: 'blank' },
    name: 'Acme',
    changes: [accent],
    examples: { 'cover.tsx': 'export default function Cover() { return null; }' },
    cover: 'preview',
  });
  assert.deepEqual(
    { status: saved.status, ref: saved.ref, diagnostics: saved.diagnostics },
    { status: 'saved', ref: { id: 'acme', version: 1 }, diagnostics: [] },
  );
  const acme = await readDesignSystem({ id: 'acme', version: 1 });
  assert.equal(acme.name, 'Acme');
  assert.deepEqual(acme.cover, { kind: 'preview', example: 'cover.tsx' });
  assert.equal(tokenValue(acme.sections, '--ds-accent'), '#c2410c');
  assert.deepEqual((await listDesignSystemVersions('acme'))[0].savedBy, {
    actor: 'agent',
    appSessionId: 'chat-one',
  });

  assert.equal(
    (await save('copy', { kit: { id: 'acme-two', from: { copy: { id: 'acme', version: 1 } } } }))
      .status,
    'saved',
  );
  const copy = await readDesignSystem({ id: 'acme-two', version: 1 });
  assert.equal(copy.name, 'Acme copy');
  assert.deepEqual(copy.provenance, { copiedFrom: { id: 'acme', version: 1 } });

  assert.equal(
    (await save('unnamed', { kit: { id: 'unnamed', from: 'blank' } })).code,
    'invalid_input',
  );
  const project = await save('project', {
    kit: { id: 'from-project', from: { project: [{ path: 'src/index.css', kind: 'css' }] } },
  });
  assert.equal(project.code, 'invalid_input', 'project sources arrive with slice 2c');
});

test('a change to a user kit becomes its proposal, and the kit keeps its version', async (t) => {
  const { scopeId, call } = await openTurn(t);
  await userKit('studio');
  const proposed = await call('canvas_theme', {
    scopeId,
    operation: 'save',
    mutationId: 'tweak',
    kit: { id: 'studio', baseVersion: 1 },
    changes: [accent],
  });
  assert.deepEqual(
    { status: proposed.status, id: proposed.id, baseVersion: proposed.baseVersion },
    { status: 'proposed', id: 'studio', baseVersion: 1 },
  );
  assert.match(proposed.message ?? '', /keep using version 1 until they accept it/);
  assert.equal(
    tokenValue((await readProposal('studio'))?.sections ?? [], '--ds-accent'),
    '#c2410c',
  );
  assert.deepEqual(
    (await listDesignSystemVersions('studio')).map((entry) => entry.version),
    [1],
  );
  const listed = await call('canvas_theme', { operation: 'list' });
  assert.equal(listed.systems?.find((system) => system.id === 'studio')?.proposal, true);
});

test('a preset refuses and names a copy, and a deleted kit refuses', async (t) => {
  const { scopeId, call } = await openTurn(t);
  const change = (mutationId: string, kit: Record<string, unknown>) =>
    call('canvas_theme', { scopeId, operation: 'save', mutationId, kit, changes: [accent] });

  const preset = await change('preset', { id: 'droidex', baseVersion: 1 });
  assert.equal(preset.code, 'preset_read_only');
  assert.match(preset.message ?? '', /from: \{ copy: \{ id: 'droidex', version: 1 \} \}/);

  await userKit('gone');
  await setDesignSystemDeleted('gone', true, 'delete-gone');
  assert.equal((await change('deleted', { id: 'gone', baseVersion: 1 })).code, 'invalid_input');
  assert.equal(await readProposal('gone'), null);
});

test('a stale base refuses with the latest version, and a kit that does not build with its diagnostics', async (t) => {
  const { scopeId, call } = await openTurn(t);
  await userKit('busy', 2);
  const stale = await call('canvas_theme', {
    scopeId,
    operation: 'save',
    mutationId: 'stale',
    kit: { id: 'busy', baseVersion: 1 },
    changes: [accent],
  });
  assert.deepEqual(
    { code: stale.code, latestVersion: stale.latestVersion },
    { code: 'revision_conflict', latestVersion: 2 },
  );

  const broken = await call('canvas_theme', {
    scopeId,
    operation: 'save',
    mutationId: 'broken',
    kit: { id: 'busy', baseVersion: 2 },
    changes: [
      { set: 'preview', title: 'Pricing', example: 'Pricing.tsx', width: 960, height: 640 },
    ],
    examples: { 'Pricing.tsx': 'BROKEN' },
  });
  assert.equal(broken.code, 'invalid_source');
  assert.deepEqual(
    broken.diagnostics?.map(({ file, line }) => ({ file, line })),
    [{ file: 'examples/Pricing.tsx', line: 2 }],
  );
  const unshown = await call('canvas_theme', {
    scopeId,
    operation: 'save',
    mutationId: 'unshown',
    kit: { id: 'busy', baseVersion: 2 },
    examples: { 'Unused.tsx': 'BROKEN' },
  });
  assert.equal(unshown.code, 'invalid_source', 'an example no preview shows builds too');
  assert.equal(await readProposal('busy'), null, 'a refused save leaves nothing to review');
});
