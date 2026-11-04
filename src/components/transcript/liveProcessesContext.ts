import { createContext } from 'react';
import { commandLineContains } from '../../lib/commandLineMatch';
import type { AgentProcess } from '../../types/bridge';

// The transcript's leaf cards read the session's live agent processes from
// here rather than from the store, so a card can render standalone (tests,
// previews) without a StoreProvider. ChatView provides the real list.
export const LiveProcessesContext = createContext<readonly AgentProcess[]>([]);

// A backgrounded server keeps its command running after the call returns, for
// as long as a live process still carries the command the agent typed.
export function isCommandStillRunning(
  command: string,
  processes: readonly AgentProcess[],
): boolean {
  const needle = command.trim();
  if (needle.length <= 3) return false;
  return processes.some(
    (process) =>
      commandLineContains(process.command, needle) ||
      (process.originCommand !== undefined && commandLineContains(process.originCommand, needle)),
  );
}
