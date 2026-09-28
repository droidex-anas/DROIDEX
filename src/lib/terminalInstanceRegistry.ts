import type { TerminalInstance } from './terminalInstances';

// The shell owns cleanup even when the terminal surface has never been loaded.
export const terminalInstances = new Map<string, TerminalInstance & { dispose(): Promise<void> }>();

export async function releaseTerminalInstance(tabId: string): Promise<void> {
  const instance = terminalInstances.get(tabId);
  if (!instance) return;
  terminalInstances.delete(tabId);
  await instance.dispose();
}

export async function releaseTerminalInstancesExcept(
  liveTabIds: ReadonlySet<string>,
): Promise<void> {
  const gone = [...terminalInstances.keys()].filter((tabId) => !liveTabIds.has(tabId));
  await Promise.all(gone.map(releaseTerminalInstance));
}
