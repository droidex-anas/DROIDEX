// Claude Code SDK messages -> the normalized events every DROIDEX session
// already speaks (normalize.ts writes the same shapes from Droid's stream).
//
// The one rule that keeps the transcript honest: `stream_event` deltas are the
// only source of assistant text and thinking. The CLI also emits an `assistant`
// snapshot for each block as it finishes, carrying that block's full text, so
// re-emitting a snapshot's content would double every sentence in the chat. The
// snapshot is a backfill for one case only: a message that streamed nothing at
// all (an aborted or synthetic frame), which is visible nowhere else.
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

import type { NormalizedEvent } from '../../normalize.js';
import type { SessionRole, TranscriptEvent } from '../../protocol.js';

const TOOL_BLOCK_TYPES = new Set(['tool_use', 'server_tool_use', 'mcp_tool_use']);

interface ToolBlock {
  id: string;
  name: string;
  json: string;
}

// One content block of the message currently streaming. Its presence is what
// tells the assistant snapshot that this message already reached the transcript.
interface BlockState {
  tool?: ToolBlock;
}

interface CallUsage {
  input: number;
  output: number;
}

let sequence = 0;
// A distinct suffix from normalize.ts's ids so two providers can never mint the
// same transcript id.
const nextId = (): string => `${Date.now().toString(36)}-c${(sequence++).toString(36)}`;

export class ClaudeEventMapper {
  // Content blocks of the message currently streaming, per conversation: a
  // subagent's frames carry their own block indices under its tool_use id.
  private readonly blocks = new Map<string, Map<number, BlockState>>();
  private readonly totals = { tokensIn: 0, tokensOut: 0 };
  private call: CallUsage = { input: 0, output: 0 };

  constructor(private readonly appSessionId: string) {}

  map(message: SDKMessage): NormalizedEvent[] {
    switch (message.type) {
      case 'stream_event':
        return this.streamEvent(message.event, message.parent_tool_use_id);
      case 'assistant':
        return this.assistantSnapshot(message);
      case 'user':
        return this.toolResults(message);
      case 'result':
        return this.result(message);
      // Session bookkeeping, hook/task/plugin notices and the other auxiliary
      // frames carry nothing the DROIDEX transcript shows.
      case 'system':
      case 'tool_progress':
      case 'tool_use_summary':
      case 'auth_status':
      case 'rate_limit_event':
      case 'prompt_suggestion':
      case 'conversation_reset':
        return [];
      default:
        // Fails the build when the SDK adds a top-level message type, instead
        // of dropping it silently.
        message satisfies never;
        return [];
    }
  }

  private streamEvent(
    event: Extract<SDKMessage, { type: 'stream_event' }>['event'],
    parentToolUseId: string | null,
  ): NormalizedEvent[] {
    const blocks = this.blocksFor(parentToolUseId);
    switch (event.type) {
      case 'message_start':
        blocks.clear();
        if (parentToolUseId) return [];
        this.call = { input: contextTokens(event.message.usage), output: 0 };
        return [this.usage()];
      case 'message_delta':
        if (parentToolUseId) return [];
        this.call.output = event.usage.output_tokens;
        return [this.usage()];
      // The message is over, so the next `assistant` frame that arrives with no
      // stream events of its own is one this mapper has not reported yet.
      case 'message_stop':
        blocks.clear();
        return [];
      case 'content_block_start': {
        const block = event.content_block;
        const tool = TOOL_BLOCK_TYPES.has(block.type)
          ? (block as { id: string; name: string })
          : undefined;
        blocks.set(event.index, tool ? { tool: { id: tool.id, name: tool.name, json: '' } } : {});
        return [];
      }
      case 'content_block_delta':
        return this.contentDelta(blocks, event.index, event.delta, parentToolUseId);
      case 'content_block_stop': {
        const tool = blocks.get(event.index)?.tool;
        return tool ? [this.toolCall(tool)] : [];
      }
      default:
        return [];
    }
  }

  private contentDelta(
    blocks: Map<number, BlockState>,
    index: number,
    delta: { type: string; text?: string; thinking?: string; partial_json?: string },
    parentToolUseId: string | null,
  ): NormalizedEvent[] {
    if (delta.type === 'input_json_delta') {
      const tool = blocks.get(index)?.tool;
      if (tool) tool.json += delta.partial_json ?? '';
      return [];
    }
    // A subagent narrates its own conversation; only the main thread's prose
    // belongs in this chat. Its tool calls above are kept.
    if (parentToolUseId) return [];
    // A start always comes first in practice; recording the block here keeps the
    // snapshot rule right even if one is ever missed.
    if (!blocks.has(index)) blocks.set(index, {});
    if (delta.type === 'text_delta' && delta.text)
      return [{ transcript: this.transcript('text', { text: delta.text }) }];
    if (delta.type === 'thinking_delta' && delta.thinking)
      return [{ transcript: this.transcript('thinking', { text: delta.thinking }) }];
    return [];
  }

