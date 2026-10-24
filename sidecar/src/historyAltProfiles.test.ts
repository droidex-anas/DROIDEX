import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { reconciledHistorySessions } from './testing/historyCharacterizationSupport.js';
import { providerSessionJsonl } from './testing/providerSessionFixtures.js';

const originalHome = process.env.HOME;
const originalAltHome = process.env.DROIDEX_ALT_HOME;
const originalUserDataDir = process.env.DROIDEX_USER_DATA_DIR;
const home = mkdtempSync(join(tmpdir(), 'droid-history-alt-'));
const altHome = join(home, 'alt');
process.env.HOME = home;
delete process.env.DROIDEX_ALT_HOME;
delete process.env.DROIDEX_USER_DATA_DIR;

const { createHistorySessionFileCache, loadSessionPage, SESSION_INDEX_FILENAME } =
  await import('./history.js');
const { droidexHistoryDir } = await import('./droidexPaths.js');

test.after(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalAltHome === undefined) delete process.env.DROIDEX_ALT_HOME;
  else process.env.DROIDEX_ALT_HOME = originalAltHome;
  if (originalUserDataDir !== undefined) process.env.DROIDEX_USER_DATA_DIR = originalUserDataDir;
  rmSync(home, { recursive: true, force: true });
});

function writeSession(profileHome: string, id: string, title: string): void {
  const directory = join(profileHome, '.factory', 'sessions');
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, `${id}.jsonl`),
    providerSessionJsonl({ type: 'session_start', cwd: '', sessionTitle: title }),
  );
}

test('opted-in Alt transcripts restore beside Main with separate profile and replay identities', () => {
  writeSession(home, 'main-transcript', 'Main conversation');
  writeSession(altHome, 'alt-transcript', 'Alt conversation');
  assert.equal(
    reconciledHistorySessions().some((row) => row.summary.appSessionId === 'alt-transcript'),
    false,
  );

  process.env.DROIDEX_ALT_HOME = altHome;
  try {
    const rows = reconciledHistorySessions();
    assert.equal(
      rows.find((row) => row.summary.appSessionId === 'alt-transcript')?.summary.droidProfile,
      'alt',
    );
    assert.equal(
      rows.find((row) => row.summary.appSessionId === 'main-transcript')?.summary.droidProfile,
      undefined,
    );
    const replay = loadSessionPage('alt-transcript', 'alt-thread').events;
    assert.ok(replay.length > 0);
    assert.ok(replay.every((event) => event.appSessionId === 'alt-thread'));
  } finally {
    delete process.env.DROIDEX_ALT_HOME;
  }
});

test('a provider identity copied into two folders of one root still restores history', () => {
  const sessions = join(home, '.factory', 'sessions');
  for (const folder of ['-old-cwd', '-new-cwd']) {
    mkdirSync(join(sessions, folder), { recursive: true });
    writeFileSync(
      join(sessions, folder, 'copied-transcript.jsonl'),
      providerSessionJsonl({ type: 'session_start', cwd: '', sessionTitle: 'Copied conversation' }),
    );
  }
  const rows = reconciledHistorySessions();
  assert.ok(rows.some((row) => row.summary.appSessionId === 'copied-transcript'));
  assert.ok(rows.some((row) => row.summary.appSessionId === 'main-transcript'));
});

test('an Alt transcript never replaces a Main chat with the same identity', () => {
  writeSession(home, 'duplicate-transcript', 'Main copy');
  writeSession(altHome, 'duplicate-transcript', 'Alt copy');
  process.env.DROIDEX_ALT_HOME = altHome;
  try {
    const row = reconciledHistorySessions().find(
      ({ summary }) => summary.appSessionId === 'duplicate-transcript',
    );
    assert.equal(row?.summary.title, 'Main copy');
    assert.equal(row?.summary.droidProfile, undefined);
  } finally {
    delete process.env.DROIDEX_ALT_HOME;
  }
});

test('a relative DROIDEX_ALT_HOME leaves Main history working', () => {
  process.env.DROIDEX_ALT_HOME = 'relative-alt-home';
  try {
    assert.ok(
      reconciledHistorySessions().some(({ summary }) => summary.appSessionId === 'main-transcript'),
    );
  } finally {
    delete process.env.DROIDEX_ALT_HOME;
  }
});

test('watcher events on an Alt copy neither replace nor remove the Main chat', () => {
  writeSession(home, 'watched-transcript', 'Main copy');
  writeSession(altHome, 'watched-transcript', 'Alt copy');
  const altPath = join(altHome, '.factory', 'sessions', 'watched-transcript.jsonl');
  process.env.DROIDEX_ALT_HOME = altHome;
  const db = new DatabaseSync(':memory:');
  const canonical = new DatabaseSync(join(droidexHistoryDir(), SESSION_INDEX_FILENAME), {
    readOnly: true,
  });
  try {
    const cache = createHistorySessionFileCache(db, canonical);
    const watchedTitle = () =>
      cache.snapshot().entries.find((entry) => entry.providerSessionId === 'watched-transcript')
        ?.summary?.title;
    cache.reconcileChanges();
    appendFileSync(altPath, '\n');
    cache.reconcilePathChanges([{ providerSessionId: 'watched-transcript', path: altPath }]);
    assert.equal(watchedTitle(), 'Main copy');
    rmSync(altPath);
    cache.reconcilePathChanges([{ providerSessionId: 'watched-transcript', path: altPath }]);
    assert.equal(watchedTitle(), 'Main copy');
  } finally {
    canonical.close();
    db.close();
    delete process.env.DROIDEX_ALT_HOME;
  }
});

test('a signed-in ~/.droid-alt-home enables Alt history without DROIDEX_ALT_HOME', () => {
  const detectedHome = join(home, '.droid-alt-home');
  writeSession(detectedHome, 'detected-alt-transcript', 'Detected Alt conversation');
  writeFileSync(join(detectedHome, '.factory', 'auth.v2.key'), '');
  try {
    const row = reconciledHistorySessions().find(
      ({ summary }) => summary.appSessionId === 'detected-alt-transcript',
    );
    assert.equal(row?.summary.droidProfile, 'alt');
  } finally {
    rmSync(detectedHome, { recursive: true, force: true });
  }
});
