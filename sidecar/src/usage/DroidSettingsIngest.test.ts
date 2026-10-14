import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test, { type TestContext } from 'node:test';

import { DroidSettingsIngest, droidSettingsRoots } from './DroidSettingsIngest.js';
import { readDroidSettingsDirectoryPage } from './DroidSettingsDirectory.js';
import { ingestDroidSettingsFile } from './DroidSettingsFile.js';
import { UsageDatabase } from './UsageDatabase.js';

test('uses the Factory sessions directory by default', () => {
  assert.deepEqual(droidSettingsRoots('/tmp/droid-home'), [
    resolve('/tmp/droid-home/.factory/sessions'),
  ]);
});

test('drains initial discovery, persists deltas, and rotates known files without hot looping', async (t) => {
  const fixture = await ledgerFixture(t);
  const project = join(fixture.root, 'project');
  const nested = join(project, 'nested');
  await mkdir(project);
  await mkdir(nested);
  const firstPath = join(fixture.root, 'a.settings.json');
  await writeSettings(firstPath, usage(10, 4, 2, 3, 1, 'droid-model'));
  await writeSettings(join(project, 'b.settings.json'), usage(5, 2, 0, 0, 0, 'other-model'));
  const nestedPath = join(nested, 'c.settings.json');
  await writeSettings(nestedPath, usage(1, 1, 0, 0, 0, 'nested-model'));
  const changes = changeLatch();
  const ingest = new DroidSettingsIngest({
    store: fixture.database,
    roots: [fixture.root],
    maxFilesPerReconcile: 2,
    onDirty: changes.notify,
  });
  t.after(() => ingest.close());

  const first = await ingest.reconcile();
  assert.equal(first.backlog, true);
  assert.equal(first.discoveredFiles, 2);
  await drainBacklog(ingest);
  assert.equal(fixture.database.snapshot().lifetimeTokens, 29);

  const knownPage = await ingest.reconcile();
  assert.equal(knownPage.insertedEvents, 0);
  await ingest.reconcile();
  await ingest.reconcile();
  const sourcePath = await realpath(firstPath);
  const beforePrivateChange = fixture.database.usageSourceCursor(sourcePath, 'droid-settings');
  await changes.run(() =>
    writeSettings(firstPath, {
      ...usage(10, 4, 2, 3, 1, 'droid-model'),
      privateNote: 'secret',
    }),
  );
  assert.equal((await ingest.reconcile()).insertedEvents, 0);
  const afterPrivateChange = fixture.database.usageSourceCursor(sourcePath, 'droid-settings');
  assert.equal(
    JSON.parse(afterPrivateChange?.state ?? '{}').contentHash,
    JSON.parse(beforePrivateChange?.state ?? '{}').contentHash,
  );
  assert.doesNotMatch(afterPrivateChange?.state ?? '', /secret/);
  await ingest.reconcile();
  await ingest.reconcile();
  await changes.run(() => writeSettings(firstPath, usage(12, 6, 3, 4, 2, 'droid-model')));
  assert.equal((await ingest.reconcile()).insertedEvents, 1);

  const snapshot = fixture.database.snapshot();
  assert.equal(snapshot.lifetimeTokens, 36);
  assert.deepEqual(
    {
      input: snapshot.totals.inputTokens,
      output: snapshot.totals.outputTokens,
      cacheWrite: snapshot.totals.cacheWriteTokens,
      cacheRead: snapshot.totals.cacheReadTokens,
      reasoning: snapshot.totals.reasoningTokens,
    },
    { input: 25, output: 11, cacheWrite: 3, cacheRead: 4, reasoning: 2 },
  );

  ingest.close();
  await writeSettings(nestedPath, usage(2, 1, 0, 0, 0, 'nested-model'));
  const restarted = new DroidSettingsIngest({
    store: fixture.database,
    roots: [fixture.root],
    maxFilesPerReconcile: 2,
  });
  t.after(() => restarted.close());
  assert.equal((await restarted.reconcile()).backlog, true);
  await drainBacklog(restarted);
  assert.equal(fixture.database.snapshot().lifetimeTokens, 37);
});

