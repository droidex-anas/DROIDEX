import assert from 'node:assert/strict';
import test from 'node:test';
import { pinScratchProfile } from '../testing/canvasStorageSupport.js';
import { onDesignSystemChange } from './designSystemChanges.js';
import {
  acceptProposal,
  discardProposal,
  proposeDesignSystem,
  readProposal,
} from './designSystemProposals.js';
import {
  listDesignSystems,
  listDesignSystemVersions,
  readDesignSystem,
  saveDesignSystem,
  setDesignSystemDeleted,
  type DesignSystem,
} from './designSystems.js';
import { DROIDEX_DESIGN_SYSTEM } from './presets/droidex.js';

pinScratchProfile();

const announced: string[] = [];
onDesignSystemChange((id) => announced.push(id));

/** A user kit at version 1, copied from DROIDEX. */
async function userKit(id: string): Promise<DesignSystem> {
  await saveDesignSystem(
    { ...DROIDEX_DESIGN_SYSTEM, id, name: 'Studio' },
    { mutationId: `${id}-v1`, baseVersion: null, savedBy: { actor: 'user' } },
  );
  return readDesignSystem({ id, version: 1 });
}

function propose(system: DesignSystem, mutationId: string, baseVersion = 1): Promise<void> {
  return proposeDesignSystem(system, {
    mutationId,
    baseVersion,
    appSessionId: 'chat-one',
    beforePublish: () => undefined,
  });
}

function notesOf(sections: DesignSystem['sections']) {
  return sections.flatMap((section) =>
    section.items.flatMap((item) => (item.kind === 'note' ? [item] : [])),
  );
}

/** The kit with its first note's body changed. */
function withFirstNote(system: DesignSystem, body: string): DesignSystem {
  const changed = structuredClone(system);
  const [note] = notesOf(changed.sections);
  assert.ok(note);
  note.body = body;
  return changed;
}

async function listed(id: string) {
  return (await listDesignSystems()).find((summary) => summary.id === id);
}

test('a proposal replaces the earlier one and a retried one changes nothing', async () => {
  const kit = await userKit('replaced');
  await propose({ ...kit, name: 'Studio A' }, 'first');
  assert.equal((await listed('replaced'))?.proposal, true);
  const proposal = await readProposal('replaced');
  assert.ok(proposal);
  const { proposedAt, ...review } = proposal;
  assert.ok(!Number.isNaN(Date.parse(proposedAt)));
  assert.deepEqual(review, {
    baseVersion: 1,
    appSessionId: 'chat-one',
    name: 'Studio A',
    cover: kit.cover,
    sections: kit.sections,
  });

  await propose({ ...kit, name: 'Studio B' }, 'second');
  await propose({ ...kit, name: 'Studio A' }, 'first');
  assert.equal((await readProposal('replaced'))?.name, 'Studio B');
  assert.deepEqual(
    (await listDesignSystemVersions('replaced')).map((entry) => entry.version),
    [1],
    'a proposal is not a version',
  );
});

test('accept saves the proposal as the next version by the agent, onto the latest', async () => {
  const kit = await userKit('accepted');
  await propose(withFirstNote(kit, 'Agent rules.'), 'proposal');
  const notes = notesOf((await readProposal('accepted'))?.sections ?? []);
  assert.equal(notes[0]?.author, 'agent', 'review shows who wrote a changed note');
  assert.ok(notes.slice(1).every((note) => note.author === 'user'));

  assert.deepEqual(await acceptProposal('accepted', 'accept', 1), {
    id: 'accepted',
    version: 2,
    mode: 'light',
  });
  const saved = await readDesignSystem({ id: 'accepted', version: 2 });
  assert.equal(notesOf(saved.sections)[0]?.author, 'agent');
  assert.deepEqual((await listDesignSystemVersions('accepted'))[0].savedBy, {
    actor: 'agent',
    appSessionId: 'chat-one',
  });
  assert.equal(await readProposal('accepted'), null);
  assert.equal((await listed('accepted'))?.proposal, false);

  // A retried accept answers with the version it saved; a new one finds nothing.
  assert.equal((await acceptProposal('accepted', 'accept', 1)).version, 2);
  await assert.rejects(acceptProposal('accepted', 'again', 2), { code: 'invalid_input' });
});

test('accept onto a stale version keeps the proposal, and accept over the newer one saves after it', async () => {
  const kit = await userKit('contested');
  await propose({ ...kit, name: 'Proposed' }, 'proposal');
  await saveDesignSystem(
    { ...kit, name: 'Edited' },
    { mutationId: 'user-v2', baseVersion: 1, savedBy: { actor: 'user' } },
  );

  await assert.rejects(acceptProposal('contested', 'accept', 1), {
    code: 'revision_conflict',
    latestVersion: 2,
  });
  assert.equal((await readProposal('contested'))?.name, 'Proposed');

  assert.equal((await acceptProposal('contested', 'accept-over', 2)).version, 3);
  assert.equal((await readDesignSystem({ id: 'contested', version: 3 })).name, 'Proposed');
  assert.equal((await readDesignSystem({ id: 'contested', version: 2 })).name, 'Edited');
  await assert.rejects(propose(kit, 'stale'), { code: 'revision_conflict', latestVersion: 3 });
  assert.equal(await readProposal('contested'), null);
});

test('discard removes the proposal and is announced; presets and deleted kits take none', async () => {
  const kit = await userKit('discarded');
  await propose({ ...kit, name: 'Proposed' }, 'proposal');
  announced.length = 0;
  await discardProposal('discarded');
  assert.deepEqual(announced, ['discarded']);
  assert.equal(await readProposal('discarded'), null);
  assert.deepEqual(
    (await listDesignSystemVersions('discarded')).map((entry) => entry.version),
    [1],
  );

  await assert.rejects(propose(DROIDEX_DESIGN_SYSTEM, 'preset'), { code: 'preset_read_only' });
  await setDesignSystemDeleted('discarded', true, 'delete');
  await assert.rejects(propose(kit, 'deleted'), { code: 'invalid_input' });
});
