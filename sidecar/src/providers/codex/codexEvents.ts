// `codex app-server` notifications -> the normalized events every DROIDEX
// session already speaks (normalize.ts writes the same shapes from Droid's
// stream, claudeEvents.ts from Claude's).
//
// Deltas are the only source of assistant text and thinking: the completed item
// repeats the whole message, so re-emitting it would double every sentence. The
// completed item backfills one case, a message that streamed nothing at all.
import type { NormalizedEvent } from '../../normalize.js';
import type { TranscriptEvent } from '../../protocol.js';
import type { ChildSessionSignal } from '../../subagentSignals.js';
import type { ProviderModelSettings } from '../session.js';
import { errMsg } from '../../sessionHelpers.js';
import { UsageLimitError, usageLimitDetails } from '../usageLimit.js';
import { imageUsageLimit } from './codexImages.js';
import {
  collabChildSignals,
  patchText,
  threadItem,
  toolCall,
  toolOutput,
  type FileUpdateChange,
  type ThreadItem,
} from './codexItems.js';

// A notification payload is untrusted: every reader below returns undefined
// rather than throwing, so an unknown shape cannot escape the transport's
// stdout listener.
export interface CodexTurn {
  id: string;
  status?: string;
  error?: Error;
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function turnOf(params: unknown): CodexTurn | undefined {
  if (!isObject(params) || !isObject(params.turn)) return undefined;
  const { id, status } = params.turn;
  if (typeof id !== 'string') return undefined;
  const error = turnError(params.turn.error);
  return {
    id,
    ...(typeof status === 'string' ? { status } : {}),
    ...(error ? { error } : {}),
  };
}

export function errorOf(params: unknown): { error: Error; willRetry: boolean } | undefined {
  if (!isObject(params)) return undefined;
  const error = turnError(params.error);
  return error ? { error, willRetry: params.willRetry === true } : undefined;
}

// `mcpServer/startupStatus/updated`: Codex reports every configured MCP server
// starting and then settling. Only a failure is worth telling the chat about,
// and only the message Codex sent with it explains why.
export interface McpServerFailure {
  name: string;
  detail?: string;
}

export function mcpServerFailure(params: unknown): McpServerFailure | undefined {
  if (!isObject(params) || params.status !== 'failed') return undefined;
  // The whole name: it is the key that keeps a server to one row.
  const name = typeof params.name === 'string' ? params.name.trim() : '';
  if (!name) return undefined;
  const detail = text(params.error);
  return { name, ...(detail ? { detail } : {}) };
}

// A failing server can answer with a whole document; one bounded line is all a
// status row can show.
const DETAIL_LIMIT = 200;

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const line = value.split('\n', 1)[0].trim();
  if (!line) return undefined;
  return line.length > DETAIL_LIMIT ? `${line.slice(0, DETAIL_LIMIT)}…` : line;
}

// Codex's own message usually names the server and what went wrong, so putting
// the name in front of it again would say the same thing twice.
function mcpFailureText({ name, detail }: McpServerFailure): string {
  if (!detail) return `MCP server "${name}" failed to start.`;
  return detail.includes(name) ? detail : `MCP server "${name}" failed to start: ${detail}`;
}

function turnError(value: unknown): Error | undefined {
  if (!isObject(value) || typeof value.message !== 'string') return undefined;
  return value.codexErrorInfo === 'usageLimitExceeded' ||
    value.codexErrorInfo === 'rateLimitExceeded'
    ? new UsageLimitError(value.message)
    : new Error(value.message);
}

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

interface PatchParams {
  itemId: string;
  changes: FileUpdateChange[];
}

function deltaOf(params: Record<string, unknown>): DeltaParams | undefined {
  const { itemId, delta } = params;
  return typeof itemId === 'string' && typeof delta === 'string' ? { itemId, delta } : undefined;
}

function patchOf(params: Record<string, unknown>): PatchParams | undefined {
  const { itemId, changes } = params;
  if (typeof itemId !== 'string' || !Array.isArray(changes)) return undefined;
  return { itemId, changes: changes as FileUpdateChange[] };
}

