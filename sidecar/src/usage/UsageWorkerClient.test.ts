import assert from 'node:assert/strict';
import { utimesSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { UsageWorkerClient } from './UsageWorkerClient.js';
import type { UsageWorkerSnapshot } from './UsageWorkerProtocol.js';

test('usage worker owns the ledger and returns an empty snapshot', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'droidex-usage-worker-'));
  const client = new UsageWorkerClient({
    workerData: {
      databasePath: join(directory, 'usage.sqlite'),
      roots: [],
      openCodeRoots: [],
      droidSettingsRoots: [],
      timeZone: 'UTC',
    },
  });
  try {
    const snapshot = await readySnapshot(client);
    assert.equal(snapshot.totals.events, 0);
    assert.equal(snapshot.timeZone, 'UTC');
    assert.deepEqual(snapshot.sync, {
      status: 'ready',
      sources: { jsonl: 'ready', openCode: 'ready', droid: 'ready' },
    });
    assert.deepEqual(await client.recordDroidexSessions(['app-1', 'app-1', 'app-2']), {
      insertedSessions: 2,
    });
    assert.equal((await client.snapshot()).sessions, 2);
  } finally {
    await client.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('usage worker ingests structured harness sources into the shared snapshot', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'droidex-usage-worker-opencode-'));
  const openCodeRoot = join(directory, 'opencode');
  await mkdir(openCodeRoot);
  const source = new DatabaseSync(join(openCodeRoot, 'opencode.db'));
  source.exec(
    'CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, data TEXT NOT NULL, time_created INTEGER)',
  );
  source.prepare('INSERT INTO message VALUES (?, ?, ?, ?)').run(
    'message-1',
    'session-1',
    JSON.stringify({
      role: 'assistant',
      time: { created: 100, completed: 101 },
      model: { id: 'openai/gpt-5' },
      tokens: { input: 100, output: 40, reasoning: 10, cache: { read: 20, write: 5 } },
    }),
    100,
  );
  source.close();
  const droidRoot = join(directory, 'droid');
  await mkdir(droidRoot);
  await writeFile(
    join(droidRoot, 'droid-session.settings.json'),
    JSON.stringify({
      model: 'droid-model',
      tokenUsage: {
        inputTokens: 10,
        outputTokens: 4,
        cacheCreationTokens: 2,
        cacheReadTokens: 3,
        thinkingTokens: 1,
      },
    }),
  );
  const client = new UsageWorkerClient({
    workerData: {
      databasePath: join(directory, 'usage.sqlite'),
      roots: [],
      openCodeRoots: [openCodeRoot],
      droidSettingsRoots: [droidRoot],
      timeZone: 'UTC',
    },
  });
  try {
    const snapshot = await readySnapshot(client);
    assert.equal(snapshot.totals.events, 2);
    assert.equal(snapshot.lifetimeTokens, 195);
    assert.deepEqual(snapshot.harnesses.map((harness) => harness.name).sort(), [
      'Droid',
      'OpenCode',
    ]);
    const writer = new DatabaseSync(join(openCodeRoot, 'opencode.db'));
    try {
      writer.exec('PRAGMA journal_mode = WAL');
      writer.prepare('INSERT INTO message VALUES (?, ?, ?, ?)').run(
        'message-2',
        'session-1',
        JSON.stringify({
          role: 'assistant',
          time: { created: 200, completed: 201 },
          model: { id: 'gpt-6.1-sol' },
          tokens: { input: 1, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
        }),
        200,
      );
      // Snapshot reads do not trigger ingest; the database/WAL watcher must wake it.
      // macOS can drop events while its FSEvents stream starts, so keep touching the WAL.
      const wal = join(openCodeRoot, 'opencode.db-wal');
      const updated = await matchingSnapshot(
        client,
        (value) => value.totals.events === 3,
        () => utimesSync(wal, new Date(), new Date()),
      );
      assert.equal(updated.lifetimeTokens, 198);
      assert.equal(updated.harnesses.find((row) => row.id === 'opencode')?.sessions, 1);
      await client.reconcile();
      assert.equal((await client.snapshot()).totals.events, 3);
    } finally {
      writer.close();
    }
  } finally {
    await client.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('usage worker isolates source failures and keeps snapshots available', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'droidex-usage-worker-failure-'));
  const openCodeRoot = join(directory, 'opencode');
  await mkdir(openCodeRoot);
  const source = new DatabaseSync(join(openCodeRoot, 'opencode.db'));
  source.exec('CREATE TABLE unsupported (id TEXT PRIMARY KEY)');
  source.close();
  const client = new UsageWorkerClient({
    workerData: {
      databasePath: join(directory, 'usage.sqlite'),
      roots: [],
      openCodeRoots: [openCodeRoot],
      droidSettingsRoots: [],
      timeZone: 'UTC',
    },
  });
  try {
    const snapshot = await matchingSnapshot(
      client,
      (value) => value.sync.sources.openCode === 'error',
    );
    assert.deepEqual(snapshot.sync, {
      status: 'error',
      sources: { jsonl: 'ready', openCode: 'error', droid: 'ready' },
    });
    await assert.rejects(client.reconcile(), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, 'One or more usage sources failed to reconcile.');
      assert.equal(error.message.includes(directory), false);
      return true;
    });
    assert.equal((await client.snapshot()).totals.events, 0);
  } finally {
    await client.close();
    await rm(directory, { recursive: true, force: true });
  }
});

async function readySnapshot(client: UsageWorkerClient): Promise<UsageWorkerSnapshot> {
  return await matchingSnapshot(client, (snapshot) => snapshot.sync.status === 'ready');
}

async function matchingSnapshot(
  client: UsageWorkerClient,
  matches: (snapshot: UsageWorkerSnapshot) => boolean,
  nudge?: () => void,
): Promise<UsageWorkerSnapshot> {
  // A real worker thread indexes files; the full suite's load can slow it well past a few seconds.
  const deadline = Date.now() + 30_000;
  let nudgedAt = Date.now();
  do {
    const snapshot = await client.snapshot();
    if (matches(snapshot)) return snapshot;
    if (nudge && Date.now() - nudgedAt >= 1_000) {
      nudge();
      nudgedAt = Date.now();
    }
    await new Promise((resolve) => setImmediate(resolve));
  } while (Date.now() < deadline);
  throw new Error('Usage worker did not reach the expected sync state.');
}
