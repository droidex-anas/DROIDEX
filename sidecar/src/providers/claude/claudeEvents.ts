// Claude Code SDK messages -> the normalized events every DROIDEX session
// already speaks (normalize.ts writes the same shapes from Droid's stream).
//
// The one rule that keeps the transcript honest: `stream_event` deltas are the
// only source of assistant text and thinking. The CLI also emits an `assistant`
// snapshot for each block as it finishes, carrying that block's full text, so
// re-emitting a snapshot would double every sentence in the chat. The snapshot
// backfills a text/thinking kind that never streamed, including synthetic or
// aborted frames. Native message ids keep those additive blocks together.
import type { ModelInfo, SDKMessage, SDKRateLimitInfo } from '@anthropic-ai/claude-agent-sdk';

import type { NormalizedEvent } from '../../normalize.js';
import type { TranscriptEvent } from '../../protocol.js';
import { slimChildSessionArgs } from '../../subagentSignals.js';
import { toolResultParts } from '../../toolResultImages.js';
import { ClaudeSubagents, isSpawnToolName } from './claudeSubagents.js';
import { ClaudeMessageContent, type ClaudeContent } from './claudeMessageContent.js';
import { claudeCatalogModelId } from './claudeModels.js';
import { usageRefusal } from './claudeRateLimits.js';
import type { UsageLimitError } from '../usageLimit.js';
import type { ProviderChildSession } from '../session.js';

let sequence = 0;
// A distinct suffix from normalize.ts's ids so two providers can never mint the
// same transcript id.
const nextId = (): string => `${Date.now().toString(36)}-c${(sequence++).toString(36)}`;

export class ClaudeEventMapper {
  private readonly content = new ClaudeMessageContent();
  // Tool results already in the transcript for this turn, so the result's
  // authoritative denial list only has to cover the ones that never streamed.
  private readonly reportedResults = new Set<string>();
  private readonly totals = { tokensIn: 0, tokensOut: 0 };
  private call = { input: 0, output: 0 };
  private readonly subagents = new ClaudeSubagents();
  // Unpinned sessions learn their model from the main conversation.
  private observedModelId?: string;
  private reportedFastModeUnavailable = false;
  // The uuid of the prompt that opened the turn: where a fork of it cuts.
  private turnId?: string;
  private lastRateLimit?: SDKRateLimitInfo;
  private refusal?: UsageLimitError;

  constructor(
    private readonly appSessionId: string,
    private launchModelId?: string,
    private readonly models: ModelInfo[] = [],
  ) {}

  // The model the CLI runs: the one it launched on or was set to, or the one
  // Claude Code moved the session to by itself.
  get modelId(): string | undefined {
    return this.launchModelId;
  }

  setModel(modelId: string | undefined): void {
    this.launchModelId = modelId;
    this.observedModelId = undefined;
  }

  restoreChildren(children: readonly ProviderChildSession[]): void {
    this.subagents.restore(children);
  }

  // Resets state scoped to the turn that is starting, not the long-lived
  // background task identity the session may still be tracking across turns.
  beginTurn(turnId: string | undefined): void {
    this.turnId = turnId;
    this.refusal = undefined;
    this.subagents.beginTurn();
  }

  // A turn no prompt of ours opened has no fork point; what it spawned stays linked.
  forgetForkPoint(): void {
    this.turnId = undefined;
  }

  // The usage limit the turn's request was refused on. The CLI still ends that
  // turn with a result, which is where the session fails it.
  takeRefusal(): UsageLimitError | undefined {
    const refusal = this.refusal;
    this.refusal = undefined;
    return refusal;
  }