function tokenUsageOf(params: Record<string, unknown>): ThreadTokenUsage | undefined {
  const usage = params.tokenUsage;
  if (!isObject(usage) || !isObject(usage.total) || !isObject(usage.last)) return undefined;
  return usage as unknown as ThreadTokenUsage;
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
  private readonly children = new Map<string, ChildSessionSignal>();
  // Servers already reported: one row each, however often Codex retries them.
  private readonly failedMcpServers = new Set<string>();

  constructor(
    private readonly appSessionId: string,
    private model: ProviderModelSettings = {},
  ) {}

  setModel(model: ProviderModelSettings): void {
    this.model = model;
  }

  // Every payload is read through a reader that answers undefined for a shape
  // this build does not recognize: a notification is not worth throwing out of
  // the transport's synchronous stdout listener.
  map(method: string, params: unknown): NormalizedEvent[] {
    if (!isObject(params)) return [];
    switch (method) {
      case 'item/agentMessage/delta':
        return this.delta('text', deltaOf(params));
      case 'item/reasoning/textDelta':
      case 'item/reasoning/summaryTextDelta':
        return this.delta('thinking', deltaOf(params));
      case 'item/started': {
        const item = threadItem(params);
        return [...this.started(item), ...this.childEvents(item)];
      }
      case 'item/completed': {
        const item = threadItem(params);
        return [...this.completed(item), ...this.childEvents(item)];
      }
      case 'item/commandExecution/outputDelta':
        return this.appendOutput(deltaOf(params));
      case 'item/fileChange/patchUpdated':
        return this.replacePatch(patchOf(params));
      case 'thread/tokenUsage/updated': {
        const usage = tokenUsageOf(params);
        return usage ? [tokens(usage)] : [];
      }
      default:
        return [];
    }
  }

  childThreadStarted(params: unknown, parentThreadId: string | undefined): NormalizedEvent[] {
    if (!parentThreadId || !isObject(params) || !isObject(params.thread)) return [];
    const { id, parentThreadId: parent, agentNickname, agentRole } = params.thread;
    if (parent !== parentThreadId || typeof id !== 'string' || !id) return [];
    const label = [agentRole, agentNickname]
      .filter((value) => typeof value === 'string' && value)
      .join(': ');
    return this.updateChild({
      providerSessionId: id,
      role: agentRole === 'validator' ? 'validator' : 'worker',
      ...(label ? { label } : {}),
      transcriptAvailable: false,
    });
  }

  private childEvents(item: ThreadItem): NormalizedEvent[] {
    return collabChildSignals(item, this.model).flatMap((signal) => this.updateChild(signal));
  }

  private updateChild(signal: ChildSessionSignal): NormalizedEvent[] {
    const id = signal.providerSessionId;
    if (!id) return [];
    const previous = this.children.get(id);
    const child = { ...previous, ...signal };
    // Thread metadata may precede the spawn, and is more useful than its prompt.
    if (previous?.label && previous.label !== previous.prompt) child.label = previous.label;
    // Closing a failed thread is not a successful run. A new running state can resume it.
    if (previous?.status === 'failed' && child.status === 'completed') child.status = 'failed';
    this.children.set(id, child);
    return [{ childSession: child }];
  }

  // What a pending approval is about. A file-change approval carries no detail
  // of its own, so the open item it belongs to is the only description there is.
  toolDetail(itemId: string): string | undefined {
    return this.tools.get(itemId)?.detail;
  }

  // A server the user did not ask for in this turn failing is not the turn's
  // error: it is a standing fact about the session, so it lands as one stored
  // status row rather than a red row.
  mcpFailureEvents(failure: McpServerFailure): NormalizedEvent[] {
    if (this.failedMcpServers.has(failure.name)) return [];
    this.failedMcpServers.add(failure.name);
    return [{ transcript: this.transcript('status', { text: mcpFailureText(failure) }) }];
  }

  errorEvent(error: unknown): NormalizedEvent {
    return {
      transcript: this.transcript('error', {
        text: errMsg(error),
        isError: true,
        ...usageLimitDetails(error),
      }),
    };
  }

  private delta(kind: 'text' | 'thinking', params: DeltaParams | undefined): NormalizedEvent[] {
    if (!params?.delta) return [];
    if (kind === 'text') this.streamed.add(params.itemId);
    return [{ transcript: this.transcript(kind, { text: params.delta }) }];
  }

  private appendOutput(params: DeltaParams | undefined): NormalizedEvent[] {
    if (!params) return [];
    const tool = this.tools.get(params.itemId);
    if (tool) tool.output += params.delta;
    return [];
  }

  private replacePatch(params: PatchParams | undefined): NormalizedEvent[] {
    if (!params) return [];
    const tool = this.tools.get(params.itemId);
    if (tool) tool.output = patchText(params.changes);
    return [];
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
    const events: NormalizedEvent[] = [
      {
        transcript: this.transcript('tool_result', {
          toolName: call.name,
          text: toolOutput(item, open?.output ?? '', this.appSessionId),
          isError: call.failed && !call.interrupted,
          toolUseId: call.id,
          ...(call.interrupted ? { interrupted: true as const } : {}),
        }),
      },
    ];
    const limit = item.type === 'imageGeneration' ? imageUsageLimit(item.failure) : undefined;
    if (limit) events.push(this.errorEvent(limit));
    return events;
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
      tokensIn: count(usage.total.inputTokens),
      tokensOut: count(usage.total.outputTokens),
      contextTokens: count(usage.last.totalTokens),
      ...(usage.modelContextWindow ? { maxContextTokens: usage.modelContextWindow } : {}),
    },
  };
}

// A counter Codex did not send has not been spent; publishing NaN instead would
// travel all the way into the stored summary.
function count(value: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
