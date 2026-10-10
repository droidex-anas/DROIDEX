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
import { appendFile, copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { providerSessionsDir } from '../droidexPaths.js';
import { PERMISSION_SEMANTICS_REVISION } from '../permissionSemantics.js';
import type { ContextWindowTokens, SessionSummary, TranscriptEvent } from '../protocol.js';
import type { StoredMessageLine, StoredSessionStart } from '../sessionTranscriptParser.js';
import { STEER_MESSAGE_PREFIX } from '../sessionTranscriptParser.js';
import { storedNoticeLine } from '../sessionNotices.js';

// The head line: a StoredSessionStart plus the settings readSessionModelSettings
// reads off the same record. Without modelId the restored session has no launch
// settings and cannot be resumed.
interface ProviderSessionStart extends StoredSessionStart {
  modelId?: string;
  reasoningEffort?: string;
  fastMode?: boolean;
  contextWindowTokens?: ContextWindowTokens;
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
      // The saved files of the pictures the result carried.
      images?: string[];
      is_error?: boolean;
      pollsChildSessionId?: string;
      interrupted?: true;
    };

interface PendingMessage {
  id: string;
  ts: number;
  blocks: ContentBlock[];
  forkPointId?: string;
}

export class ProviderTranscriptFile {
  readonly path: string;
  private pending: PendingMessage | null = null;
  private headWritten = false;
  private promptSeq = 0;
  // The tail of the write queue. It never rejects: a line that fails is
  // reported to the caller that wrote it, and the lines after it still go out.
  private writes: Promise<void> = Promise.resolve();
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
  appendPrompt(text: string, steered = false): Promise<void> {
    if (!text) return this.writes;
    const ts = Date.now();
    return this.sealThenWrite(
      messageLine(
        'user',
        [{ type: 'text', text }],
        `${steered ? STEER_MESSAGE_PREFIX : 'prompt-'}${this.nextPromptId(ts)}`,
        ts,
      ),
    );
  }

  append(event: TranscriptEvent): void | Promise<void> {
    if (event.role !== 'primary' && !this.parentAppSessionId) return this.appendToChild(event);
    if (event.kind === 'text' && event.author === 'user' && !event.spoken) {
      return this.sealThenWrite(
        messageLine(
          'user',
          [{ type: 'text', text: event.text ?? '' }],
          event.steered ? `${STEER_MESSAGE_PREFIX}${event.id}` : event.id,
          event.ts,
        ),
      );
    }
    if (event.spoken) return this.sealThenWrite(spokenLine(event));
    const notice = storedNoticeLine(event);
    if (notice) return this.sealThenWrite(notice);
    const block = assistantBlock(event);
    if (block) {
      this.pending ??= { id: event.id, ts: event.ts, blocks: [] };
      if (event.forkPointId) this.pending.forkPointId = event.forkPointId;
      addBlock(this.pending.blocks, block);
      return;
    }
    const result = toolResultBlock(event);
    if (!result) return;
    // A result belongs after the call that produced it.
    return this.sealThenWrite(messageLine('user', [result], event.id, event.ts));
  }

  // Called when a turn settles and when the session closes. Settles once
  // everything queued here and in the child files has been tried, and rejects
  // when a message it closed could not be written.
  async flush(): Promise<void> {
    const flushing = [this.sealMessage() ?? this.writes];
    for (const child of this.children.values()) flushing.push(child.flush());
    const failed = (await Promise.allSettled(flushing)).find(
      (result) => result.status === 'rejected',
    );
    if (failed) throw failed.reason;
  }

  // Every line queued so far is on disk. Unlike flush, the message still
  // streaming stays open, so a reader never splits it into two stored lines.
  written(): Promise<void> {
    return this.writes;
  }

  read(): Promise<string> {
    const reading = this.writes.then(() => readFile(this.path, 'utf8'));
    this.writes = reading.then(
      () => undefined,
      () => undefined,
    );
    return reading;
  }

  // Routed children have no independent turn-settlement callback. Persist
  // each coalesced run so replay can read it while the parent is still busy.
  private appendToChild(event: TranscriptEvent): Promise<void> {
    let child = this.children.get(event.sourceSessionId);
    if (!child) {
      child = new ProviderTranscriptFile(event.sourceSessionId, this.summary, this.sessionId);
      this.children.set(event.sourceSessionId, child);
    }
    return Promise.all([child.append(event), child.flush()]).then(() => undefined);
  }

  // Closes the open assistant message, so one stored line is one settled
  // message.
  private sealMessage(): Promise<void> | undefined {
    const message = this.pending;
    if (!message) return undefined;
    this.pending = null;
    return this.writeLine(
      messageLine('assistant', message.blocks, message.id, message.ts, message.forkPointId),
    );
  }

  private sealThenWrite(line: object): Promise<void> {
    const sealed = this.sealMessage();
    const written = this.writeLine(line);
    return sealed ? Promise.all([sealed, written]).then(() => undefined) : written;
  }

  private nextPromptId(ts: number): string {
    return `${ts.toString(36)}-${(this.promptSeq++).toString(36)}`;
  }

  // Resolves when this line is on disk and rejects, for the caller that wrote
  // it, when it is not. The queue carries on either way: one failed line must
  // not cost the session the lines after it, or hold its close.
  private writeLine(line: object): Promise<void> {
    const contents = serialize(line);
    const attempt = this.writes.then(async () => {
      await appendFile(this.path, (await this.headIfMissing()) + contents);
      this.headWritten = true;
    });
    this.writes = attempt.catch(() => undefined);
    return attempt;
  }

  // A resumed session appends to the transcript it already has: one head line
  // per file, written with the session's first message. A file a failed first
  // write left empty has no head yet.
  private async headIfMissing(): Promise<string> {
    if (this.headWritten) return '';
    await mkdir(dirname(this.path), { recursive: true });
    if (await hasContent(this.path)) return '';
    const summary = this.summary();
    return serialize(
      this.parentAppSessionId
        ? childHeadLine(summary, this.sessionId, this.parentAppSessionId)
        : headLine(summary),
    );
  }
}

// Adjacent stream deltas must replay as one text or thinking row.
function addBlock(blocks: ContentBlock[], block: ContentBlock): void {
  const previous = blocks.at(-1);
  if (block.type === 'text' && previous?.type === 'text') previous.text += block.text;
  else if (block.type === 'thinking' && previous?.type === 'thinking')
    previous.thinking += block.thinking;
  else blocks.push(block);
}

async function hasContent(path: string): Promise<boolean> {
  try {
    return (await stat(path)).size > 0;
  } catch (error) {
    if (isMissingFile(error)) return false;
    throw error;
  }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function messageLine(
  role: 'user' | 'assistant',
  content: ContentBlock[],
  id: string,
  ts: number,
  forkPointId?: string,
): StoredMessageLine {
  return {
    type: 'message',
    id,
    timestamp: new Date(ts).toISOString(),
    message: { role, content },
    ...(forkPointId ? { forkPointId } : {}),
  };
}

function spokenLine(event: TranscriptEvent): object {
  if (event.kind !== 'text' || !event.text)
    throw new Error('A spoken transcript row must contain text.');
  return {
    type: 'message',
    id: event.id,
    timestamp: new Date(event.ts).toISOString(),
    spoken: true,
    message: {
      role: event.author === 'user' ? 'user' : 'assistant',
      content: [{ type: 'text', text: event.text }],
    },
  };
}

// A closed session's transcript. An open one is read through its writer, which
// holds the lines still on their way to the file.
export function readProviderTranscript(appSessionId: string): Promise<string> {
  return readFile(join(providerSessionsDir(), `${appSessionId}.jsonl`), 'utf8');
}

// The part of a session's transcript a fork copies: all of it, or every line
// up to the last one of the answer at `forkPointId`. Read before the copy is
// written, so a point the transcript never recorded fails the fork without
// leaving a DROIDEX copy behind.
export interface ForkedTranscript {
  sourceAppSessionId: string;
  head: ProviderSessionStart;
  lines: string[];
}

export function forkedTranscript(
  sourceAppSessionId: string,
  stored: string,
  forkPointId?: string,
): ForkedTranscript {
  const [headText = '', ...lines] = stored.split('\n').filter((line) => line.trim() !== '');
  const head = JSON.parse(headText) as ProviderSessionStart;
  if (!forkPointId) return { sourceAppSessionId, head, lines };
  const last = lines.findLastIndex((line) => storedForkPointId(line) === forkPointId);
  if (last < 0) throw new Error('This answer was saved before forking from it was possible.');
  return { sourceAppSessionId, head, lines: lines.slice(0, last + 1) };
}

// A forked conversation's transcript: the source's messages under a head that
// names the copy. The provider copied its own record of the conversation; this
// is DROIDEX's, which scrollback and the sidebar read. A provider that gives
// the copy new ids for its fork points names them in `forkPointRenames`.
// Resolves to the new path.
export async function writeForkedTranscript(
  transcript: ForkedTranscript,
  copy: {
    appSessionId: string;
    title: string;
    resumeId?: string;
    forkPointRenames?: ReadonlyMap<string, string>;
    // A copy on a model of its own runs that model's own window, so the
    // source's pin stays behind.
    dropContextWindow?: boolean;
  },
): Promise<string> {
  const directory = providerSessionsDir();
  const path = join(directory, `${copy.appSessionId}.jsonl`);
  const head: ProviderSessionStart = {
    ...withoutContextWindow(transcript.head, copy.dropContextWindow),
    id: copy.appSessionId,
    title: copy.title,
    ...(copy.resumeId ? { resumeId: copy.resumeId } : {}),
  };
  const renames = copy.forkPointRenames;
  const lines = renames
    ? transcript.lines.map((line) => renameForkPoint(line, renames))
    : transcript.lines;
  await writeFile(path, [serialize(head), ...lines.map((line) => `${line}\n`)].join(''));
  const settingsFrom = join(directory, `${transcript.sourceAppSessionId}.settings.json`);
  const settingsTo = join(directory, `${copy.appSessionId}.settings.json`);
  try {
    if (copy.dropContextWindow) {
      const settings = JSON.parse(await readFile(settingsFrom, 'utf8')) as Record<string, unknown>;
      await writeFile(settingsTo, JSON.stringify(withoutContextWindow(settings, true)));
    } else await copyFile(settingsFrom, settingsTo);
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }
  return path;
}

function storedForkPointId(line: string): string | undefined {
  try {
    return (JSON.parse(line) as StoredMessageLine).forkPointId;
  } catch {
    return undefined;
  }
}

function renameForkPoint(line: string, renames: ReadonlyMap<string, string>): string {
  const forkPointId = storedForkPointId(line);
  const renamed = forkPointId ? renames.get(forkPointId) : undefined;
  if (!renamed) return line;
  return JSON.stringify({ ...(JSON.parse(line) as StoredMessageLine), forkPointId: renamed });
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
    ...(summary.fastMode !== undefined ? { fastMode: summary.fastMode } : {}),
    ...(summary.contextWindowTokens !== undefined
      ? { contextWindowTokens: summary.contextWindowTokens }
      : {}),
  };
}

function childHeadLine(
  summary: SessionSummary,
  childSessionId: string,
  parentAppSessionId: string,
): ProviderSessionStart {
  return {
    type: 'session_start',
    id: childSessionId,
    provider: summary.provider,
    cwd: summary.cwd,
    callingSessionId: parentAppSessionId,
    interactionMode: summary.interactionMode,
    permissionSemanticsRevision: PERMISSION_SEMANTICS_REVISION,
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
    ...(event.images ? { images: event.images } : {}),
    ...(event.isError ? { is_error: true } : {}),
    ...(event.pollsChildSessionId ? { pollsChildSessionId: event.pollsChildSessionId } : {}),
    ...(event.interrupted ? { interrupted: true } : {}),
  };
}

function serialize(line: object): string {
  return `${JSON.stringify(line)}\n`;
}

function withoutContextWindow<T extends { contextWindowTokens?: unknown }>(
  value: T,
  drop: boolean | undefined,
): T {
  if (!drop || value.contextWindowTokens === undefined) return value;
  const copy = { ...value };
  delete copy.contextWindowTokens;
  return copy;
}