test('preserves known baselines across gaps and detects raw counter decreases', async (t) => {
  const fixture = await ledgerFixture(t);
  const source = join(fixture.root, 'session.settings.json');
  await writeSettings(source, usage(10, 4, 1, 2, 1));
  const changes = changeLatch();
  const ingest = new DroidSettingsIngest({
    store: fixture.database,
    roots: [fixture.root],
    onDirty: changes.notify,
  });
  t.after(() => ingest.close());
  await ingest.reconcile();

  await changes.run(() =>
    writeSettings(source, {
      model: 'droid-model',
      tokenUsage: { inputTokens: 10, outputTokens: 4, cacheReadTokens: 2, thinkingTokens: 1 },
    }),
  );
  assert.equal((await ingest.reconcile()).insertedEvents, 0);
  await changes.run(() => writeSettings(source, usage(12, 4, 1, 2, 1)));
  assert.equal((await ingest.reconcile()).insertedEvents, 1);

  // Normalized input rises, but the raw input counter fell: this is a new generation.
  await changes.run(() => writeSettings(source, usage(11, 4, 1, 4, 1)));
  assert.equal((await ingest.reconcile()).insertedEvents, 1);
  assert.equal(fixture.database.snapshot().lifetimeTokens, 41);
});

test('starts a generation for replaced totals and preserves unknown token categories', async (t) => {
  const fixture = await ledgerFixture(t);
  const source = join(fixture.root, 'session.settings.json');
  await writeSettings(source, {
    ...usage(8, 4, 1, 2, 1, 'model-a'),
    inclusiveTokenUsage: {
      inputTokens: 900_000,
      outputTokens: 900_000,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      thinkingTokens: 0,
    },
  });
  const ingest = new DroidSettingsIngest({ store: fixture.database, roots: [fixture.root] });
  t.after(() => ingest.close());
  await ingest.reconcile();

  const replacement = join(fixture.root, 'replacement.tmp');
  await writeSettings(replacement, usage(3, 2, 1, 1, 1, 'model-b'));
  await rename(replacement, source);
  assert.equal((await ingest.reconcile()).insertedEvents, 1);

  await writeSettings(join(fixture.root, 'partial.settings.json'), {
    model: 'x'.repeat(161),
    tokenUsage: { inputTokens: 5, cacheReadTokens: 3 },
  });
  assert.equal((await ingest.reconcile()).insertedEvents, 1);
  const snapshot = fixture.database.snapshot();
  assert.equal(snapshot.totals.events, 3);
  assert.equal(snapshot.lifetimeTokens, 24);
  assert.equal(snapshot.totals.tokensComplete, false);
  assert.deepEqual(snapshot.models.map((model) => model.name).sort(), ['model-a', 'model-b']);
  assert.equal(snapshot.coverage.inputTokens.known, 2);
  assert.equal(snapshot.coverage.cacheReadTokens.known, 3);
});

test('bounds file reads and ignores settings symlinks outside the configured root', async (t) => {
  const fixture = await ledgerFixture(t);
  await writeSettings(join(fixture.root, 'valid.settings.json'), usage(1, 1, 0, 0, 0));
  await writeFile(join(fixture.root, 'bad.settings.json'), '{bad-json');
  await writeFile(join(fixture.root, 'large.settings.json'), 'x'.repeat(300));
  const outside = join(fixture.directory, 'outside.settings.json');
  await writeSettings(outside, usage(500, 500, 0, 0, 0));
  await symlink(outside, join(fixture.root, 'linked.settings.json'));

  const ingest = new DroidSettingsIngest({
    store: fixture.database,
    roots: [fixture.root],
    maxFileBytes: 256,
  });
  t.after(() => ingest.close());
  const result = await ingest.reconcile();
  assert.equal(result.processedFiles, 1);
  assert.equal(result.malformedFiles, 1);
  assert.equal(result.oversizedFiles, 1);
  assert.equal(fixture.database.snapshot().lifetimeTokens, 2);
});

test('rejects a discovered directory replaced by an external symlink', async (t) => {
  const fixture = await ledgerFixture(t);
  const nested = join(fixture.root, 'nested');
  const parked = join(fixture.directory, 'parked');
  const outside = join(fixture.directory, 'outside');
  await mkdir(nested);
  await mkdir(outside);
  await writeSettings(join(fixture.root, 'root.settings.json'), usage(1, 1, 0, 0, 0));
  await writeSettings(join(fixture.root, 'second.settings.json'), usage(1, 1, 0, 0, 0));
  await writeSettings(join(outside, 'outside.settings.json'), usage(500, 500, 0, 0, 0));
  const ingest = new DroidSettingsIngest({
    store: fixture.database,
    roots: [fixture.root],
    maxFilesPerReconcile: 2,
  });
  t.after(() => ingest.close());
  assert.equal((await ingest.reconcile()).backlog, true);
  await rename(nested, parked);
  await symlink(outside, nested);
  await drainBacklog(ingest);
  assert.equal(fixture.database.snapshot().lifetimeTokens, 4);
});

