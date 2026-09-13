// `codex app-server` notifications -> the normalized events every DROIDEX
// session already speaks (normalize.ts writes the same shapes from Droid's
// stream, claudeEvents.ts from Claude's).
//
// Deltas are the only source of assistant text and thinking: the completed item
// repeats the whole message, so re-emitting it would double every sentence. The
// completed item backfills one case, a message that streamed nothing at all.
import type { NormalizedEvent } from '../../normalize.js';
import type { TranscriptEvent } from '../../protocol.js';
import {
  patchText,
  threadItem,
  toolCall,
  toolOutput,
  type FileUpdateChange,
  type ThreadItem,
} from './codexItems.js';

// The notifications this mapper translates. The session owns the rest of the
// turn's lifecycle (thread/started, turn/started, turn/completed, error) and
// everything else Codex reports is ignored.
export const MAPPED_NOTIFICATIONS = [
  'item/agentMessage/delta',
  'item/reasoning/textDelta',
  'item/reasoning/summaryTextDelta',
  'item/started',
  'item/completed',
  'item/commandExecution/outputDelta',
  'item/fileChange/patchUpdated',
  'thread/tokenUsage/updated',
] as const;

interface DeltaParams {
  itemId: string;
  delta: string;
}

// A tool call still running: what it is about, for an approval card that has to
// describe it, and the output collected so far.
interface OpenTool {
  detail: string;
  output: string;
}

let sequence = 0;
// A distinct suffix from normalize.ts's and claudeEvents.ts's ids so no two
// providers can mint the same transcript id.
const nextId = (): string => `${Date.now().toString(36)}-x${(sequence++).toString(36)}`;

export class CodexEventMapper {
  private readonly tools = new Map<string, OpenTool>();
  // Message items that have already reached the transcript through their deltas.
  private readonly streamed = new Set<string>();

  constructor(private readonly appSessionId: string) {}

  map(method: string, params: unknown): NormalizedEvent[] {
    // The payloads below are read by shape; a notification without one is a
    // version difference, not a reason to throw out of the transport.
    if (typeof params !== 'object' || params === null) return [];
    switch (method) {
      case 'item/agentMessage/delta':
        return this.delta('text', params as DeltaParams);
      case 'item/reasoning/textDelta':
      case 'item/reasoning/summaryTextDelta':
        return this.delta('thinking', params as DeltaParams);
      case 'item/started':
        return this.started(threadItem(params));
      case 'item/completed':
        return this.completed(threadItem(params));
      case 'item/commandExecution/outputDelta': {
        const { itemId, delta } = params as DeltaParams;
        const tool = this.tools.get(itemId);
        if (tool) tool.output += delta;
        return [];
      }
      case 'item/fileChange/patchUpdated': {
        const { itemId, changes } = params as { itemId: string; changes: FileUpdateChange[] };
        const tool = this.tools.get(itemId);
        if (tool) tool.output = patchText(changes);
        return [];
      }
      case 'thread/tokenUsage/updated':
        return [tokens((params as { tokenUsage: ThreadTokenUsage }).tokenUsage)];
      default:
        return [];
    }
  }

  // What a pending approval is about. A file-change approval carries no detail
  // of its own, so the open item it belongs to is the only description there is.
  toolDetail(itemId: string): string | undefined {
    return this.tools.get(itemId)?.detail;
  }

  errorEvent(message: string): NormalizedEvent {
    return { transcript: this.transcript('error', { text: message, isError: true }) };
  }

  private delta(kind: 'text' | 'thinking', { itemId, delta }: DeltaParams): NormalizedEvent[] {
    if (!delta) return [];
    if (kind === 'text') this.streamed.add(itemId);
    return [{ transcript: this.transcript(kind, { text: delta }) }];
  }

  private started(item: ThreadItem): NormalizedEvent[] {
    const call = toolCall(item);
    if (!call) return [];
    this.tools.set(call.id, { detail: call.detail, output: '' });
    return [
      {
        transcript: this.transcript('tool_call', {
          toolName: call.name,
          toolArgs: call.args,
          toolUseId: call.id,
        }),
      },
    ];
  }

  private completed(item: ThreadItem): NormalizedEvent[] {
    if (item.type === 'agentMessage') {
      // A message that never streamed is visible nowhere else.
      if (this.streamed.delete(item.id) || !item.text) return [];
      return [{ transcript: this.transcript('text', { text: item.text }) }];
    }
    const call = toolCall(item);
    if (!call) return [];
    const open = this.tools.get(call.id);
    this.tools.delete(call.id);
    return [
      {
        transcript: this.transcript('tool_result', {
          toolName: call.name,
          text: toolOutput(item, open?.output ?? ''),
          isError: call.failed,
          toolUseId: call.id,
        }),
      },
    ];
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

interface TokenUsageBreakdown {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
}

interface ThreadTokenUsage {
  total: TokenUsageBreakdown;
  last: TokenUsageBreakdown;
  modelContextWindow: number | null;
}

// `total` is the thread's running cost; `last` is the most recent call, which is
// what currently occupies the context window.
function tokens(usage: ThreadTokenUsage): NormalizedEvent {
  return {
    tokens: {
      tokensIn: usage.total.inputTokens,
      tokensOut: usage.total.outputTokens,
      contextTokens: usage.last.totalTokens,
      ...(usage.modelContextWindow ? { maxContextTokens: usage.modelContextWindow } : {}),
    },
  };
}