  map(message: SDKMessage, fastMode = false): NormalizedEvent[] {
    const parentToolUseId = 'parent_tool_use_id' in message ? message.parent_tool_use_id : null;
    if (this.subagents.dropWorkflowOutput(parentToolUseId)) return [];
    switch (message.type) {
      case 'stream_event':
        return this.streamEvent(message.event, message.parent_tool_use_id);
      case 'assistant':
        return this.assistantSnapshot(message);
      case 'user':
        return this.toolResults(message);
      case 'result':
        return [...this.fastModeNotice(message, fastMode), ...this.result(message)];
      case 'rate_limit_event':
        this.lastRateLimit = message.rate_limit_info;
        return [];
      case 'system':
        return this.system(message);
      // Hook/plugin notices and the other auxiliary frames carry nothing the
      // DROIDEX transcript shows.
      case 'tool_progress':
      case 'tool_use_summary':
      case 'auth_status':
      case 'prompt_suggestion':
        return [];
      // Clearing context does not undo tokens already spent by this app chat.
      case 'conversation_reset':
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
      return message.content ? [{ transcript: this.answerText(message.content, null) }] : [];
    const fallback = consentFallback(message);
    if (fallback) {
      const to = claudeCatalogModelId(fallback.to, this.models);
      this.setModel(to);
      const from = claudeCatalogModelId(fallback.from, this.models);
      return [{ harnessModelSwitch: { from, to, cause: 'usage_limit' } }];
    }
    return this.subagents.map(message);
  }

  private streamEvent(
    event: Extract<SDKMessage, { type: 'stream_event' }>['event'],
    parentToolUseId: string | null,
  ): NormalizedEvent[] {
    const content = this.content.stream(event, parentToolUseId);
    switch (event.type) {
      case 'message_start': {
        if (parentToolUseId)
          return event.message.model && event.message.model !== '<synthetic>'
            ? this.subagents.observe(parentToolUseId, { modelId: event.message.model })
            : [];
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
      default:
        return this.contentEvents(content, parentToolUseId);
    }
  }

  private assistantSnapshot(
    message: Extract<SDKMessage, { type: 'assistant' }>,
  ): NormalizedEvent[] {
    const model = message.message.model;
    if (!message.parent_tool_use_id && model && model !== '<synthetic>')
      this.observedModelId = model;
    const { streamed, content } = this.content.assistant(message);
    const events =
      message.parent_tool_use_id && model && model !== '<synthetic>'
        ? this.subagents.observe(message.parent_tool_use_id, { modelId: model })
        : [];
    events.push(...this.contentEvents(content, message.parent_tool_use_id));
    if (message.error) events.push(...this.failedRequest(message, streamed));
    return events;
  }

  private contentEvents(
    content: ClaudeContent[],
    parentToolUseId: string | null,
  ): NormalizedEvent[] {
    if (content.length === 0) return [];
    const modelId = this.content.modelId(parentToolUseId);
    const events = parentToolUseId
      ? this.subagents.observe(parentToolUseId, {
          transcriptAvailable: true,
          ...(modelId && modelId !== '<synthetic>' ? { modelId } : {}),
        })
      : [];
    for (const block of content) {
      if (block.kind === 'tool_call') {
        events.push(this.toolCall(block.id, block.name, block.input, parentToolUseId));
        continue;
      }
      const textUpdate: TranscriptEvent['textUpdate'] = {
        messageId: block.messageId,
        kind: 'delta',
      };
      const transcript =
        block.kind === 'text'
          ? { ...this.answerText(block.text, parentToolUseId), textUpdate }
          : this.transcript('thinking', { text: block.text, textUpdate });
      events.push({ ...this.childOwner(parentToolUseId), transcript });
    }
    return events;
  }

  // The CLI answers a failed request with a message of its own. A usage
  // refusal on the main thread fails the turn instead of adding a row; any
  // other failure is one error row, in the conversation it happened in.
  private failedRequest(
    message: Extract<SDKMessage, { type: 'assistant' }>,
    streamed: boolean,
  ): NormalizedEvent[] {
    const error = message.error ?? 'unknown';
    const text = (streamed ? '' : messageText(message.message.content)) || error;
    const mainThread = !message.parent_tool_use_id;
    const refusal =
      mainThread && error === 'rate_limit' ? usageRefusal(text, this.lastRateLimit) : undefined;
    if (refusal) {
      this.refusal = refusal;
      return [];
    }
    return [
      {
        ...this.childOwner(message.parent_tool_use_id),
        transcript: this.transcript('error', { text, isError: true }),
      },
    ];
  }

  private toolResults(message: Extract<SDKMessage, { type: 'user' }>): NormalizedEvent[] {
    const content = message.message.content;
    if (typeof content === 'string') return [];
    const owner = this.childOwner(message.parent_tool_use_id);
    const events = content.flatMap((block) => {
      if (block.type !== 'tool_result') return [];
      this.reportedResults.add(block.tool_use_id);
      const { text, images } = toolResultParts(block.content);
      // A call the user stopped, with Stop or Send now, is not a failure, and
      // the CLI says so in this one sentence. Reading it here keeps the renderer
      // free of text matching, and the row quiet instead of red.
      const interrupted = block.is_error === true && INTERRUPTION_NOTICE.test(text);
      return {
        ...owner,
        transcript: this.transcript('tool_result', {
          text,
          ...(images ? { images } : {}),
          isError: block.is_error === true && !interrupted,
          toolUseId: block.tool_use_id,
          ...(interrupted ? { interrupted: true } : {}),
        }),
      };
    });
    return message.parent_tool_use_id && events.length
      ? [
          ...this.subagents.observe(message.parent_tool_use_id, { transcriptAvailable: true }),
          ...events,
        ]
      : events;
  }

  private fastModeNotice(
    message: Extract<SDKMessage, { type: 'result' }>,
    requested: boolean,
  ): NormalizedEvent[] {
    if (!requested || this.reportedFastModeUnavailable) return [];
    const reason =
      message.fast_mode_disabled_reason ??
      (message.fast_mode_state !== 'on' ? message.fast_mode_state : undefined);
    if (!reason) return [];
    this.reportedFastModeUnavailable = true;
    return [
      this.statusEvent(`Fast mode is unavailable for this model: ${reason.replaceAll('_', ' ')}`),
    ];
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
    const mainModel = this.observedModelId ?? this.modelId?.replace(/\[1m\]$/i, '');
    // The SDK types modelUsage as a plain record, so a model it never called
    // still reads as present; `in` is what actually says whether it is there.
    const limit =
      mainModel && mainModel in message.modelUsage
        ? message.modelUsage[mainModel].contextWindow
        : undefined;
    const usageEvent = this.usage();
    if (limit !== undefined && Number.isFinite(limit) && limit > 0 && usageEvent.tokens)
      usageEvent.tokens.maxContextTokens = limit;
    return [...missed, usageEvent];
  }

  errorEvent(message: string): NormalizedEvent {
    return {
      transcript: this.transcript('error', { text: message, isError: true }),
    };
  }

  // A line the session itself has to say, in the row shape every provider's
  // status already uses. It is part of the conversation and is stored with it.
  statusEvent(text: string): NormalizedEvent {
    return { transcript: this.transcript('status', { text }) };
  }

  private toolCall(
    id: string,
    name: string,
    input: unknown,
    parentToolUseId: string | null,
  ): NormalizedEvent {
    this.subagents.noteToolUse(name, id, parentToolUseId);
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

  // A subagent's own messages arrive inside the parent's stream, tagged with the
  // tool_use that spawned it. Every row so tagged is that agent's step, and the
  // event flow resolves the tag to the agent's scope; untagged rows are the main
  // thread's own.
  private childOwner(parentToolUseId: string | null): Pick<NormalizedEvent, 'childOwner'> {
    return parentToolUseId ? { childOwner: { kind: 'tool-use', id: parentToolUseId } } : {};
  }

  // A fork cuts the main conversation after a turn, so only the main thread's
  // text carries the turn's fork point; a subagent's text is that agent's step.
  private answerText(text: string, parentToolUseId: string | null): TranscriptEvent {
    const forkPointId = parentToolUseId ? undefined : this.turnId;
    return this.transcript('text', { text, ...(forkPointId ? { forkPointId } : {}) });
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

// Claude Code moves a chat off a model the account needs usage credits for,
// for the rest of the session. The SDK does not type this frame.
function consentFallback(
  message: Record<string, unknown>,
): { from: string; to: string } | undefined {
  if (message.subtype !== 'model_consent_fallback') return undefined;
  const { original_model: from, fallback_model: to } = message;
  return typeof from === 'string' && typeof to === 'string' && from && to
    ? { from, to }
    : undefined;
}

function messageText(
  content: Extract<SDKMessage, { type: 'assistant' }>['message']['content'],
): string {
  return content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n');
}

// What the CLI puts in a tool result when the user stops the turn before the
// tool runs. It is the harness's own wording, so it belongs here
// with the rest of this adapter's knowledge of the SDK, never in the renderer.
const INTERRUPTION_NOTICE = /the user (?:doesn't|does not) want to proceed with this tool use/i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
