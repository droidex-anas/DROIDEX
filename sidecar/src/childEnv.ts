// The app starts the sidecar with its own private variables: where the user's
// profile lives, the bridge port and its tokens, and the flags that make the
// Electron binary run as Node. They are the app's plumbing, not the user's
// shell. A harness process, and every shell and tool it goes on to run, must
// not see them: a chat that ran this repository's test suite once inherited
// DROIDEX_USER_DATA_DIR, opened the user's live history database and migrated
// it out from under the running app.
//
// Everything else passes through untouched. PATH, HOME, SHELL and the locale
// are the environment the user's own tools expect, and relocating HOME on
// macOS moves the login keychain with it, which signs the CLIs out.
//
// electron/childEnv.cjs carries the same list for the main process; the drift
// check in electron/terminal.test.cjs keeps the two identical.
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

/** The environment to hand a spawned harness, shell or command-line tool. */
export function childEnv(base: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined && !APP_ONLY_ENV_KEYS.includes(key)) env[key] = value;
  }
  return env;
}
