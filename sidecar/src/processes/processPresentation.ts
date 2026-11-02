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

// The command the agent ran is the outermost shell above a process: shells
// below it are a package manager's (`npm run dev` runs `sh -c vite`). A
// harness that supervises commands, as Droid does, runs the agent's shell as
// its supervisor shell's direct child, so then that child is the command. A
// shell that execs its last command leaves none, and the process names itself.
function launchingShell(
  row: ProcessRecord,
  byPid: ReadonlyMap<number, ProcessRecord>,
): string | undefined {
  const seen = new Set([row.pid]);
  let child = row;
  let outermost: { shell: ProcessRecord; child: ProcessRecord } | undefined;
  let parent = byPid.get(row.ppid);
  while (parent && !seen.has(parent.pid)) {
    if (isShellWrapper(parent.command)) outermost = { shell: parent, child };
    seen.add(parent.pid);
    child = parent;
    parent = byPid.get(parent.ppid);
  }
  if (!outermost) return undefined;
  const { shell, child: next } = outermost;
  return next !== row && isShellWrapper(next.command) ? next.command : shell.command;
}
