// Claude Code SDK messages -> the normalized events every DROIDEX session
// already speaks (normalize.ts writes the same shapes from Droid's stream).
//
// The one rule that keeps the transcript honest: `stream_event` deltas are the
// only source of assistant text and thinking. The CLI also emits an `assistant`
// snapshot for each block as it finishes, carrying that block's full text, so
// re-emitting a snapshot would double every sentence in the chat. The snapshot
// backfills one case only: a message that streamed nothing at all (an aborted
// or synthetic frame), which is visible nowhere else.
import type { SDKMessage, SDKRateLimitInfo } from '@anthropic-ai/claude-agent-sdk';

import type { NormalizedEvent } from '../../normalize.js';
import type { TranscriptEvent } from '../../protocol.js';
import { slimChildSessionArgs } from '../../subagentSignals.js';
import { ClaudeSubagents, isSpawnToolName } from './claudeSubagents.js';
import { resetAtMillis, UsageLimitError, usageLimitDetails } from '../usageLimit.js';

const TOOL_BLOCK_TYPES = new Set(['tool_use', 'server_tool_use', 'mcp_tool_use']);

export function rateLimitRefusal(info: SDKRateLimitInfo): UsageLimitError | undefined {
  if (
    info.status !== 'rejected' ||
    info.overageStatus === 'allowed' ||
    info.overageStatus === 'allowed_warning'
  )
    return undefined;
  const resetsAt = resetAtMillis(info.resetsAt);
  const resumesAt = resetsAt === undefined ? '' : new Date(resetsAt).toLocaleTimeString();
  const message = resumesAt
    ? `Claude usage limit reached. It resets at ${resumesAt}.`
    : 'Claude usage limit reached.';
  return new UsageLimitError(message, resetsAt);
}

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

let sequence = 0;
// A distinct suffix from normalize.ts's ids so two providers can never mint the
// same transcript id.
const nextId = (): string => `${Date.now().toString(36)}-c${(sequence++).toString(36)}`;

export class ClaudeEventMapper {
  // Content blocks of the message currently streaming, per conversation: a
  // subagent's frames carry their own block indices under its tool_use id.
  private readonly blocks = new Map<string, Map<number, BlockState>>();
  // Tool results already in the transcript for this turn, so the result's
  // authoritative denial list only has to cover the ones that never streamed.
  private readonly reportedResults = new Set<string>();
  private readonly totals = { tokensIn: 0, tokensOut: 0 };
  private call = { input: 0, output: 0 };
  private readonly subagents = new ClaudeSubagents();
  // Unpinned sessions learn their model from the main conversation.
  private observedModelId?: string;

  constructor(
    private readonly appSessionId: string,
    private modelId?: string,
  ) {}

  setModel(modelId: string | undefined): void {
    this.modelId = modelId;
  }

