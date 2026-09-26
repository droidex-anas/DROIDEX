// Durable transcript for a session whose provider keeps no session file of its
// own (everything except Droid). Scrollback and the sidebar both come from the
// stored-JSONL reader, so this writer emits exactly what that reader parses:
// one session_start head line, then one stored message line per settled
// message, at <userData>/provider-sessions/<appSessionId>.jsonl.
//
// The reader is the contract. sessionFileHead.ts needs the head line plus a
// completed user/assistant exchange to admit a sidebar row, history.ts reads
// cwd, title, the model settings and the provider binding off the head, and
// sessionTranscriptParser.ts maps the content blocks below back to transcript
// events. Changing a shape here without reading those three is a silent
// "session is empty after restart" bug.
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { providerSessionsDir } from '../droidexPaths.js';
import { PERMISSION_SEMANTICS_REVISION } from '../permissionSemantics.js';
import type { SessionSummary, TranscriptEvent } from '../protocol.js';
import type { StoredMessageLine, StoredSessionStart } from '../sessionTranscriptParser.js';
import { storedNoticeLine } from '../sessionNotices.js';

// The head line: a StoredSessionStart plus the settings readSessionModelSettings
// reads off the same record. Without modelId the restored session has no launch
// settings and cannot be resumed.
interface ProviderSessionStart extends StoredSessionStart {
  modelId?: string;
  reasoningEffort?: string;
  autonomyLevel?: string;
  interactionMode: SessionSummary['interactionMode'];
  permissionSemanticsRevision: number;
}

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | {
      type: 'tool_use';
      id?: string;
      name: string;
      input: unknown;
      pollsChildSessionId?: string;
      interrupted?: true;
    }
  | {
      type: 'tool_result';
      tool_use_id?: string;
      name?: string;
      content: string;
      is_error?: boolean;
      pollsChildSessionId?: string;
      interrupted?: true;
    };

interface PendingMessage {
  id: string;
  ts: number;
  blocks: ContentBlock[];
}

export class ProviderTranscriptFile {
  private readonly path: string;
  private pending: PendingMessage | null = null;
  private headWritten = false;
  private promptSeq = 0;
  private readonly children = new Map<string, ProviderTranscriptFile>();

  // Reads the summary when it writes rather than holding a copy: the registry
  // replaces the summary object on every update, and the head line goes out
  // with the first message, so settings applied before the first send and a
  // resume handle minted during create both land on it. A session abandoned
  // before its first turn leaves no file.
  constructor(
    private readonly sessionId: string,
    private readonly summary: () => SessionSummary,
    private readonly parentAppSessionId?: string,
  ) {
    this.path = join(providerSessionsDir(), `${sessionId}.jsonl`);
  }

  // A turn's prompt. The renderer already showed it, so it is persisted here
  // rather than replayed as a live event.
  appendPrompt(text: string): void {
    if (!text) return;
    this.flush();
    const ts = Date.now();
    this.writeMessage('user', [{ type: 'text', text }], `prompt-${this.nextPromptId(ts)}`, ts);
  }

  append(event: TranscriptEvent): void {
    if (event.role !== 'primary' && !this.parentAppSessionId) {
      let child = this.children.get(event.sourceSessionId);
      if (!child) {
        child = new ProviderTranscriptFile(event.sourceSessionId, this.summary, this.sessionId);
        this.children.set(event.sourceSessionId, child);
      }
      child.append(event);
      // Routed children have no independent turn-settlement callback. Persist
      // each coalesced run so replay can read it while the parent is still busy.
      child.flush();
      return;
    }
    if (event.kind === 'text' && event.author === 'user' && !event.spoken) {
      this.flush();
      this.writeMessage('user', [{ type: 'text', text: event.text ?? '' }], event.id, event.ts);
      return;
    }
    if (event.spoken) {
      this.appendSpoken(event);
      return;
    }
    const notice = storedNoticeLine(event);
    if (notice) {
      this.flush();
      this.writeLine(notice);
      return;
    }
    const block = assistantBlock(event);
    if (block) {
      this.pending ??= { id: event.id, ts: event.ts, blocks: [] };
      const previous = this.pending.blocks.at(-1);
      // Adjacent stream deltas must replay as one text or thinking row.
      if (block.type === 'text' && previous?.type === 'text') {
        previous.text += block.text;
      } else if (block.type === 'thinking' && previous?.type === 'thinking') {
        previous.thinking += block.thinking;
      } else {
        this.pending.blocks.push(block);
      }
      return;
    }
    const result = toolResultBlock(event);
    if (!result) return;
    // A result belongs after the call that produced it.
    this.flush();
    this.writeMessage('user', [result], event.id, event.ts);
  }

