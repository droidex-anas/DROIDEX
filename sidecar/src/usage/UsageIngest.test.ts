import assert from 'node:assert/strict';
import {
  appendFile,
  mkdir,
  mkdtemp,
  realpath,
  rename,
  rm,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import { UsageDatabase } from './UsageDatabase.js';
import { createUsageIngest, type UsageIngest } from './UsageIngest.js';

interface Harness {
  directory: string;
  sourceRoot: string;
  databasePath: string;
  database: UsageDatabase;
  ingest: UsageIngest;
}

test('holds a partial JSONL tail until its terminating newline arrives', async (t) => {
  const harness = await createHarness(t);
  const path = join(harness.sourceRoot, 'session.jsonl');
  const line = claudeLine('partial');
  const split = Math.floor(line.length / 2);
  await writeFile(path, line.slice(0, split));

  const partial = await harness.ingest.reconcile();
  assert.equal(partial.insertedEvents, 0);
  assert.equal(partial.deferredFiles, 1, JSON.stringify(partial));
  assert.equal(harness.database.cursor(await realpath(path))?.byteOffset, 0);

  await appendFile(path, `${line.slice(split)}\n`);
  const complete = await harness.ingest.reconcile();
  assert.equal(complete.insertedEvents, 1, JSON.stringify(complete));
  assert.equal(complete.malformedRecords, 0);
  assert.equal(harness.database.snapshot().totals.events, 1);
  assert.equal(
    harness.database.cursor(await realpath(path))?.byteOffset,
    Buffer.byteLength(`${line}\n`),
  );
});

test('rereads a rotated source while unique events prevent double counting', async (t) => {
  const harness = await createHarness(t);
  const path = join(harness.sourceRoot, 'session.jsonl');
  const contents = `${claudeLine('rotation')}\n`;
  await writeFile(path, contents);
  assert.equal((await harness.ingest.reconcile()).insertedEvents, 1);
  const firstCursor = harness.database.cursor(await realpath(path));

  await rename(path, join(harness.sourceRoot, 'session.previous'));
  await writeFile(path, contents);
  const reread = await harness.ingest.reconcile();
  const nextCursor = harness.database.cursor(await realpath(path));

  assert.equal(reread.insertedEvents, 0);
  assert.equal(harness.database.snapshot().totals.events, 1);
  assert.equal(nextCursor?.byteOffset, Buffer.byteLength(contents));
  assert.equal(nextCursor?.revision, (firstCursor?.revision ?? 0) + 1);
  assert.notEqual(nextCursor?.fileIdentity, firstCursor?.fileIdentity);
});

test('moving a Codex session into the archive keeps fallback event identity stable', async (t) => {
  const harness = await createHarness(t);
  const sessions = join(harness.directory, 'sessions');
  const archived = join(harness.directory, 'archived_sessions');
  await mkdir(sessions);
  await mkdir(archived);
  await harness.ingest.close();
  harness.ingest = createUsageIngest({
    database: harness.database,
    roots: [
      { parserName: 'codex', path: sessions },
      { parserName: 'codex', path: archived },
    ],
  });
  const activePath = join(sessions, 'session.jsonl');
  const archivedPath = join(archived, 'session.jsonl');
  await writeFile(
    activePath,
    `${JSON.stringify({
      type: 'session_meta',
      timestamp: '2026-10-14T10:00:00.000Z',
      payload: { id: 'codex-moved-session', cwd: '/fixture/project', model: 'gpt-fixture' },
    })}\n${JSON.stringify({
      type: 'event_msg',
      timestamp: '2026-10-14T10:01:00.000Z',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: {
            input_tokens: 100,
            output_tokens: 40,
            cached_input_tokens: 20,
            reasoning_output_tokens: 10,
          },
        },
      },
    })}\n`,
  );
  assert.equal((await harness.ingest.reconcile()).insertedEvents, 1);

  await rename(activePath, archivedPath);
  assert.equal((await harness.ingest.reconcile()).insertedEvents, 0);
  assert.equal(harness.database.snapshot().totals.events, 1);
});

test('does not reprocess a complete JSONL file whose size and mtime are unchanged', async (t) => {
  const harness = await createHarness(t);
  const path = join(harness.sourceRoot, 'complete.jsonl');
  await writeFile(path, `${claudeLine('complete')}\n`);

  assert.equal((await harness.ingest.reconcile()).processedFiles, 1);
  const unchanged = await harness.ingest.reconcile();

  assert.equal(unchanged.processedFiles, 0);
  assert.equal(harness.database.snapshot().totals.events, 1);
});

test('rereads a same-size rewrite when mtime changes and the tail guard matches', async (t) => {
  const harness = await createHarness(t);
  const path = join(harness.sourceRoot, 'session.jsonl');
  const original = `${claudeLine('before')}\n`;
  const rewritten = `${claudeLine('rewrit')}\n`;
  assert.equal(Buffer.byteLength(rewritten), Buffer.byteLength(original));
  assert.deepEqual(Buffer.from(rewritten).subarray(-64), Buffer.from(original).subarray(-64));
  await writeFile(path, original);
  assert.equal((await harness.ingest.reconcile()).insertedEvents, 1);
  const firstCursor = harness.database.cursor(await realpath(path));
  assert.ok(firstCursor);

  await writeFile(path, rewritten);
  const changedTime = new Date(firstCursor.mtimeMs + 60_000);
  await utimes(path, changedTime, changedTime);
  const reread = await harness.ingest.reconcile();
  const nextCursor = harness.database.cursor(await realpath(path));

  assert.equal(reread.insertedEvents, 1);
  assert.equal(harness.database.snapshot().totals.events, 2);
  assert.equal(nextCursor?.fileIdentity, firstCursor?.fileIdentity);
  assert.equal(nextCursor?.revision, (firstCursor?.revision ?? 0) + 1);
});

test('scans only regular JSONL files below an allowlisted root', async (t) => {
  const harness = await createHarness(t);
  const outside = join(harness.directory, 'outside');
  await mkdir(outside);
  await writeFile(join(harness.sourceRoot, 'included.jsonl'), `${claudeLine('included')}\n`);
  await writeFile(join(harness.sourceRoot, 'ignored.txt'), `${claudeLine('wrong-extension')}\n`);
  await writeFile(join(outside, 'outside.jsonl'), `${claudeLine('outside')}\n`);
  await symlink(outside, join(harness.sourceRoot, 'linked-directory'));
  await symlink(join(outside, 'outside.jsonl'), join(harness.sourceRoot, 'linked-file.jsonl'));

  const result = await harness.ingest.reconcile();
  assert.equal(result.insertedEvents, 1);
  assert.equal(harness.database.snapshot().totals.events, 1);
});

test('persists oversized discard state across an ingester restart', async (t) => {
  const harness = await createHarness(t);
  const path = join(harness.sourceRoot, 'poison.jsonl');
  const oversized = 'x'.repeat(4 * 1024 * 1024 + 128);
  const contents = `{malformed}\n${oversized}\n${claudeLine('valid-after-poison')}\n`;
  await writeFile(path, contents);

  const first = await harness.ingest.reconcile();
  const partialCursor = harness.database.cursor(await realpath(path));
  assert.equal(first.malformedRecords, 1);
  assert.equal(first.insertedEvents, 0);
  assert.equal(partialCursor?.discardingOversized, true);
  assert.equal(partialCursor?.byteOffset, 4 * 1024 * 1024);

  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await harness.ingest.close();
  assert.equal(harness.database.snapshot().totals.events, 0);
  harness.database.close();
  harness.database = openDatabase(harness.databasePath);
  harness.ingest = createIngest(harness.database, harness.sourceRoot);
  const completed = await harness.ingest.reconcile();
  const cursor = harness.database.cursor(await realpath(path));

  assert.equal(completed.insertedEvents, 1);
  assert.equal(completed.malformedRecords, 0, 'an oversized suffix must not be parsed as JSON');
  assert.equal(completed.oversizedRecords, 1);
  assert.equal(completed.deferredFiles, 0);
  assert.equal(cursor?.discardingOversized, false);
  assert.equal(cursor?.byteOffset, Buffer.byteLength(contents));
  assert.equal(harness.database.snapshot().totals.events, 1);
});

test('drains a bounded startup scan before reporting readiness', async (t) => {
  const harness = await createHarness(t);
  await Promise.all(
    Array.from({ length: 17 }, (_, index) =>
      writeFile(
        join(harness.sourceRoot, `${String(index).padStart(2, '0')}.jsonl`),
        `${claudeLine(`startup-${String(index)}`)}\n`,
      ),
    ),
  );

  const first = await harness.ingest.start();
  assert.equal(first.processedFiles, 17);
  assert.equal(harness.database.snapshot().totals.events, 17);
});

test('revisits a large deferred file before startup reports readiness', async (t) => {
  const harness = await createHarness(t);
  const laterRoot = join(harness.directory, 'later-source');
  await mkdir(laterRoot);
  await harness.ingest.close();
  harness.ingest = createUsageIngest({
    database: harness.database,
    roots: [
      { parserName: 'claude-code', path: harness.sourceRoot },
      { parserName: 'claude-code', path: laterRoot },
    ],
  });
  const padding = 'x'.repeat(2_100);
  const contents = `${Array.from({ length: 2_050 }, (_, index) =>
    claudeLine(`large-${String(index)}`, padding),
  ).join('\n')}\n`;
  assert.ok(Buffer.byteLength(contents) > 4 * 1024 * 1024);
  await writeFile(join(harness.sourceRoot, 'large.jsonl'), contents);
  await Promise.all(
    Array.from({ length: 17 }, (_, index) =>
      writeFile(
        join(laterRoot, `${String(index).padStart(2, '0')}.jsonl`),
        `${claudeLine(`after-large-${String(index)}`)}\n`,
      ),
    ),
  );

  const started = await harness.ingest.start();

  assert.equal(started.insertedEvents, 2_067);
  assert.equal(harness.database.snapshot().totals.events, 2_067);
});

test('Claude keeps final usage once across streamed blocks, fork copies and restarts', async (t) => {
  const harness = await createHarness(t);
  const path = join(harness.sourceRoot, 'stream.jsonl');
  const first = JSON.parse(claudeLine('stream'));
  first.message.model = 'claude-opus-5-5';
  first.message.usage.output_tokens = 1;
  await writeFile(path, `${JSON.stringify(first)}\n`);
  await harness.ingest.reconcile();
  const final = structuredClone(first);
  final.message.usage.output_tokens = 40;
  await appendFile(path, `${JSON.stringify(final)}\n`);
  await harness.ingest.reconcile();
  await writeFile(
    join(harness.sourceRoot, 'fork.jsonl'),
    `${JSON.stringify({ ...final, sessionId: 'copied-session' })}\n`,
  );
  await harness.ingest.reconcile();
  await harness.ingest.close();
  harness.database.close();
  harness.database = openDatabase(harness.databasePath);
  harness.ingest = createIngest(harness.database, harness.sourceRoot);
  await harness.ingest.start();
  const snapshot = harness.database.snapshot();
  assert.equal(snapshot.totals.events, 1);
  assert.equal(snapshot.lifetimeTokens, 165);
  assert.equal(snapshot.totals.estimatedCostMicrousd, 1229);
  assert.deepEqual(snapshot.harnesses[0], {
    id: 'claude-code',
    name: 'Claude Code',
    sessions: 1,
    turns: 1,
    events: 1,
    tokens: 165,
    tokensComplete: true,
    costMicrousd: 1229,
    costComplete: true,
  });
  assert.equal(snapshot.mostUsedHarness, 'claude-code');
  assert.equal(snapshot.models[0]?.costMicrousd, 1229);
  assert.equal(snapshot.days[0]?.costMicrousd, 1229);
  harness.database.rebuildDaily();
  assert.deepEqual(harness.database.snapshot().totals, snapshot.totals);
});

async function createHarness(t: TestContext): Promise<Harness> {
  const directory = await mkdtemp(join(tmpdir(), 'droidex-usage-ingest-'));
  const sourceRoot = join(directory, 'source');
  const databasePath = join(directory, 'usage.sqlite');
  await mkdir(sourceRoot);
  const database = openDatabase(databasePath);
  const harness = {
    directory,
    sourceRoot,
    databasePath,
    database,
    ingest: createIngest(database, sourceRoot),
  };
  t.after(async () => {
    await harness.ingest.close();
    harness.database.close();
    await rm(directory, { force: true, recursive: true });
  });
  return harness;
}

function openDatabase(databasePath: string): UsageDatabase {
  return new UsageDatabase({
    databasePath,
    timeZone: 'UTC',
    now: () => Date.parse('2026-10-14T12:00:00Z'),
  });
}

function createIngest(database: UsageDatabase, sourceRoot: string): UsageIngest {
  return createUsageIngest({
    database,
    roots: [{ parserName: 'claude-code', path: sourceRoot }],
  });
}

function claudeLine(id: string, content?: string): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: '2026-10-14T10:00:00.000Z',
    sessionId: `session-${id}`,
    requestId: `request-${id}`,
    message: {
      id: `message-${id}`,
      model: 'claude-fixture',
      ...(content ? { content: [{ type: 'text', text: content }] } : {}),
      usage: {
        input_tokens: 100,
        cache_read_input_tokens: 20,
        cache_creation_input_tokens: 5,
        output_tokens: 40,
      },
    },
  });
}
