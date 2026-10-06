const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { SENTINEL } = require('./mainBootEval.cjs');
const { SENTINEL: IPC_SENTINEL } = require('./mainIpcEval.cjs');

function runEval(script, args = [], env = process.env) {
  return spawnSync(process.execPath, [path.join(__dirname, script), ...args], {
    encoding: 'utf8',
    timeout: 15_000,
    env,
  });
}

test('main.cjs evaluates under a stubbed electron without throwing', () => {
  const result = runEval('mainBootEval.cjs', [], {
    ...process.env,
    SENTRY_DSN: '',
    ELECTRON_START_URL: '',
    SIDECAR_ENTRY: '',
  });

  assert.equal(
    result.status,
    0,
    `main.cjs failed during module evaluation\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  assert.match(result.stdout, new RegExp(`^${SENTINEL}$`, 'm'));
  assert.doesNotMatch(result.stderr, /ReferenceError|before initialization/);
});

test('main validates a profile override before app.setPath and explains a failure', () => {
  for (const profile of ['blank', 'fresh', 'padded']) {
    const result = runEval('mainBootEval.cjs', [profile]);
    assert.equal(result.status, 0, `${profile}: ${result.stderr}`);
    assert.match(result.stdout, new RegExp(`^${SENTINEL}$`, 'm'));
  }

  const relative = runEval('mainBootEval.cjs', ['relative']);
  assert.equal(relative.status, 1);
  assert.match(relative.stderr, /DROIDEX_USER_DATA_DIR must be an absolute path/);

  const uncreatable = runEval('mainBootEval.cjs', ['file']);
  assert.equal(uncreatable.status, 1);
  assert.match(uncreatable.stderr, /Cannot create the DROIDEX profile directory/);
  assert.match(uncreatable.stderr, /DROIDEX_USER_DATA_DIR to a writable absolute directory/);
});

test("privileged IPC handlers reject every sender but the main window's top frame", () => {
  const result = runEval('mainIpcEval.cjs');
  assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  assert.match(result.stdout, new RegExp(`^${IPC_SENTINEL}$`, 'm'));
});

test('the main window guards navigation and requests and tears down with its renderer', () => {
  const result = runEval('mainIpcEval.cjs', ['window']);
  assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  assert.match(result.stdout, new RegExp(`^${IPC_SENTINEL}$`, 'm'));
});
