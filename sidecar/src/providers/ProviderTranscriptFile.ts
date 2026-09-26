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
import { appendFile, mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { providerSessionsDir } from '../droidexPaths.js';
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
}

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id?: string; name: string; input: unknown }
  | {
      type: 'tool_result';
      tool_use_id?: string;
      name?: string;
      content: string;
      is_error?: boolean;
    };

interface PendingMessage {
  id: string;
  ts: number;
  blocks: ContentBlock[];
}

export class ProviderTranscriptFile {
  private readonly path: string;
  private pending: PendingMessage | null = null;
  private headQueued = false;
  private promptSeq = 0;
  private writes: Promise<void> = Promise.resolve();

  // Reads the summary when it writes rather than holding a copy: the registry
  // replaces the summary object on every update, and the head line goes out
  // with the first message, so settings applied before the first send and a
  // resume handle minted during create both land on it. A session abandoned
  // before its first turn leaves no file.
  constructor(
    appSessionId: string,
    private readonly summary: () => SessionSummary,
  ) {
    this.path = join(providerSessionsDir(), `${appSessionId}.jsonl`);
  }

  // A turn's prompt. The renderer already showed it, so it is persisted here
  // rather than replayed as a live event.
  appendPrompt(text: string): Promise<void> {
    if (!text) return this.writes;
    this.sealMessage();
    const ts = Date.now();
    this.writeMessage('user', [{ type: 'text', text }], `prompt-${this.nextPromptId(ts)}`, ts);
    return this.writes;
  }

  append(event: TranscriptEvent): void | Promise<void> {
    // Child sessions keep their own transcripts; this file is one conversation.
    if (event.role !== 'primary') return;
    if (event.spoken) {
      this.appendSpoken(event);
      return;
    }
    const notice = storedNoticeLine(event);
    if (notice) {
      this.sealMessage();
      this.writeLine(notice);
      return this.writes;
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
    this.sealMessage();
    this.writeMessage('user', [result], event.id, event.ts);
    return this.writes;
  }

  // Closes the open assistant message. Called when a turn settles and when the
  // session closes, so one stored line is one settled message.
  flush(): Promise<void> {
    this.sealMessage();
    return this.writes;
  }

  private sealMessage(): void {
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
    const contents = serialize(line);
    const head = this.headQueued ? undefined : serialize(headLine(this.summary()));
    this.headQueued = true;
    this.writes = this.writes.then(async () => {
      if (head !== undefined) {
        await mkdir(dirname(this.path), { recursive: true });
        const exists = await stat(this.path).then(
          () => true,
          (error: unknown) => {
            if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
            throw error;
          },
        );
        if (!exists) await appendFile(this.path, head);
      }
      await appendFile(this.path, contents);
    });
    // Retain a failed chain for flush to reject; never append past a missing row.
    void this.writes.catch(() => undefined);
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
  };
}

function serialize(line: object): string {
  return `${JSON.stringify(line)}\n`;
}
