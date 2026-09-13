// One Claude Code process per DROIDEX session, driven through the agent SDK's
// streaming-input mode: the prompt is a live async iterable, so turns reuse the
// same process and the permission mode and model can change while it runs.
import {
  query,
  type Options,
  type Query,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { randomUUID } from 'node:crypto';

import type { NormalizedEvent } from '../../normalize.js';
import type { Autonomy } from '../../protocol.js';
import type { ProviderInteractions } from '../interactions.js';
import type { ProviderModelSettings, ProviderSession } from '../session.js';
import { ClaudeEventMapper } from './claudeEvents.js';
import { claudeCanUseTool, claudePermissionMode } from './claudePermissions.js';

export interface ClaudeSessionInput {
  // Claude pins the session id it is given, so DROIDEX's own identity is also
  // the provider's: there is no separate resume handle.
  appSessionId: string;
  executable: string;
  cwd: string;
  autonomy: Autonomy;
  modelId?: string;
  interactions: ProviderInteractions;
  // Set when reopening a stored session instead of starting a new one.
  resume?: boolean;
}

export class ClaudeSession implements ProviderSession {
  readonly provider = 'claude' as const;
  readonly providerSessionId: string;
  // The SDK owns the subprocess and does not expose its pid, so this session
  // has no process for the agent-process monitor to track.
  readonly process = undefined;

  private readonly prompts = new PromptQueue();
  private readonly mapper: ClaudeEventMapper;
  private readonly query: Query;
  private activeTurnId?: string;
  // The turn the user stopped, so only that turn's own error result is excused.
  private interruptedTurnId?: string;

  constructor(input: ClaudeSessionInput) {
    this.providerSessionId = input.appSessionId;
    this.mapper = new ClaudeEventMapper(input.appSessionId);
    this.query = query({ prompt: this.prompts, options: sessionOptions(input) });
  }

  async *stream(prompt: string): AsyncGenerator<NormalizedEvent, void, undefined> {
    if (this.activeTurnId) throw new Error('This Claude session is already running a turn.');
    const turnId = randomUUID();
    this.activeTurnId = turnId;
    this.prompts.push({
      type: 'user',
      uuid: turnId,
      session_id: this.providerSessionId,
      parent_tool_use_id: null,
      message: { role: 'user', content: prompt },
    });
    try {
      // Pulled one message at a time rather than with `for await`: leaving a
      // `for await` calls return() on the query, which would end the whole
      // session at the first turn that settles.
      for (;;) {
        const next = await this.query.next();
        if (next.done) return;
        for (const event of this.mapper.map(next.value)) yield event;
        // A result left behind by an interrupted turn is only usage; this turn
        // ends on its own result.
        if (next.value.type === 'result' && answersTurn(next.value, turnId)) {
          // A stopped turn settles quietly: the CLI still reports the
          // interruption as an error result carrying an internal diagnostic.
          if (next.value.subtype !== 'success' && this.interruptedTurnId !== turnId)
            throw new Error(turnFailure(next.value.subtype, next.value.errors));
          yield { done: true };
          return;
        }
      }
    } finally {
      this.activeTurnId = undefined;
    }
  }

  async setAutonomy(autonomy: Autonomy): Promise<void> {
    await this.query.setPermissionMode(claudePermissionMode(autonomy));
  }

  // Reasoning effort is not part of the model selection this build offers for
  // Claude, so the catalog advertises none and none arrives here.
  async setModel({ modelId }: ProviderModelSettings): Promise<void> {
    if (modelId) await this.query.setModel(modelId);
  }

  async interrupt(): Promise<void> {
    this.interruptedTurnId = this.activeTurnId;
    // Aborts the in-flight turn on the live process; the turn then settles with
    // its own result, so the next prompt does not pay for a restart.
    await this.query.interrupt();
  }

  close(): Promise<void> {
    this.prompts.close();
    // The SDK closes stdin and escalates SIGTERM to SIGKILL itself.
    this.query.close();
    return Promise.resolve();
  }
}

function sessionOptions(input: ClaudeSessionInput): Options {
  const autonomy = claudePermissionMode(input.autonomy);
  return {
    cwd: input.cwd,
    pathToClaudeCodeExecutable: input.executable,
    ...(input.modelId ? { model: input.modelId } : {}),
    ...(input.resume ? { resume: input.appSessionId } : { sessionId: input.appSessionId }),
    systemPrompt: { type: 'preset', preset: 'claude_code' },
    // 'project' is what loads the repository's CLAUDE.md.
    settingSources: ['user', 'project', 'local'],
    includePartialMessages: true,
    permissionMode: autonomy,
    ...(autonomy === 'bypassPermissions' ? { allowDangerouslySkipPermissions: true } : {}),
    canUseTool: claudeCanUseTool(input.appSessionId, input.interactions),
    // HOME is never overridden: on macOS it also relocates the login keychain,
    // and the CLI then reports the user as signed out.
  };
}

function turnFailure(subtype: string, errors: string[]): string {
  // The CLI's own diagnostics are bracketed internals; the subtype is what a
  // user can act on.
  const detail = errors.filter((error) => !error.startsWith('[')).join('\n');
  return detail
    ? `Claude Code ended the turn (${subtype}): ${detail}`
    : `Claude Code ended the turn (${subtype}).`;
}

function answersTurn(
  message: { user_message_uuid?: string; user_message_uuids?: string[] },
  turnId: string,
): boolean {
  if (message.user_message_uuids?.includes(turnId)) return true;
  // Older CLIs stamp neither field; their result can only be this turn's.
  return message.user_message_uuid === undefined || message.user_message_uuid === turnId;
}

// The session's prompt channel. One iterator, consumed by whichever turn is
// streaming, so the process stays warm between turns.
class PromptQueue implements AsyncIterable<SDKUserMessage> {
  private readonly queued: SDKUserMessage[] = [];
  private waiting?: (result: IteratorResult<SDKUserMessage>) => void;
  private closed = false;

  push(message: SDKUserMessage): void {
    const waiting = this.waiting;
    if (waiting) {
      this.waiting = undefined;
      waiting({ value: message, done: false });
      return;
    }
    this.queued.push(message);
  }

  close(): void {
    this.closed = true;
    this.waiting?.({ value: undefined, done: true });
    this.waiting = undefined;
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: async (): Promise<IteratorResult<SDKUserMessage>> => {
        const queued = this.queued.shift();
        if (queued) return { value: queued, done: false };
        if (this.closed) return { value: undefined, done: true };
        return await new Promise<IteratorResult<SDKUserMessage>>((resolve) => {
          this.waiting = resolve;
        });
      },
    };
  }
}
