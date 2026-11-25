import assert from 'node:assert/strict';
import test from 'node:test';
import { idleProject, input } from '../testing/projectServiceHarness.js';
import { LEDGER_LIMITS } from './store.js';

test('a repeat long task suggests its idle shortened copy while the original is busy', async (t) => {
  const { h, main } = await idleProject(t);
  const title = 'x'.repeat(LEDGER_LIMITS.title);
  await h.projects.spawn(main, { ...input, title });
  const duplicate = await h.projects.spawn(main, { ...input, title });
  await h.finish(duplicate.appSessionId);
  const repeat = await h.projects.spawn(main, { ...input, title });
  assert.equal(
    repeat.reuseNote,
    `${duplicate.title} (${duplicate.appSessionId}) is idle; thread_send continues it instead of spawning another.`,
  );
});

test('a shared prefix does not suggest continuing a different long task', async (t) => {
  const { h, main } = await idleProject(t);
  const prefix = 'x'.repeat(118);
  const title = `${prefix}AA`;
  await h.projects.spawn(main, { ...input, title });
  const duplicate = await h.projects.spawn(main, { ...input, title });
  await h.finish(duplicate.appSessionId);
  const different = await h.projects.spawn(main, { ...input, title: `${prefix}BB` });
  assert.equal(different.reuseNote, undefined);
});

for (const length of [119, 120]) {
  test(`repeated ${length}-character thread titles keep their unique suffixes`, async (t) => {
    const { h, main } = await idleProject(t);
    const title = 'x'.repeat(length);
    const titles = [];
    for (let i = 0; i < 3; i += 1) {
      titles.push((await h.projects.spawn(main, { ...input, title })).title);
    }
    const similar = `${'x'.repeat(118)}yz`;
    for (let i = 0; i < 3; i += 1) {
      titles.push((await h.projects.spawn(main, { ...input, title: similar })).title);
    }
    assert.equal(new Set(titles).size, titles.length);
    assert.equal(titles[0], title);
    assert.equal(titles[3], similar);
    assert.match(titles[1] ?? '', / 2$/);
    assert.match(titles[2] ?? '', / 3$/);
    assert.match(titles[4] ?? '', / 4$/);
    assert.match(titles[5] ?? '', / 5$/);
    for (const chosen of titles) {
      assert.ok(chosen.length > 0 && chosen.length <= LEDGER_LIMITS.title);
      assert.equal(chosen, chosen.trimEnd());
    }
  });
}

test('numbered thread titles do not split an astral character at the ledger limit', async (t) => {
  const { h, main } = await idleProject(t);
  const prefix = 'x'.repeat(117);
  const title = `${prefix}😀y`;
  await h.projects.spawn(main, { ...input, title });
  const second = await h.projects.spawn(main, { ...input, title });
  const third = await h.projects.spawn(main, { ...input, title });
  assert.equal(second.title, `${prefix} 2`);
  assert.equal(third.title, `${prefix} 3`);
});