  // Closes the open assistant message. Called when a turn settles and when the
  // session closes, so one stored line is one settled message.
  flush(): void {
    for (const child of this.children.values()) child.flush();
    const message = this.pending;
    if (!message) return;
    this.writeMessage('assistant', message.blocks, message.id, message.ts);
    this.pending = null;
  }

  private appendSpoken(event: TranscriptEvent): void {
    if (event.kind !== 'text' || !event.text)
      throw new Error('A spoken transcript row must contain text.');
    this.flush();
    this.writeLine({
      type: 'message',
      id: event.id,
      timestamp: new Date(event.ts).toISOString(),
      spoken: true,
      message: {
        role: event.author === 'user' ? 'user' : 'assistant',
        content: [{ type: 'text', text: event.text }],
      },
    });
  }

  private nextPromptId(ts: number): string {
    return `${ts.toString(36)}-${(this.promptSeq++).toString(36)}`;
  }

  private writeMessage(
    role: 'user' | 'assistant',
    content: ContentBlock[],
    id: string,
    ts: number,
  ): void {
    const line: StoredMessageLine = {
      type: 'message',
      id,
      timestamp: new Date(ts).toISOString(),
      message: { role, content },
    };
    this.writeLine(line);
  }

  private writeLine(line: object): void {
    if (!this.headWritten) {
      mkdirSync(providerSessionsDir(), { recursive: true });
      // A resumed session appends to the transcript it already has: one head
      // line per file, written with the session's first message.
      if (!existsSync(this.path)) {
        const summary = this.summary();
        const head: ProviderSessionStart = this.parentAppSessionId
          ? {
              type: 'session_start',
              id: this.sessionId,
              provider: summary.provider,
              cwd: summary.cwd,
              callingSessionId: this.parentAppSessionId,
              interactionMode: summary.interactionMode,
              permissionSemanticsRevision: PERMISSION_SEMANTICS_REVISION,
            }
          : headLine(summary);
        appendFileSync(this.path, serialize(head));
      }
      this.headWritten = true;
    }
    appendFileSync(this.path, serialize(line));
  }
}

function headLine(summary: SessionSummary): ProviderSessionStart {
  return {
    type: 'session_start',
    id: summary.appSessionId,
    provider: summary.provider,
    cwd: summary.cwd,
    title: summary.title,
    autonomyLevel: summary.autonomy,
    interactionMode: summary.interactionMode,
    permissionSemanticsRevision: PERMISSION_SEMANTICS_REVISION,
    ...(summary.resumeId ? { resumeId: summary.resumeId } : {}),
    ...(summary.modelId ? { modelId: summary.modelId } : {}),
    ...(summary.reasoningEffort ? { reasoningEffort: summary.reasoningEffort } : {}),
  };
}

function assistantBlock(event: TranscriptEvent): ContentBlock | null {
  if (event.kind === 'tool_call') {
    return {
      type: 'tool_use',
      ...(event.toolUseId ? { id: event.toolUseId } : {}),
      name: event.toolName ?? 'tool',
      input: event.toolArgs,
      ...(event.pollsChildSessionId ? { pollsChildSessionId: event.pollsChildSessionId } : {}),
      ...(event.interrupted ? { interrupted: true } : {}),
    };
  }
  if (!event.text) return null;
  if (event.kind === 'text') return { type: 'text', text: event.text };
  if (event.kind === 'thinking') return { type: 'thinking', thinking: event.text };
  return null;
}

function toolResultBlock(event: TranscriptEvent): ContentBlock | null {
  if (event.kind !== 'tool_result') return null;
  return {
    type: 'tool_result',
    ...(event.toolUseId ? { tool_use_id: event.toolUseId } : {}),
    ...(event.toolName ? { name: event.toolName } : {}),
    content: event.text ?? '',
    ...(event.isError ? { is_error: true } : {}),
    ...(event.pollsChildSessionId ? { pollsChildSessionId: event.pollsChildSessionId } : {}),
    ...(event.interrupted ? { interrupted: true } : {}),
  };
}

function serialize(line: object): string {
  return `${JSON.stringify(line)}\n`;
}
