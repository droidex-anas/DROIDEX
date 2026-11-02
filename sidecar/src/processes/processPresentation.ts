import type { AgentProcess } from '../protocol.js';
import type { ProcessRecord } from './processTree.js';

// Longer than any heartbeat a harness restarts around a command: Droid's
// command supervisor runs a fresh `sleep 2` every two seconds.
const MIN_AGE_MS = 3000;

function isShellWrapper(command: string): boolean {
  const [executable, ...args] = command.trim().split(/\s+/);
  if (!/^(?:\S*\/)?(?:sh|zsh|bash|fish|dash)$/.test(executable)) return false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--' || !/^[+-]/.test(arg)) return false;
    if (/^--command(?:=|$)/.test(arg) || /^-[a-zA-Z]*c[a-zA-Z]*$/.test(arg)) return true;
    if (/^[+-][oO]$/.test(arg) || arg === '--rcfile' || arg === '--init-file') index += 1;
  }
  return false;
}

function displayNameFor(command: string): string {
  const words = command.split(/\s+/).filter(Boolean);
  let index = 0;
  const base = (word: string) => word.split('/').pop() ?? word;
  // Interpreters name the script, not themselves.
  if (
    /^(?:node|bun|deno|python\d*|ruby|perl)$/.test(base(words[0] ?? '')) &&
    words[1] &&
    !words[1].startsWith('-')
  ) {
    index = 1;
  }
  const head = base(words[index] ?? command);
  const next = words[index + 1];
  return next && !next.startsWith('-') && !next.includes('/') ? `${head} ${next}` : head;
}

export function sameProcessList(a: AgentProcess[], b: AgentProcess[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => {
    const y = b[i];
    return (
      x.pid === y.pid &&
      x.command === y.command &&
      x.originCommand === y.originCommand &&
      x.startedAt === y.startedAt &&
      x.ports.join(',') === y.ports.join(',')
    );
  });
}

export function visibleProcesses(
  rows: readonly ProcessRecord[],
  now: number,
  ports: ReadonlyMap<number, number[]>,
): AgentProcess[] {
  const byPid = new Map(rows.map((row) => [row.pid, row]));
  return rows
    .filter((row) => now - row.startedAt >= MIN_AGE_MS && !isShellWrapper(row.command))
    .map((row) => {
      const originCommand = launchingShell(row, byPid);
      return {
        pid: row.pid,
        name: displayNameFor(row.command),
        command: row.command,
        ...(originCommand ? { originCommand } : {}),
        startedAt: row.startedAt,
        ports: [...(ports.get(row.pid) ?? [])].sort((a, b) => a - b),
      };
    });
}

// The nearest shell wrapper above a process is the command the agent ran; one
// further up is the harness's own supervisor. A shell that execs its last
// command leaves none, and the process's own command line is what was run.
function launchingShell(
  row: ProcessRecord,
  byPid: ReadonlyMap<number, ProcessRecord>,
): string | undefined {
  const seen = new Set([row.pid]);
  let parent = byPid.get(row.ppid);
  while (parent && !seen.has(parent.pid)) {
    if (isShellWrapper(parent.command)) return parent.command;
    seen.add(parent.pid);
    parent = byPid.get(parent.ppid);
  }
  return undefined;
}
