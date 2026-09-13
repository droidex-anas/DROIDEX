// What a Codex thread item is, and how it reads as a DROIDEX tool row. Only the
// four kinds the transcript shows are modelled; every other item Codex reports
// is one explicit no-op.
export interface FileUpdateChange {
  path: string;
  kind: { type: string };
  diff: string;
}

export type ThreadItem =
  | { type: 'agentMessage'; id: string; text: string }
  | {
      type: 'commandExecution';
      id: string;
      command: string;
      cwd: string;
      status: string;
      aggregatedOutput: string | null;
      exitCode: number | null;
    }
  | { type: 'fileChange'; id: string; changes: FileUpdateChange[]; status: string }
  | {
      type: 'mcpToolCall';
      id: string;
      server: string;
      tool: string;
      status: string;
      arguments: unknown;
      result: { content: unknown[] } | null;
      error: { message: string } | null;
    }
  | { type: 'ignored' };

const MAPPED_ITEMS = new Set(['agentMessage', 'commandExecution', 'fileChange', 'mcpToolCall']);

export function threadItem(params: unknown): ThreadItem {
  const { item } = params as { item: ThreadItem };
  return MAPPED_ITEMS.has(item.type) ? item : { type: 'ignored' };
}

export interface ToolCall {
  id: string;
  name: string;
  detail: string;
  args: unknown;
  failed: boolean;
}

// Tool names follow the conventions the transcript already classifies by:
// a shell name for commands, an edit name for patches, and Claude's `mcp__`
// prefix for an MCP tool.
export function toolCall(item: ThreadItem): ToolCall | undefined {
  if (item.type === 'commandExecution')
    return {
      id: item.id,
      name: 'Bash',
      detail: item.command,
      args: { command: item.command, cwd: item.cwd },
      failed: item.status !== 'completed' || (item.exitCode ?? 0) !== 0,
    };
  if (item.type === 'fileChange')
    return {
      id: item.id,
      name: 'Edit',
      detail: item.changes.map((change) => change.path).join('\n'),
      args: {
        path: item.changes[0]?.path,
        changes: item.changes.map((change) => `${change.kind.type} ${change.path}`),
      },
      failed: item.status !== 'completed',
    };
  if (item.type === 'mcpToolCall')
    return {
      id: item.id,
      name: `mcp__${item.server}__${item.tool}`,
      detail: item.tool,
      args: item.arguments,
      failed: item.status !== 'completed',
    };
  return undefined;
}

export function toolOutput(item: ThreadItem, streamed: string): string {
  if (item.type === 'commandExecution') return item.aggregatedOutput ?? streamed;
  if (item.type === 'fileChange') return patchText(item.changes);
  if (item.type === 'mcpToolCall')
    return item.error ? item.error.message : mcpContent(item.result?.content ?? []);
  return streamed;
}

export function patchText(changes: FileUpdateChange[]): string {
  return changes.map((change) => change.diff).join('\n');
}

function mcpContent(content: unknown[]): string {
  return content
    .map((block) => {
      const text = (block as { text?: string }).text;
      return typeof text === 'string' ? text : JSON.stringify(block);
    })
    .join('\n');
}
