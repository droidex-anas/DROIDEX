// What a Codex thread item is, and how it reads as a DROIDEX tool row. Only the
// kinds the transcript shows are modelled; every other item Codex reports is one
// explicit no-op.
import { generatedImage, type GeneratedImage } from './codexImages.js';

// The tool name the transcript renders as an image card. Shared with the
// renderer by convention, the way every other tool row is matched by name.
export const IMAGE_TOOL_NAME = 'image_generation';
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
  | ({ type: 'imageGeneration'; status: string; revisedPrompt?: string | null } & GeneratedImage)
  | { type: 'ignored' };

const MAPPED_ITEMS = new Set([
  'agentMessage',
  'commandExecution',
  'fileChange',
  'mcpToolCall',
  'imageGeneration',
]);

export function threadItem(params: unknown): ThreadItem {
  const { item } = params as { item?: ThreadItem };
  if (!item || !MAPPED_ITEMS.has(item.type)) return { type: 'ignored' };
  // An image item reaches the filesystem, so its fields are checked before it
  // is admitted rather than trusted the way a text-only item can be.
  if (item.type === 'imageGeneration' && !isGeneratedImage(item)) return { type: 'ignored' };
  return item;
}

function isGeneratedImage(item: Extract<ThreadItem, { type: 'imageGeneration' }>): boolean {
  return (
    typeof item.id === 'string' &&
    item.id !== '' &&
    typeof item.status === 'string' &&
    typeof item.result === 'string' &&
    (item.savedPath === undefined ||
      item.savedPath === null ||
      typeof item.savedPath === 'string') &&
    (item.revisedPrompt === undefined ||
      item.revisedPrompt === null ||
      typeof item.revisedPrompt === 'string') &&
    (item.failure === undefined || item.failure === null || typeof item.failure.type === 'string')
  );
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
  if (item.type === 'imageGeneration')
    return {
      id: item.id,
      name: IMAGE_TOOL_NAME,
      detail: item.revisedPrompt ?? '',
      args: { prompt: item.revisedPrompt ?? '' },
      failed: item.status !== 'completed' || Boolean(item.failure),
    };
  if (item.type === 'mcpToolCall')
    return {
      id: item.id,
      name: `mcp__${item.server}__${item.tool}`,
      detail: item.tool,
      args: item.arguments,
      // Codex reports a tool that answered with an error as completed, so the
      // error itself is what makes the row an error.
      failed: item.status !== 'completed' || item.error !== null,
    };
  return undefined;
}

export function toolOutput(item: ThreadItem, streamed: string, appSessionId: string): string {
  if (item.type === 'commandExecution') return item.aggregatedOutput ?? streamed;
  // The path of the saved image, which is what the card renders; anything else
  // is the line shown in its place.
  if (item.type === 'imageGeneration') return generatedImage(appSessionId, item);
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
