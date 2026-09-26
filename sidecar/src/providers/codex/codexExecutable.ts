import { homedir } from 'node:os';
import { join } from 'node:path';

import { isExecutable, resolveOnPathSync } from '../../Environment.js';

// Mirrors the Droid and Claude CLI resolution order (Environment.ts): an
// explicit override first, then the locations the installers use, then PATH.
const CLI_CANDIDATES = [
  join(homedir(), '.local', 'bin', 'codex'),
  '/opt/homebrew/bin/codex',
  '/usr/local/bin/codex',
];

export function resolveCodexPath(): string | undefined {
  const override = process.env.CODEX_PATH;
  if (override && isExecutable(override)) return override;
  return CLI_CANDIDATES.find((candidate) => isExecutable(candidate)) ?? resolveOnPathSync('codex');
}
