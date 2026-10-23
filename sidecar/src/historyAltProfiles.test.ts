import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

const { loadSessionPage } = await import('./history.js');

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

test('a provider identity shared by Main and Alt is rejected instead of mixing transcripts', () => {
  writeSession(home, 'duplicate-transcript', 'Main copy');
  writeSession(altHome, 'duplicate-transcript', 'Alt copy');
  process.env.DROIDEX_ALT_HOME = altHome;
  try {
    assert.throws(() => reconciledHistorySessions(), /Duplicate provider session identity/);
  } finally {
    delete process.env.DROIDEX_ALT_HOME;
  }
});
