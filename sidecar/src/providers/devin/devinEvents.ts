import { randomUUID } from 'node:crypto';
import type { SessionNotification, ToolCallUpdate } from '@agentclientprotocol/sdk/unstable';
import type { NormalizedEvent } from '../../normalize.js';
import type { SessionRole, TranscriptEvent } from '../../protocol.js';

export function devinToolName(tool: ToolCallUpdate): string {
  const name = tool._meta?.['cognition.ai/inferenceToolName'];
  if (typeof name === 'string' && (!tool.title || tool.title === 'Tool')) return name;
  return tool.name ?? tool.title ?? 'Tool';
}

export class DevinEvents {
  private readonly tools = new Map<string, ToolCallUpdate>();
  private readonly completed = new Set<string>();
  private forkPointId?: string;

  startTurn(): void {
    this.forkPointId = `devin-turn-${randomUUID()}`;
  }

  constructor(
    private readonly appSessionId: string,
    private readonly sessionId: string,
    private readonly role: SessionRole = 'primary',
  ) {}

  interrupt(): NormalizedEvent[] {
    const events: NormalizedEvent[] = [];
    for (const tool of this.tools.values()) {
      if (this.completed.has(tool.toolCallId)) continue;
      this.completed.add(tool.toolCallId);
      events.push(
        this.transcript({
          kind: 'tool_result',
          toolUseId: tool.toolCallId,
          toolName: devinToolName(tool),
          text: 'Interrupted',
          interrupted: true,
        }),
      );
    }
    events.push(this.transcript({ kind: 'status', text: 'Devin turn interrupted.' }));
    return events;
  }

  map({ update }: SessionNotification): NormalizedEvent[] {
    switch (update.sessionUpdate) {
      case 'agent_message_chunk':
      case 'agent_thought_chunk': {
        if (update.content.type !== 'text') return [];
        const messageId = update._meta?.['cognition.ai/streamingMessageId'];
        return [
          this.transcript({
            kind: update.sessionUpdate === 'agent_message_chunk' ? 'text' : 'thinking',
            text: update.content.text,
            ...(typeof messageId === 'string' ? { textUpdate: { messageId, kind: 'delta' } } : {}),
          }),
        ];
      }
      case 'tool_call':
      case 'tool_call_update': {
        const tool = { ...this.tools.get(update.toolCallId), ...update };
        this.tools.set(tool.toolCallId, tool);
        if (this.completed.has(tool.toolCallId)) return [];
        const terminal = tool.status === 'completed' || tool.status === 'failed';
        let text = (tool.content ?? [])
          .flatMap((item) =>
            item.type === 'content' && item.content.type === 'text' ? [item.content.text] : [],
          )
          .join('\n');
        if (!text && tool.rawOutput !== undefined)
          text =
            typeof tool.rawOutput === 'string' ? tool.rawOutput : JSON.stringify(tool.rawOutput);
        const events = [
          this.transcript({
            kind: 'tool_call',
            toolUseId: tool.toolCallId,
            toolName: devinToolName(tool),
            toolArgs: tool.rawInput,
            ...(!terminal && tool.content != null ? { text } : {}),
          }),
        ];
        if (terminal) {
          this.completed.add(tool.toolCallId);
          events.push(
            this.transcript({
              kind: 'tool_result',
              toolUseId: tool.toolCallId,
              toolName: devinToolName(tool),
              text,
              isError: tool.status === 'failed',
            }),
          );
        }
        return events;
      }
      case 'usage_update':
        return [
          {
            tokens: {
              tokensIn: 0,
              tokensOut: 0,
              contextTokens: update.used,
              maxContextTokens: update.size,
            },
          },
        ];
      default:
        return [];
    }
  }

  private transcript(
    event: Pick<TranscriptEvent, 'kind'> & Partial<TranscriptEvent>,
  ): NormalizedEvent {
    return {
      transcript: {
        id: randomUUID(),
        appSessionId: this.appSessionId,
        sourceSessionId: this.sessionId,
        role: this.role,
        ts: Date.now(),
        ...(this.forkPointId ? { forkPointId: this.forkPointId } : {}),
        ...event,
      },
    };
  }
}
