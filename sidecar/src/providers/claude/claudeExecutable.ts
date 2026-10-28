import { readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

import { isExecutable, resolveOnPathSync } from '../../Environment.js';

// Mirrors the Droid CLI's resolution order (Environment.ts): an explicit
// override first, then the locations the installers use, then PATH, and last
// the native installer's own version store.
const CLI_CANDIDATES = [
  join(homedir(), '.local', 'bin', 'claude'),
  join(homedir(), '.claude', 'local', 'claude'),
  '/opt/homebrew/bin/claude',
  '/usr/local/bin/claude',
];

// Absolute path to the Claude Code CLI, or undefined when nothing is installed.
// The agent SDK spawns this path without a shell and without PATHEXT lookup, so
// Windows would additionally have to follow the npm `claude.cmd` shim to its
// real entry point; this build supports macOS and Linux.
export function resolveClaudePath(): string | undefined {
  const override = process.env.CLAUDE_PATH;
  if (override && isRunnableFile(override)) return override;
  const candidate = CLI_CANDIDATES.find((path) => isRunnableFile(path));
  if (candidate) return candidate;
  const onPath = resolveOnPathSync('claude');
  if (onPath && isRunnableFile(onPath)) return onPath;
  return newestNativeVersion();
}

// The native installer keeps each version it downloads here and links
// ~/.local/bin/claude to one of them. A launcher that is missing or points at
// a deleted file leaves the install itself usable, and updating through it
// writes the launcher again.
function newestNativeVersion(): string | undefined {
  const xdg = process.env.XDG_DATA_HOME;
  const dataHome = xdg && isAbsolute(xdg) ? xdg : join(homedir(), '.local', 'share');
  const versions = join(dataHome, 'claude', 'versions');
  let names: string[];
  try {
    names = readdirSync(versions);
  } catch {
    return undefined;
  }
  // The installer downloads into this folder under a temporary name first.
  return names
    .filter((name) => /^\d+\.\d+\.\d+$/.test(name))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    .map((name) => join(versions, name))
    .find(isRunnableFile);
}

// A directory carries the executable bit too, and spawning one fails with an
// opaque EACCES rather than "not installed".
function isRunnableFile(path: string): boolean {
  if (!isExecutable(path)) return false;
  return statSync(path, { throwIfNoEntry: false })?.isFile() === true;
}
