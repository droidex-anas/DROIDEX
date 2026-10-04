import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { droidexHistoryDir, droidexUserDataDir } from './droidexPaths.js';

const originalUserData = process.env.DROIDEX_USER_DATA_DIR;
const originalState = process.env.DROIDEX_HISTORY_DIR;

function restoreEnv(): void {
  restore('DROIDEX_USER_DATA_DIR', originalUserData);
  restore('DROIDEX_HISTORY_DIR', originalState);
}

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test.afterEach(restoreEnv);
test.after(restoreEnv);

test('a blank directory override counts as unset, and a set one is kept verbatim', () => {
  const history = join(homedir(), '.factory', 'droidex');
  const userData = join(homedir(), 'Library', 'Application Support', 'DROIDEX');
  delete process.env.DROIDEX_HISTORY_DIR;
  delete process.env.DROIDEX_USER_DATA_DIR;
  assert.equal(droidexHistoryDir(), history);
  assert.equal(droidexUserDataDir(), userData);

  for (const blank of ['', '   ']) {
    process.env.DROIDEX_HISTORY_DIR = blank;
    process.env.DROIDEX_USER_DATA_DIR = blank;
    assert.equal(droidexHistoryDir(), history);
    assert.equal(droidexUserDataDir(), userData);
  }

  // Surrounding whitespace is part of a configured name.
  process.env.DROIDEX_HISTORY_DIR = ' history ';
  process.env.DROIDEX_USER_DATA_DIR = '/tmp/profile ';
  assert.equal(droidexHistoryDir(), ' history ');
  assert.equal(droidexUserDataDir(), '/tmp/profile ');
});

// isolatedTestEnv.ts, preloaded by the test script, is what makes this true
// however the run was started. Without it a run inherits the app's profile and
// these tests read and write the user's live history.
test('the test process has no app profile or history directory in its environment', () => {
  assert.equal(originalUserData, undefined);
  assert.equal(originalState, undefined);
  assert.equal(droidexHistoryDir(), join(homedir(), '.factory', 'droidex'));
});
