const { execFile } = require('node:child_process');
// Git runs the user's hooks and aliases, so it starts from their environment,
// not the app's.
const { childEnv } = require('./childEnv.cjs');

const DEFAULT_TIMEOUT = 6000;
const MAX_BUFFER = 16 * 1024 * 1024;

// Resolve and reject on a non-zero exit so callers can try/catch.
function run(cwd, args, { timeout = DEFAULT_TIMEOUT, indexFile } = {}) {
  const env = childEnv();
  if (indexFile) env.GIT_INDEX_FILE = indexFile;
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['-C', cwd, ...args],
      { timeout, maxBuffer: MAX_BUFFER, env },
      (err, stdout) => {
        if (err) reject(err);
        else resolve(String(stdout));
      },
    );
  });
}

// `git diff` exits 1 when differences exist; treat that as success.
function runSoft(cwd, args, { timeout = DEFAULT_TIMEOUT } = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['-C', cwd, ...args],
      { timeout, maxBuffer: MAX_BUFFER, env: childEnv() },
      (err, stdout) => {
        if (err && err.code !== 1) reject(err);
        else resolve(String(stdout));
      },
    );
  });
}

async function tryRun(cwd, args, opts) {
  try {
    return (await run(cwd, args, opts)).trim();
  } catch {
    return null;
  }
}

// Git error output often echoes the remote URL verbatim, which can carry
// embedded credentials (https://x-access-token:TOKEN@host/...). Strip the
// userinfo before a message crosses to the renderer, using the same rule as
// environment()'s remoteUrl: greedy to the last '@' within the token so
// secrets that themselves contain '@' are fully removed.
function sanitizeGitError(message) {
  return String(message || '').replace(/(\w+:\/\/)[^\s/]+@/g, '$1');
}

module.exports = { run, runSoft, tryRun, sanitizeGitError };
