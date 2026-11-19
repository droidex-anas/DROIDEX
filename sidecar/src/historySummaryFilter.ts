export interface HistoricalSummaryFilter {
  workspaceCwds?: string[];
  includePlainChats?: boolean;
}

export function shouldIncludeCwd(
  cwd: string,
  workspaceCwds: Set<string> | null,
  includePlainChats?: boolean,
): boolean {
  if (!cwd) return Boolean(includePlainChats);
  if (!workspaceCwds) return false;
  return workspaceCwds.has(cwd);
}
