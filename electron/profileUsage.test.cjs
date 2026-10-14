const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createProfileUsage } = require('./profileUsage.cjs');

test('local usage preserves baselines and counts new tokens once across restarts', async (context) => {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'droidex-profile-'));
  context.after(() => fs.rm(userDataDir, { recursive: true, force: true }));
  let now = new Date(2026, 9, 14, 12).getTime();
  const options = { userDataDir, fs, now: () => now };
  const baseline = {
    id: 'chat-a',
    provider: 'codex',
    modelId: 'gpt-6',
    tokens: 100,
    createdAt: now - 1000,
  };
  const usage = createProfileUsage(options);
  await usage.record([baseline]);
  assert.equal((await usage.snapshot()).lifetimeTokens, 100);
  assert.deepEqual((await usage.snapshot()).days, []);
  await usage.record([
    { ...baseline, tokens: 150 },
    { ...baseline, tokens: 150 },
  ]);
  const restarted = createProfileUsage(options);
  await restarted.record([{ ...baseline, tokens: 140 }]);
  now = new Date(2026, 9, 15, 12).getTime();
  await restarted.record([{ ...baseline, tokens: 170, modelId: 'gpt-6.1' }]);
  const snapshot = await restarted.snapshot();
  assert.equal(snapshot.lifetimeTokens, 170);
  assert.deepEqual(snapshot.days, [
    { date: '2026-10-14', tokens: 50 },
    { date: '2026-10-15', tokens: 20 },
  ]);
  assert.equal(snapshot.sessions, 1);
  assert.equal(snapshot.currentStreak, 2);
  assert.equal(snapshot.longestStreak, 2);
  assert.equal(snapshot.peakDayTokens, 50);
  assert.deepEqual(snapshot.models, [{ name: 'gpt-6.1', sessions: 1 }]);
  assert.equal(JSON.stringify(snapshot).includes('chat-a'), false);
});

test('invalid IPC input and corrupt local usage fail without replacing stored history', async (context) => {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'droidex-profile-'));
  context.after(() => fs.rm(userDataDir, { recursive: true, force: true }));
  const usage = createProfileUsage({ userDataDir, fs });
  await assert.rejects(
    usage.record([{ id: 'a', provider: 'codex', tokens: -1, createdAt: 1 }]),
    /invalid/,
  );
  const filePath = path.join(userDataDir, 'profile-usage.json');
  await fs.writeFile(filePath, 'broken');
  await assert.rejects(usage.snapshot(), /Restore or remove profile-usage.json/);
  assert.equal(await fs.readFile(filePath, 'utf8'), 'broken');
});
