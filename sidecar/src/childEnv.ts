// Harnesses, shells and tools must not inherit the app's private variables.
// Everything else passes through: relocating HOME on macOS moves the login
// keychain and signs the CLIs out. electron/childEnv.cjs mirrors this list;
// electron/terminal.test.cjs checks that the two stay identical.
const APP_ONLY_ENV_KEYS = [
  'BRIDGE_EXIT_ON_STDIN_CLOSE',
  'BRIDGE_PORT',
  'BRIDGE_TOKEN',
  'BROWSER_ASSET_TOKEN',
  'DROIDEX_CANVAS_RUNTIME_DIR',
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
