import { homedir } from 'node:os';
import { basename, join, sep } from 'node:path';
import { nonEmptyEnv } from '../../droidexPaths.js';

export function codexHome(): string {
  return nonEmptyEnv(process.env.CODEX_HOME, join(homedir(), '.codex'));
}

// Codex keeps these alive under its app-server for as long as the thread is
// open: its JavaScript REPL, its code-mode host, and the MCP servers of the
// plugins installed in its home.
const HELPER_EXECUTABLES = new Set(['node_repl', 'codex-code-mode-host']);

export function isCodexHarnessProcess(command: string): boolean {
  const executable = command.trim().split(/\s+/, 1)[0] ?? '';
  return (
    HELPER_EXECUTABLES.has(basename(executable)) ||
    command.includes(`${join(codexHome(), 'plugins')}${sep}`)
  );
}