  private assistantSnapshot(
    message: Extract<SDKMessage, { type: 'assistant' }>,
  ): NormalizedEvent[] {
    const blocks = this.blocksFor(message.parent_tool_use_id);
    // The snapshot's content array is the block that just finished, not the
    // message so far, so it cannot be matched positionally against the stream.
    // Blocks that streamed are already in the transcript; a tool block is
    // matched by its id, which is stable.
    const streamed = blocks.size > 0;
    const reported = new Set(
      [...blocks.values()].flatMap((block) => (block.tool ? [block.tool.id] : [])),
    );
    const events: NormalizedEvent[] = [];
    for (const block of message.message.content) {
      if (TOOL_BLOCK_TYPES.has(block.type)) {
        const tool = block as { id: string; name: string; input?: unknown };
        if (!reported.has(tool.id))
          events.push({
            transcript: this.transcript('tool_call', {
              toolName: tool.name,
              toolArgs: tool.input,
              toolUseId: tool.id,
            }),
          });
        continue;
      }
      if (streamed || message.parent_tool_use_id) continue;
      if (block.type === 'text' && block.text)
        events.push({ transcript: this.transcript('text', { text: block.text }) });
      if (block.type === 'thinking' && block.thinking)
        events.push({ transcript: this.transcript('thinking', { text: block.thinking }) });
    }
    if (message.error)
      events.push({
        transcript: this.transcript('error', { text: message.error, isError: true }),
      });
    return events;
  }

  private toolResults(message: Extract<SDKMessage, { type: 'user' }>): NormalizedEvent[] {
    const content = message.message.content;
    if (typeof content === 'string') return [];
    return content.flatMap((block) =>
      block.type === 'tool_result'
        ? [
            {
              transcript: this.transcript('tool_result', {
                text: toolResultText(block.content),
                isError: block.is_error === true,
                toolUseId: block.tool_use_id,
              }),
            },
          ]
        : [],
    );
  }

  private result(message: Extract<SDKMessage, { type: 'result' }>): NormalizedEvent[] {
    // modelUsage covers the main loop, subagents and compaction; `usage` is the
    // main loop only. Both are cumulative for the whole query().
    this.totals.tokensIn = 0;
    this.totals.tokensOut = 0;
    for (const usage of Object.values(message.modelUsage)) {
      this.totals.tokensIn +=
        usage.inputTokens + usage.cacheReadInputTokens + usage.cacheCreationInputTokens;
      this.totals.tokensOut += usage.outputTokens;
    }
    // Settlement is the session's call: a result left behind by an interrupted
    // turn contributes usage and nothing else, and a failed turn is reported by
    // failing its stream rather than as a transcript row.
    return [this.usage()];
  }

  private toolCall(tool: ToolBlock): NormalizedEvent {
    return {
      transcript: this.transcript('tool_call', {
        toolName: tool.name,
        toolArgs: parseToolInput(tool.json),
        toolUseId: tool.id,
      }),
    };
  }

  // The context reading is the current API call's own window occupancy, which
  // is what the meter measures; the cumulative totals come from the result.
  private usage(): NormalizedEvent {
    return {
      tokens: {
        tokensIn: this.totals.tokensIn,
        tokensOut: this.totals.tokensOut,
        contextTokens: this.call.input + this.call.output,
      },
    };
  }

  private blocksFor(parentToolUseId: string | null): Map<number, BlockState> {
    const key = parentToolUseId ?? '';
    const existing = this.blocks.get(key);
    if (existing) return existing;
    const created = new Map<number, BlockState>();
    this.blocks.set(key, created);
    return created;
  }

  private transcript(
    kind: TranscriptEvent['kind'],
    extra: Partial<TranscriptEvent>,
  ): TranscriptEvent {
    const role: SessionRole = 'primary';
    return {
      id: nextId(),
      appSessionId: this.appSessionId,
      sourceSessionId: this.appSessionId,
      role,
      ts: Date.now(),
      kind,
      ...extra,
    };
  }
}

function contextTokens(usage: {
  input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}): number {
  return (
    (usage.input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0)
  );
}

// A tool whose input never finished streaming (interrupt, or a block the model
// left open) still deserves its row, so a partial payload reads as no arguments
// rather than failing the turn.
function parseToolInput(json: string): unknown {
  if (!json) return {};
  try {
    return JSON.parse(json) as unknown;
  } catch {
    return {};
  }
}

function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return content === undefined ? '' : JSON.stringify(content);
  return content
    .map((block: unknown) => {
      const text = (block as { type?: string; text?: string }).text;
      return typeof text === 'string' ? text : JSON.stringify(block);
    })
    .join('\n');
}
