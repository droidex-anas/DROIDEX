// What a Codex thread item is, and how it reads as a DROIDEX tool row. Only the
// kinds the transcript shows are modelled; every other item Codex reports is one
// explicit no-op.
import { objectValue } from '../../values.js';
import { reasoningValue } from '../../sessionHelpers.js';
import type { ChildSessionSignal } from '../../subagentSignals.js';
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
  | {
      type: 'collabAgentToolCall';
      id: string;
      tool: string;
      status: string;
      senderThreadId: string;
      receiverThreadIds: string[];
      prompt: string | null;
      model: string | null;
      reasoningEffort: string | null;
      // Last known status per receiver thread id (CollabAgentStatus).
      agentsStates: Partial<Record<string, { status: string; message: string | null }>>;
    }
  | { type: 'subAgentActivity'; id: string; kind: string; agentThreadId: string; agentPath: string }
  | { type: 'ignored' };

const MAPPED_ITEMS = new Set([
  'agentMessage',
  'commandExecution',
  'fileChange',
  'mcpToolCall',
  'imageGeneration',
  'collabAgentToolCall',
  'subAgentActivity',
]);

export function threadItem(params: unknown): ThreadItem {
  const { item } = params as { item?: ThreadItem };
  if (!item || !MAPPED_ITEMS.has(item.type)) return { type: 'ignored' };
  // An image item reaches the filesystem, so its fields are checked before it
  // is admitted rather than trusted the way a text-only item can be.
  if (item.type === 'imageGeneration' && !isGeneratedImage(item)) return { type: 'ignored' };
  // Thread ids become a child session's stable identity; a malformed payload
  // must not reach admission as one.
  if (item.type === 'collabAgentToolCall' && !isCollabAgentToolCall(item))
    return { type: 'ignored' };
  if (item.type === 'subAgentActivity' && !isSubAgentActivity(item)) return { type: 'ignored' };
  return item;
}

function isCollabAgentToolCall(
  item: Extract<ThreadItem, { type: 'collabAgentToolCall' }>,
): boolean {
  const states = objectValue(item.agentsStates);
  return (
    typeof item.id === 'string' &&
    item.id !== '' &&
    typeof item.tool === 'string' &&
    typeof item.status === 'string' &&
    Array.isArray(item.receiverThreadIds) &&
    item.receiverThreadIds.every((id) => typeof id === 'string' && id !== '') &&
    [item.prompt, item.model, item.reasoningEffort].every(
      (value) => value == null || typeof value === 'string',
    ) &&
    states !== undefined &&
    Object.values(states).every((value) => {
      const state = objectValue(value);
      return (
        state !== undefined &&
        typeof state.status === 'string' &&
        (state.message == null || typeof state.message === 'string')
      );
    })
  );
}

function isSubAgentActivity(item: Extract<ThreadItem, { type: 'subAgentActivity' }>): boolean {
  return (
    typeof item.id === 'string' &&
    typeof item.kind === 'string' &&
    typeof item.agentThreadId === 'string' &&
    item.agentThreadId !== '' &&
    typeof item.agentPath === 'string'
  );
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
  // The turn was steered or stopped before this call finished. Codex reports it
  // as an item status, so it is a fact, not a failure.
  interrupted: boolean;
}

// Tool names follow the conventions the transcript already classifies by:
// a shell name for commands, an edit name for patches, and Claude's `mcp__`
// prefix for an MCP tool.
export function toolCall(item: ThreadItem): ToolCall | undefined {
  const call = describeCall(item);
  // Codex reports a steer or a stop as the item's own status, whatever kind of
  // call it is, so one read covers them all.
  return call && { ...call, interrupted: 'status' in item && item.status === 'interrupted' };
}

function describeCall(item: ThreadItem): Omit<ToolCall, 'interrupted'> | undefined {
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
  // Only the spawn anchors a transcript row; later calls update its children.
  if (item.type === 'collabAgentToolCall' && item.tool === 'spawnAgent')
    return {
      id: item.id,
      name: 'Subagent',
      detail: item.prompt ?? '',
      // The brief reaches the agent's own pane as a prompt row through
      // collabChildSignals; the parent's transcript does not keep a second copy.
      args: {},
      failed: item.status === 'failed',
    };
  return undefined;
}

export function toolOutput(item: ThreadItem, streamed: string, appSessionId: string): string {
  if (item.type === 'commandExecution') return item.aggregatedOutput ?? streamed;
  // The path of the saved image, which is what the card renders; anything else
  // is the line shown in its place.
  if (item.type === 'imageGeneration') return generatedImage(appSessionId, item);
  if (item.type === 'fileChange') return patchText(item.changes);
  if (item.type === 'collabAgentToolCall') {
    if (item.status === 'failed') return 'Subagent spawn failed.';
    return item.status === 'interrupted' ? 'The turn was stopped before the agent started.' : '';
  }
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

function childStatus(status: string | undefined): ChildSessionSignal['status'] {
  switch (status) {
    case 'pendingInit':
      return 'pending';
    case 'running':
      return 'running';
    case 'completed':
    case 'shutdown':
      return 'completed';
    case 'interrupted':
      return 'paused';
    case 'errored':
    case 'notFound':
      return 'failed';
    default:
      return undefined;
  }
}

export function collabChildSignals(
  item: ThreadItem,
  fallback: { modelId?: string | null; reasoningEffort?: string | null },
): ChildSessionSignal[] {
  if (item.type === 'subAgentActivity') {
    let status: ChildSessionSignal['status'] = 'running';
    if (item.kind === 'completed') status = 'completed';
    else if (item.kind === 'interrupted') status = 'paused';
    return [{ providerSessionId: item.agentThreadId, status, transcriptAvailable: false }];
  }
  if (item.type !== 'collabAgentToolCall') return [];
  const isSpawn = item.tool === 'spawnAgent';
  const modelId = item.model ?? fallback.modelId;
  const reasoningEffort = reasoningValue(
    item.reasoningEffort ?? fallback.reasoningEffort ?? undefined,
  );
  return item.receiverThreadIds.map((threadId): ChildSessionSignal => {
    const state = item.agentsStates[threadId];
    const status = childStatus(state?.status);
    return {
      providerSessionId: threadId,
      ...(isSpawn ? { toolUseId: item.id, status: status ?? 'running' } : {}),
      ...(isSpawn && item.prompt ? { prompt: item.prompt, label: item.prompt } : {}),
      ...(isSpawn && modelId ? { modelId } : {}),
      ...(isSpawn && reasoningEffort ? { reasoningEffort } : {}),
      ...(state?.message ? { activity: { preview: state.message } } : {}),
      ...(status ? { status } : {}),
      transcriptAvailable: false,
    };
  });
}
