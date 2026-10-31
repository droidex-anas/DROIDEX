import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

type StreamEvent = Extract<SDKMessage, { type: 'stream_event' }>['event'];
type Assistant = Extract<SDKMessage, { type: 'assistant' }>;

export type ClaudeContent =
  | { kind: 'text' | 'thinking'; text: string; messageId: string }
  | { kind: 'tool_call'; id: string; name: string; input: unknown };

interface ToolBlock {
  id: string;
  name: string;
  json: string;
  reported?: boolean;
}

interface MessageState {
  id?: string;
  modelId?: string;
  streamedKinds: Set<'text' | 'thinking'>;
  blocks: Map<number, ToolBlock | undefined>;
}

const TOOL_BLOCK_TYPES = new Set(['tool_use', 'server_tool_use', 'mcp_tool_use']);

// The CLI repeats each completed block, not the whole message. Native message
// ids correlate additive blocks, and each source owns its own stream state.
export class ClaudeMessageContent {
  private readonly sources = new Map<string, MessageState>();

  modelId(parentToolUseId: string | null): string | undefined {
    return this.state(parentToolUseId).modelId;
  }

  stream(event: StreamEvent, parentToolUseId: string | null): ClaudeContent[] {
    const state = this.state(parentToolUseId);
    switch (event.type) {
      case 'message_start':
        state.id = event.message.id;
        state.modelId = event.message.model;
        state.streamedKinds.clear();
        state.blocks.clear();
        return [];
      case 'content_block_start': {
        const tool = toolBlock(event.content_block);
        state.blocks.set(event.index, tool ? { ...tool, json: '' } : undefined);
        return [];
      }
      case 'content_block_delta': {
        const delta = event.delta;
        if (delta.type === 'input_json_delta') {
          const tool = state.blocks.get(event.index);
          if (tool) tool.json += delta.partial_json;
          return [];
        }
        if (delta.type !== 'text_delta' && delta.type !== 'thinking_delta') return [];
        const text = delta.type === 'text_delta' ? delta.text : delta.thinking;
        if (!text) return [];
        if (!state.id)
          throw new Error(
            'Claude text arrived without its native message_start. Start a new chat.',
          );
        const kind = delta.type === 'thinking_delta' ? 'thinking' : 'text';
        state.streamedKinds.add(kind);
        return [
          {
            kind,
            text,
            messageId: state.id,
          },
        ];
      }
      case 'content_block_stop': {
        const tool = state.blocks.get(event.index);
        if (!tool || tool.reported) return [];
        tool.reported = true;
        return [
          { kind: 'tool_call', id: tool.id, name: tool.name, input: parseToolInput(tool.json) },
        ];
      }
      // Keep the completed message until the next native id: its per-block
      // assistant frames can arrive after message_stop and must not repeat it.
      default:
        return [];
    }
  }

  // A started tool waits for its block stop, unless `reportToolUseId` names it:
  // a failed request can end that call before the stop arrives.
  assistant(
    message: Assistant,
    reportToolUseId?: string,
  ): { streamed: boolean; content: ClaudeContent[] } {
    const state = this.state(message.parent_tool_use_id);
    if (state.id !== message.message.id) {
      state.id = message.message.id;
      state.streamedKinds.clear();
      state.blocks.clear();
    }
    state.modelId = message.message.model;
    const started = new Map(
      [...state.blocks.values()].flatMap((tool) => (tool ? [[tool.id, tool] as const] : [])),
    );
    const content: ClaudeContent[] = [];
    for (const block of message.message.content) {
      const tool = toolBlock(block);
      if (tool) {
        const startedTool = started.get(tool.id);
        if (startedTool && (startedTool.reported || tool.id !== reportToolUseId)) continue;
        if (startedTool) startedTool.reported = true;
        content.push({ kind: 'tool_call', ...tool, input: Reflect.get(block, 'input') });
        continue;
      }
      if (message.error) continue;
      if (block.type !== 'text' && block.type !== 'thinking') continue;
      const text = block.type === 'text' ? block.text : block.thinking;
      if (!text) continue;
      const kind = block.type === 'thinking' ? 'thinking' : 'text';
      if (state.streamedKinds.has(kind)) continue;
      if (!state.id)
        throw new Error(
          'Claude assistant text is missing its native message id. Start a new chat.',
        );
      content.push({
        kind,
        text,
        messageId: state.id,
      });
    }
    return { streamed: state.streamedKinds.size > 0 || state.blocks.size > 0, content };
  }

  private state(parentToolUseId: string | null): MessageState {
    const key = parentToolUseId ?? '';
    let state = this.sources.get(key);
    if (!state) {
      state = { streamedKinds: new Set(), blocks: new Map() };
      this.sources.set(key, state);
    }
    return state;
  }
}

export function toolBlock(block: { type: string }): { id: string; name: string } | undefined {
  if (!TOOL_BLOCK_TYPES.has(block.type)) return undefined;
  const { id, name } = block as unknown as { id: string; name: string };
  return { id, name };
}

function parseToolInput(json: string): unknown {
  if (!json) return {};
  try {
    return JSON.parse(json) as unknown;
  } catch {
    // An interrupted tool block can end before its input is complete.
    return {};
  }
}
