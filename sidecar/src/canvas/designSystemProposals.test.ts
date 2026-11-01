import assert from 'node:assert/strict';
import fs, { readdir } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { dirname } from 'node:path';
import test from 'node:test';
import { pinScratchProfile } from '../testing/canvasStorageSupport.js';
import { canvasError } from './canvasError.js';
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
import { proposalPath } from './designSystemStorage.js';
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

async function waitingId(id: string): Promise<string> {
  const proposal = await readProposal(id);
  assert.ok(proposal, `${id} has a proposal waiting`);
  return proposal.proposalId;
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
  const { proposalId, proposedAt, ...review } = proposal;
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
  const replacement = await readProposal('replaced');
  assert.equal(replacement?.name, 'Studio B');
  assert.notEqual(replacement?.proposalId, proposalId, 'a replacement is another proposal');
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

  const accept = { proposalId: await waitingId('accepted'), mutationId: 'accept', onto: 1 };
  assert.deepEqual(await acceptProposal('accepted', accept), {
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

  // A retried accept answers with the version it saved; a new one finds nothing,
  // and a competing one onto the version it replaced is told the newer one.
  assert.equal((await acceptProposal('accepted', accept)).version, 2);
  await assert.rejects(acceptProposal('accepted', { ...accept, mutationId: 'again', onto: 2 }), {
    code: 'invalid_input',
  });
  await assert.rejects(acceptProposal('accepted', { ...accept, mutationId: 'competing' }), {
    code: 'revision_conflict',
    latestVersion: 2,
  });
});

test('a retried accept, or a decision on a replaced proposal, leaves the later proposal alone', async () => {
  const kit = await userKit('replayed');
  await propose({ ...kit, name: 'Accepted' }, 'a');
  const accept = { proposalId: await waitingId('replayed'), mutationId: 'accept-a', onto: 1 };
  assert.equal((await acceptProposal('replayed', accept)).version, 2);
  // The same content again, so only its identity tells the retry it is not its own.
  await propose(await readDesignSystem({ id: 'replayed', version: 2 }), 'b', 2);
  const later = await waitingId('replayed');

  assert.equal((await acceptProposal('replayed', accept)).version, 2);
  await assert.rejects(
    acceptProposal('replayed', { ...accept, mutationId: 'accept-a-late', onto: 2 }),
    { code: 'invalid_input' },
  );
  await discardProposal('replayed', accept.proposalId);
  assert.equal(await waitingId('replayed'), later);
  assert.deepEqual(
    (await listDesignSystemVersions('replayed')).map((entry) => entry.version),
    [2, 1],
  );
});

test('accept onto a stale version keeps the proposal, and accept over the newer one saves after it', async () => {
  const kit = await userKit('contested');
  await propose({ ...kit, name: 'Proposed' }, 'proposal');
  await saveDesignSystem(
    { ...kit, name: 'Edited' },
    { mutationId: 'user-v2', baseVersion: 1, savedBy: { actor: 'user' } },
  );

  const proposalId = await waitingId('contested');
  await assert.rejects(acceptProposal('contested', { proposalId, mutationId: 'accept', onto: 1 }), {
    code: 'revision_conflict',
    latestVersion: 2,
  });
  assert.equal((await readProposal('contested'))?.name, 'Proposed');

  const over = { proposalId, mutationId: 'accept-over', onto: 2 };
  assert.equal((await acceptProposal('contested', over)).version, 3);
  assert.equal((await readDesignSystem({ id: 'contested', version: 3 })).name, 'Proposed');
  assert.equal((await readDesignSystem({ id: 'contested', version: 2 })).name, 'Edited');
  await assert.rejects(propose(kit, 'stale'), { code: 'revision_conflict', latestVersion: 3 });
  assert.equal(await readProposal('contested'), null);
});

test('discard removes the proposal and is announced; presets and deleted kits take none', async () => {
  const kit = await userKit('discarded');
  await propose({ ...kit, name: 'Proposed' }, 'proposal');
  announced.length = 0;
  await discardProposal('discarded', await waitingId('discarded'));
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

test('a proposal whose turn ends while it is written publishes nothing and keeps the earlier one', async (t) => {
  const kit = await userKit('ended');
  await propose({ ...kit, name: 'Earlier' }, 'earlier');
  const directory = dirname(proposalPath('ended'));
  let isTurnOpen = true;
  const open = fs.open;
  const mockedOpen = t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
    // The turn ends once the new proposal's file is being written.
    const path = String(args[0]);
    if (dirname(path) === directory && path.endsWith('.tmp')) isTurnOpen = false;
    return open(...args);
  });
  syncBuiltinESMExports();
  t.after(() => {
    mockedOpen.mock.restore();
    syncBuiltinESMExports();
  });

  const beforePublish = () => {
    if (!isTurnOpen) throw canvasError('scope_expired', 'That turn has ended.');
  };
  await assert.rejects(
    proposeDesignSystem(
      { ...kit, name: 'After close' },
      { mutationId: 'after-close', baseVersion: 1, appSessionId: 'chat-one', beforePublish },
    ),
    { code: 'scope_expired' },
  );
  assert.equal((await readProposal('ended'))?.name, 'Earlier');
  assert.deepEqual(
    (await readdir(directory)).filter((name) => name.endsWith('.tmp')),
    [],
  );
});