test('watcher prioritizes exact changed paths and same basenames remain separate sessions', async (t) => {
  const fixture = await ledgerFixture(t);
  const firstDirectory = join(fixture.root, 'one');
  const secondDirectory = join(fixture.root, 'two');
  await mkdir(firstDirectory);
  await mkdir(secondDirectory);
  const first = join(firstDirectory, 'shared.settings.json');
  await writeSettings(first, usage(1, 1, 0, 0, 0));
  await writeSettings(join(secondDirectory, 'shared.settings.json'), usage(1, 1, 0, 0, 0));
  let notifyDirty: () => void = () => undefined;
  const ingest = new DroidSettingsIngest({
    store: fixture.database,
    roots: [fixture.root],
    maxFilesPerReconcile: 2,
    onDirty: () => notifyDirty(),
  });
  t.after(() => ingest.close());
  await drainBacklog(ingest);
  assert.equal(fixture.database.snapshot().sessions, 2);

  const dirty = new Promise<void>((resolve) => {
    notifyDirty = resolve;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  await writeSettings(first, usage(2, 1, 0, 0, 0));
  await withTimeout(dirty);
  assert.equal((await ingest.reconcile()).insertedEvents, 1);
  assert.equal(fixture.database.snapshot().lifetimeTokens, 5);
});

test('advances past unstable files and backs retries off', async (t) => {
  const fixture = await ledgerFixture(t);
  const unstable = join(fixture.root, 'a.settings.json');
  await writeSettings(unstable, usage(1, 1, 0, 0, 0));
  await writeSettings(join(fixture.root, 'b.settings.json'), usage(2, 2, 0, 0, 0));
  let retries = 0;
  let now = 0;
  const ingest = new DroidSettingsIngest(
    { store: fixture.database, roots: [fixture.root] },
    {
      now: () => now,
      ingestFile: async (store, root, path, maxBytes, forceRead) => {
        if (path.endsWith('/a.settings.json') && retries < 2) {
          retries += 1;
          return { kind: 'retry' };
        }
        return ingestDroidSettingsFile(store, root, path, maxBytes, forceRead);
      },
    },
  );
  t.after(() => ingest.close());

  const first = await ingest.reconcile();
  assert.equal(first.processedFiles, 1);
  assert.equal(first.insertedEvents, 1);
  assert.equal(first.backlog, true);
  const backedOff = await ingest.reconcile();
  assert.equal(backedOff.backlog, false);
  assert.equal(backedOff.insertedEvents, 0);
  now = 1_000;
  assert.equal((await ingest.reconcile()).insertedEvents, 1);
  assert.equal(fixture.database.snapshot().lifetimeTokens, 6);
});

test('streams past large unrelated directories without an entry-count stall', async (t) => {
  const fixture = await ledgerFixture(t);
  for (let start = 0; start < 8_200; start += 200) {
    await Promise.all(
      Array.from({ length: 200 }, (_, offset) =>
        writeFile(join(fixture.root, `noise-${String(start + offset).padStart(5, '0')}`), ''),
      ),
    );
  }
  await writeSettings(join(fixture.root, 'z.settings.json'), usage(1, 1, 0, 0, 0));
  const page = await readDroidSettingsDirectoryPage(
    await realpath(fixture.root),
    '',
    null,
    1,
    1_024,
  );
  assert.deepEqual(page?.files, ['z.settings.json']);
  assert.equal(page?.moreFiles, false);
});

async function ledgerFixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'droidex-droid-settings-'));
  const root = join(directory, 'sessions');
  await mkdir(root);
  const database = new UsageDatabase({
    databasePath: join(directory, 'usage.sqlite'),
    timeZone: 'UTC',
  });
  t.after(() => {
    database.close();
    return rm(directory, { force: true, recursive: true });
  });
  return { database, directory, root };
}

function usage(
  inputTokens: number,
  outputTokens: number,
  cacheCreationTokens: number,
  cacheReadTokens: number,
  thinkingTokens: number,
  model = 'droid-model',
) {
  return {
    model,
    tokenUsage: {
      inputTokens,
      outputTokens,
      cacheCreationTokens,
      cacheReadTokens,
      thinkingTokens,
    },
  };
}

async function writeSettings(path: string, value: object): Promise<void> {
  await writeFile(path, JSON.stringify(value));
}

function changeLatch() {
  let notify: () => void = () => undefined;
  return {
    notify: () => notify(),
    run: async (change: () => Promise<void>) => {
      const observed = new Promise<void>((resolve) => {
        notify = resolve;
      });
      await change();
      await withTimeout(observed);
      notify = () => undefined;
    },
  };
}

async function drainBacklog(ingest: DroidSettingsIngest): Promise<void> {
  for (let pass = 0; pass < 20; pass += 1) {
    if (!(await ingest.reconcile()).backlog) return;
  }
  throw new Error('Droid settings discovery did not drain.');
}

async function withTimeout(value: Promise<void>): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      value,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Droid settings watcher did not wake.')), 2_000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