  // Resets state scoped to the turn that is starting, not the long-lived
  // background task identity the session may still be tracking across turns.
  beginTurn(): void {
    this.subagents.beginTurn();
  }

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
      case 'rate_limit_event':
        return this.rateLimit(message.rate_limit_info);
      case 'system':
        return this.system(message);
      // Hook/plugin notices and the other auxiliary frames carry nothing the
      // DROIDEX transcript shows.
      case 'tool_progress':
      case 'tool_use_summary':
      case 'auth_status':
      case 'prompt_suggestion':
        return [];
      // /clear starts a fresh conversation, and the CLI's own usage counting
      // starts again with it, so the session's totals follow.
      case 'conversation_reset':
        this.totals.tokensIn = 0;
        this.totals.tokensOut = 0;
        return [];
      default:
        // Fails the build when the SDK adds a top-level message type.
        message satisfies never;
        return [];
    }
  }

  private system(message: Extract<SDKMessage, { type: 'system' }>): NormalizedEvent[] {
    // A local slash command answers through this frame instead of the model loop.
    if (message.subtype === 'local_command_output')
      return message.content
        ? [{ transcript: this.transcript('text', { text: message.content }) }]
        : [];
    return this.subagents.map(message, this.modelId ?? this.observedModelId);
  }

  private streamEvent(
    event: Extract<SDKMessage, { type: 'stream_event' }>['event'],
    parentToolUseId: string | null,
  ): NormalizedEvent[] {
    const blocks = this.blocksFor(parentToolUseId);
    switch (event.type) {
      case 'message_start': {
        blocks.clear();
        if (parentToolUseId) return [];
        if (event.message.model) this.observedModelId = event.message.model;
        const usage = event.message.usage;
        this.call = {
          input:
            usage.input_tokens +
            (usage.cache_read_input_tokens ?? 0) +
            (usage.cache_creation_input_tokens ?? 0),
          output: 0,
        };
        return [this.usage()];
      }
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
        const tool = toolBlock(event.content_block);
        blocks.set(event.index, tool ? { tool: { ...tool, json: '' } } : {});
        return [];
      }
      case 'content_block_delta':
        return this.contentDelta(blocks, event.index, event.delta, parentToolUseId);
      case 'content_block_stop': {
        const tool = blocks.get(event.index)?.tool;
        return tool
          ? [this.toolCall(tool.id, tool.name, parseToolInput(tool.json), parentToolUseId)]
          : [];
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
    // A start always comes first in practice; recording the block here keeps the
    // snapshot rule right even if one is ever missed.
    if (!blocks.has(index)) blocks.set(index, {});
    const owner = this.childOwner(parentToolUseId);
    if (delta.type === 'text_delta' && delta.text)
      return [{ ...owner, transcript: this.transcript('text', { text: delta.text }) }];
    if (delta.type === 'thinking_delta' && delta.thinking)
      return [{ ...owner, transcript: this.transcript('thinking', { text: delta.thinking }) }];
    return [];
  }

  private assistantSnapshot(
    message: Extract<SDKMessage, { type: 'assistant' }>,
  ): NormalizedEvent[] {
    const model = message.message.model;
    if (!message.parent_tool_use_id && model && model !== '<synthetic>')
      this.observedModelId = model;
    const blocks = this.blocksFor(message.parent_tool_use_id);
    // The snapshot's content is the block that just finished, not the message so
    // far, so it cannot be matched positionally against the stream. Blocks that
    // streamed are already in the transcript, and a tool block is matched by its
    // id, which is stable.
    const streamed = blocks.size > 0;
    const reported = new Set(
      [...blocks.values()].flatMap((block) => (block.tool ? [block.tool.id] : [])),
    );
    const events: NormalizedEvent[] = [];
    for (const block of message.message.content) {
      const tool = toolBlock(block);
      if (tool) {
        if (!reported.has(tool.id))
          events.push(
            this.toolCall(
              tool.id,
              tool.name,
              (block as { input?: unknown }).input,
              message.parent_tool_use_id,
            ),
          );
        continue;
      }
      if (streamed) continue;
      const owner = this.childOwner(message.parent_tool_use_id);
      if (block.type === 'text' && block.text)
        events.push({ ...owner, transcript: this.transcript('text', { text: block.text }) });
      if (block.type === 'thinking' && block.thinking)
        events.push({
          ...owner,
          transcript: this.transcript('thinking', { text: block.thinking }),
        });
    }
    if (message.error)
      events.push({
        transcript: this.transcript('error', {
          text: message.error,
          isError: true,
          ...(message.error === 'rate_limit' ? { errorKind: 'usage_limit' } : {}),
        }),
      });
    return events;
  }

  private toolResults(message: Extract<SDKMessage, { type: 'user' }>): NormalizedEvent[] {
    const content = message.message.content;
    if (typeof content === 'string') return [];
    const owner = this.childOwner(message.parent_tool_use_id);
    return content.flatMap((block) => {
      if (block.type !== 'tool_result') return [];
      this.reportedResults.add(block.tool_use_id);
      const text = toolResultText(block.content);
      // A call the user steered or stopped away from is not a failure, and the
      // CLI says so in this one sentence. Reading it here keeps the renderer
      // free of text matching, and the row quiet instead of red.
      const interrupted = block.is_error === true && isInterruptionNotice(text);
      return {
        ...owner,
        transcript: this.transcript('tool_result', {
          text,
          isError: block.is_error === true && !interrupted,
          toolUseId: block.tool_use_id,
          ...(interrupted ? { interrupted: true } : {}),
        }),
      };
    });
  }

  // The session's own spend. `modelUsage` would be cumulative for the whole
  // query(), but it counts subagents and compaction too, and a subagent's tokens
  // belong to its own row; `usage` is the main loop alone and per turn, so the
  // turns are summed here. Settlement itself is the session's call: a result left
  // behind by an interrupted turn contributes usage and nothing else.
  private result(message: Extract<SDKMessage, { type: 'result' }>): NormalizedEvent[] {
    const { usage } = message;
    this.totals.tokensIn +=
      usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens;
    this.totals.tokensOut += usage.output_tokens;
    // The denial list is the turn's authoritative record; a refusal usually
    // reaches the model as a tool result too, and that row is the one the
    // transcript keeps. What is left never streamed at all.
    const missed = message.permission_denials.flatMap((denial) =>
      this.reportedResults.has(denial.tool_use_id)
        ? []
        : [
            {
              transcript: this.transcript('tool_result', {
                text: `${denial.tool_name} was denied.`,
                isError: true,
                toolUseId: denial.tool_use_id,
              }),
            },
          ],
    );
    this.reportedResults.clear();
    return [...missed, this.usage()];
  }

  // A line the session itself has to say, in the row shape every provider's
  // status already uses. It is part of the conversation and is stored with it.
  statusEvent(text: string): NormalizedEvent {
    return { transcript: this.transcript('status', { text }) };
  }

  private rateLimit(info: SDKRateLimitInfo): NormalizedEvent[] {
    const refusal = rateLimitRefusal(info);
    if (!refusal) return [];
    return [
      {
        transcript: this.transcript('error', {
          text: refusal.message,
          isError: true,
          ...usageLimitDetails(refusal),
        }),
      },
    ];
  }

  private toolCall(
    id: string,
    name: string,
    input: unknown,
    parentToolUseId: string | null,
  ): NormalizedEvent {
    // Nested tool calls must not change the parent's spawn correlation.
    if (!parentToolUseId) this.subagents.noteToolUse(name, id);
    // A spawn's input is the subagent's whole brief. The subagent's own pane
    // already receives that brief as a prompt row, so the parent's transcript
    // keeps only the fields that label the call.
    const toolArgs = isSpawnToolName(name) && isRecord(input) ? slimChildSessionArgs(input) : input;
    const pollsChildSessionId = this.subagents.pollsChildSessionId(name, input);
    return {
      ...this.childOwner(parentToolUseId),
      transcript: this.transcript('tool_call', {
        toolName: name,
        toolArgs,
        toolUseId: id,
        ...(pollsChildSessionId ? { pollsChildSessionId } : {}),
      }),
    };
  }

  // The context reading is the current API call's own window occupancy, which is
  // what the meter measures; the cumulative totals come from the result.
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

  // A subagent's own messages arrive inside the parent's stream, tagged with the
  // tool_use that spawned it. Every row so tagged is that agent's step, and the
  // event flow resolves the tag to the agent's scope; untagged rows are the main
  // thread's own.
  private childOwner(parentToolUseId: string | null): Pick<NormalizedEvent, 'childOwner'> {
    return parentToolUseId ? { childOwner: { kind: 'tool-use', id: parentToolUseId } } : {};
  }

  private transcript(
    kind: TranscriptEvent['kind'],
    extra: Partial<TranscriptEvent>,
  ): TranscriptEvent {
    return {
      id: nextId(),
      appSessionId: this.appSessionId,
      sourceSessionId: this.appSessionId,
      role: 'primary',
      ts: Date.now(),
      kind,
      ...extra,
    };
  }
}

// What the CLI puts in a tool result when the user steers or stops the turn
// before the tool runs. It is the harness's own wording, so it belongs here
// with the rest of this adapter's knowledge of the SDK, never in the renderer.
const INTERRUPTION_NOTICE = /the user (?:doesn't|does not) want to proceed with this tool use/i;

function isInterruptionNotice(text: string): boolean {
  return INTERRUPTION_NOTICE.test(text);
}

// The tool-use block shapes share id/name; the SDK's own union splits them by
// server/mcp provenance, which the transcript does not distinguish.
function toolBlock(block: { type: string }): { id: string; name: string } | undefined {
  if (!TOOL_BLOCK_TYPES.has(block.type)) return undefined;
  const { id, name } = block as unknown as { id: string; name: string };
  return { id, name };
}

// A tool whose input never finished streaming (an interrupt, or a block the
// model left open) still deserves its row, so a partial payload reads as no
// arguments rather than failing the turn.
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

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
      const text = (block as { text?: string }).text;
      return typeof text === 'string' ? text : JSON.stringify(block);
    })
    .join('\n');
}
