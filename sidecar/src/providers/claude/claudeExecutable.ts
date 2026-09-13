import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { isExecutable, resolveOnPathSync } from '../../Environment.js';

// Mirrors the Droid CLI's resolution order (Environment.ts): an explicit
// override first, then the locations the installers use, then PATH.
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
  return onPath && isRunnableFile(onPath) ? onPath : undefined;
}

// A directory carries the executable bit too, and spawning one fails with an
// opaque EACCES rather than "not installed".
function isRunnableFile(path: string): boolean {
  if (!isExecutable(path)) return false;
  return statSync(path, { throwIfNoEntry: false })?.isFile() === true;
}
