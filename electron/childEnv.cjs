// The main-process copy of sidecar/src/childEnv.ts. See that file for why the
// app's private variables must never reach a shell the user can type into; the
// drift check in electron/terminal.test.cjs keeps the two key lists identical.
const APP_ONLY_ENV_KEYS = [
  'BRIDGE_EXIT_ON_STDIN_CLOSE',
  'BRIDGE_PORT',
  'BRIDGE_TOKEN',
  'BROWSER_ASSET_TOKEN',
  'DROIDEX_HISTORY_DIR',
  'DROIDEX_USER_DATA_DIR',
  'ELECTRON_RUN_AS_NODE',
  'ELECTRON_START_URL',
  'SIDECAR_ENTRY',
];

/** The environment to hand a spawned shell, editor or command-line tool. */
function childEnv(base) {
  const env = {};
  for (const [key, value] of Object.entries(base || process.env)) {
    if (value !== undefined && !APP_ONLY_ENV_KEYS.includes(key)) env[key] = value;
  }
  return env;
}

module.exports = { childEnv };
