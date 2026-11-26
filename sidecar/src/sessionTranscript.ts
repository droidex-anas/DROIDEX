// Lazy session transcript reader.
//
// Opening a session must not parse a multi-MB JSONL file upfront: the reader
// indexes line byte-offsets across the whole file, then preads and JSON.parses
// lines backward, newest first, only as far as each requested window needs.
// Paging older history parses a few hundred more lines per page instead of
// re-reading the whole file, and the bounded per-line parse memo makes repeat
// pages and reopens cheap. Because offsets are absolute, every message of an
// arbitrarily large session stays reachable by cursor.
import { closeSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { open } from 'node:fs/promises';
import {
  parseSessionLineEvents,
  type StoredMessageLine,
  type StoredSessionStart,
} from './sessionTranscriptParser.js';
import type { SessionRole, TranscriptEvent } from '@droidex/protocol';
import { readSessionNotices, sessionNoticesRevision } from './sessionNotices.js';
import {
  CanvasToolPresentation,
  canvasToolProvenance,
  type CanvasToolBinding,
} from './canvas/canvasToolPresentation.js';
import { canvasToolBindingsRevision, readCanvasToolBindings } from './canvas/canvasToolBindings.js';
import { storedMessageAnchors } from './providers/ProviderTranscriptAnchors.js';

// Stored-row shapes are owned by the parser module but re-exported here so
// the history path's import stays stable.
export type { StoredMessageLine, StoredSessionStart } from './sessionTranscriptParser.js';

// Byte budget for summary scans and message-chunk expansion. The lazy reader
// and worker-owned search index have no whole-file materialization cap.
export const MAX_SESSION_BYTES = 5_000_000;
// seq band per line: a line yields one event per content block, so (line,
// event-in-line) maps to a unique, stable, monotonically increasing seq
// within a segment. 256 far exceeds any real message's block count; a freak
// line with more blocks clamps onto the last band slot (order within that
// line is then kept by array order, not seq).
const LINE_EVENT_STRIDE = 256;
// Chunk size for the constructor's newline scan.
const LINE_SCAN_CHUNK_BYTES = 4 * 1024 * 1024;
// Bound on memoized parsed lines: paging deep into a huge session must not
// accumulate its entire parsed transcript in sidecar memory. Eviction is
// insertion-ordered and only costs a re-parse on revisit; 4,096 lines
// comfortably covers the largest history page plus scroll locality.
const MAX_MEMOIZED_LINES = 4_096;

// A position inside one segment's event stream: the next line to parse
// walking backward, plus how many of that line's tail events were already
// served (a page boundary can split one line's events across pages).
export interface TranscriptWindowCursor {
  line: number;
  skip: number;
  notice?: number;
}

// One shared, lazily-opened file descriptor per backward walk.
interface LazyFile {
  fd: number | null;
}

interface ParsedLine {
  events: TranscriptEvent[];
  anchors: Map<string, number>;
  messageSeqs: Map<string, number>;
}

// Read the bytes a summary scan can see: the whole file, or the
// newest MAX_SESSION_BYTES tail for oversized files (the partial first line
// of the window is dropped).
export function readSessionRawWindow(
  path: string,
  size: number,
): { text: string; trimmed: boolean } {
  if (size <= MAX_SESSION_BYTES) return { text: readFileSync(path, 'utf8'), trimmed: false };
  const fd = openSync(path, 'r');
  try {
    const buffer = Buffer.alloc(MAX_SESSION_BYTES);
    readSync(fd, buffer, 0, MAX_SESSION_BYTES, size - MAX_SESSION_BYTES);
    const raw = buffer.toString('utf8');
    const firstNewline = raw.indexOf('\n');
    return {
      text: firstNewline >= 0 ? raw.slice(firstNewline + 1) : raw,
      trimmed: true,
    };
  } finally {
    closeSync(fd);
  }
}

function appendMessageChunk(older: TranscriptEvent, newer: TranscriptEvent): TranscriptEvent {
  return {
    ...older,
    text:
      newer.textUpdate?.kind === 'snapshot' ? newer.text : (older.text ?? '') + (newer.text ?? ''),
    endTs: newer.endTs ?? newer.ts,
    ...(newer.textUpdate?.kind === 'snapshot' ? { textUpdate: newer.textUpdate } : {}),
  };
}

function messageSnapshot(event: TranscriptEvent): TranscriptEvent {
  if (!event.textUpdate) return event;
  return {
    ...event,
    textUpdate: { messageId: event.textUpdate.messageId, kind: 'snapshot' },
  };
}

// Byte offset of every line start in the file, bounded to `size` so bytes
// appended after the stat are ignored (the reader cache re-keys on stat).
// The scan is O(file size) and re-runs on every append, so its reads are
// chunked through the threadpool: a synchronous scan of a tens-of-MB session
// stalled the sidecar event loop for tens of milliseconds on every cold
// history load. Each awaited chunk leaves the loop free between slices; the
// newline indexing that stays on this thread is memchr-speed per chunk.
async function scanLineStarts(path: string, size: number): Promise<number[]> {
  if (size <= 0) return [];
  const starts = [0];
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(Math.min(size, LINE_SCAN_CHUNK_BYTES));
    let position = 0;
    while (position < size) {
      const { bytesRead } = await handle.read(
        buffer,
        0,
        Math.min(buffer.length, size - position),
        position,
      );
      if (bytesRead <= 0) break;
      const chunk = buffer.subarray(0, bytesRead);
      let newline = chunk.indexOf(10 /* \n */);
      while (newline !== -1) {
        const next = position + newline + 1;
        if (next < size) starts.push(next);
        newline = chunk.indexOf(10, newline + 1);
      }
      position += bytesRead;
    }
  } finally {
    await handle.close();
  }
  return starts;
}

// One chain segment's transcript, parsed lazily from the tail. Opening scans
// the file once for line offsets; each window preads and parses only the
// lines it needs, walking backward from a cursor, so the first page of a
// huge session parses a few hundred lines instead of the whole file. Line
// indices are absolute file positions, which keeps cursors stable while the
// session is appended to.
export class SessionTranscriptReader {
  readonly mtimeMs: number;
  readonly sizeBytes: number;
  readonly noticesRevision: string;
  readonly canvasBindingsRevision: string;
  private readonly notices: TranscriptEvent[];
  private readonly lineStarts: number[];
  private readonly parsedLines = new Map<number, ParsedLine>();
  private readonly canvasBindings: CanvasToolBinding[];

  static async open(
    appSessionId: string,
    providerSessionId: string,
    path: string,
    role: SessionRole,
    fullText = false,
  ): Promise<SessionTranscriptReader> {
    const stat = statSync(path);
    const lineStarts = await scanLineStarts(path, stat.size);
    return new SessionTranscriptReader(appSessionId, providerSessionId, path, role, fullText, {
      mtimeMs: stat.mtimeMs,
      sizeBytes: stat.size,
      lineStarts,
    });
  }

  private constructor(
    private readonly appSessionId: string,
    private readonly providerSessionId: string,
    private readonly path: string,
    private readonly role: SessionRole,
    private readonly fullText: boolean,
    scan: { mtimeMs: number; sizeBytes: number; lineStarts: number[] },
  ) {
    this.mtimeMs = scan.mtimeMs;
    this.sizeBytes = scan.sizeBytes;
    this.lineStarts = scan.lineStarts;
    this.noticesRevision = sessionNoticesRevision(providerSessionId);
    this.canvasBindingsRevision = canvasToolBindingsRevision(appSessionId);
    this.canvasBindings = readCanvasToolBindings(appSessionId);
    this.notices = this.noticesRevision
      ? readSessionNotices(appSessionId, providerSessionId, role)
      : [];
  }

  // Serve up to `limit` events ending at `from` (or the segment tail),
  // walking backward. Returned events are in forward (chronological) order
  // with seq = seqBase + segment-local position. `older` is set when the
  // segment still has unserved events below the returned page.
  windowBackward(
    limit: number,
    seqBase: number,
    from?: TranscriptWindowCursor,
  ): { events: TranscriptEvent[]; older?: TranscriptWindowCursor } {
    if (this.lineStarts.length === 0 && this.notices.length === 0) return { events: [] };
    // The fd opens lazily on the first memo miss and is shared across the
    // walk, so a fully-memoized repeat page never touches the file.
    const file: LazyFile = { fd: null };
    let collected: TranscriptEvent[];
    let older: TranscriptWindowCursor | undefined;
    try {
      ({ collected, older } = this.collectBackward(file, limit, from));
    } finally {
      if (file.fd !== null) closeSync(file.fd);
    }
    collected.reverse().sort((left, right) => (left.seq ?? 0) - (right.seq ?? 0));
    return {
      events: collected.map((e) => ({ ...messageSnapshot(e), seq: seqBase + (e.seq ?? 0) })),
      ...(older ? { older } : {}),
    };
  }

  // Walk lines backward from `from` (or the tail), collecting up to `limit`
  // events newest-first. `older` addresses the first unserved event.
  private collectBackward(
    file: LazyFile,
    limit: number,
    from?: TranscriptWindowCursor,
  ): { collected: TranscriptEvent[]; older?: TranscriptWindowCursor } {
    const collected: TranscriptEvent[] = []; // newest first
    const messageIndexes = new Map<string, number>();
    // This walk starts at the tail, where a spoken row's latest correction lives.
    const seenSpoken = new Set<string>();
    let line = from ? from.line : this.lineStarts.length - 1;
    let skip = from?.skip ?? 0;
    let notice = from ? (from.notice ?? -1) : this.notices.length - 1;
    let earliestMessageSeq = Infinity;
    let expansionStart: number | undefined;
    while (line >= 0 || notice >= 0) {
      if (
        collected.length >= limit &&
        (earliestMessageSeq === Infinity ||
          (line > 0 && (line + 2) * LINE_EVENT_STRIDE <= earliestMessageSeq))
      )
        break;
      const parsed = line >= 0 ? this.parseLine(file, line) : undefined;
      const events = parsed?.events ?? [];
      const candidate = events.at(-skip - 1);
      if (line >= 0 && !candidate) {
        line -= 1;
        skip = 0;
        continue;
      }
      const nextNotice = notice >= 0 ? this.notices.at(notice) : undefined;
      if (collected.length >= limit) {
        if (!candidate || (candidate.seq ?? 0) < earliestMessageSeq) break;
        expansionStart ??= this.lineStarts[line + 1] ?? this.sizeBytes;
        if (expansionStart - this.lineStarts[line] > MAX_SESSION_BYTES)
          throw new Error(
            'A native message spans more than 5 MB of interleaved history. Start a new chat to continue.',
          );
      }
      if (nextNotice && (!candidate || nextNotice.ts >= candidate.ts)) {
        // Notices sit after their preceding provider event, without changing
        // that event's stable line-based ordering or splitting its seq band.
        collected.push({
          ...nextNotice,
          seq: (candidate?.seq ?? 0) + (notice + 1) / (this.notices.length + 1),
        });
        notice -= 1;
      } else if (candidate) {
        const messageIndex = candidate.textUpdate ? messageIndexes.get(candidate.id) : undefined;
        if (candidate.textUpdate) {
          const anchor = parsed?.anchors.get(`${candidate.kind}:${candidate.textUpdate.messageId}`);
          // A start row lost to corruption leaves the message beginning here.
          const firstSeq =
            anchor === undefined
              ? undefined
              : this.parseLine(file, anchor).messageSeqs.get(candidate.id);
          earliestMessageSeq = Math.min(earliestMessageSeq, firstSeq ?? candidate.seq ?? 0);
        }
        if (!candidate.spoken || !seenSpoken.has(candidate.id)) {
          if (messageIndex !== undefined)
            collected[messageIndex] = appendMessageChunk(candidate, collected[messageIndex]);
          else {
            if (candidate.textUpdate) messageIndexes.set(candidate.id, collected.length);
            collected.push(this.projectEvent(file, line, candidate));
          }
          if (candidate.spoken) seenSpoken.add(candidate.id);
        }
        skip += 1;
        if (skip === events.length) {
          line -= 1;
          skip = 0;
        }
      }
    }
    return {
      collected,
      ...(line >= 0 || notice >= 0
        ? { older: { line, skip, ...(this.notices.length ? { notice } : {}) } }
        : {}),
    };
  }

  private projectEvent(file: LazyFile, line: number, candidate: TranscriptEvent): TranscriptEvent {
    if (candidate.kind !== 'tool_call' && candidate.kind !== 'tool_result') return candidate;
    const canvas = new CanvasToolPresentation(this.canvasBindings);
    if (candidate.kind === 'tool_call' || !candidate.toolUseId)
      return canvas.project(candidate, undefined, candidate.id);
    // Resolve against the preceding occurrence, not whichever page was visited
    // last. Calls outside the requested page remain available through the memo.
    for (let index = line; index >= 0; index -= 1) {
      const { events } = this.parseLine(file, index);
      const before = index === line ? events.indexOf(candidate) : events.length;
      for (let block = before - 1; block >= 0; block -= 1) {
        const call = events[block];
        if (call.kind !== 'tool_call' || call.toolUseId !== candidate.toolUseId) continue;
        const provenance = canvasToolProvenance(call.toolName, call.toolUseId);
        if (!provenance && !call.canvasActivity) return candidate;
        canvas.project(call, provenance, call.id);
        return canvas.project(candidate, undefined, call.id);
      }
    }
    return canvas.project(candidate);
  }

  private parseLine(file: LazyFile, index: number): ParsedLine {
    const hit = this.parsedLines.get(index);
    if (hit) return hit;
    // A cursor minted against a since-rewritten (compacted) file can address
    // lines past the end; serve nothing for them instead of a wrong page.
    if (index >= this.lineStarts.length)
      return { events: [], anchors: new Map(), messageSeqs: new Map() };
    const start = this.lineStarts[index];
    const end = index + 1 < this.lineStarts.length ? this.lineStarts[index + 1] : this.sizeBytes;
    let events: TranscriptEvent[] = [];
    let anchors = new Map<string, number>();
    if (end > start) {
      file.fd ??= openSync(this.path, 'r');
      const buffer = Buffer.alloc(end - start);
      readSync(file.fd, buffer, 0, end - start, start);
      const raw = buffer.toString('utf8').trim();
      if (raw) {
        try {
          const stored = JSON.parse(raw) as StoredMessageLine | StoredSessionStart;
          const lineEvents = parseSessionLineEvents(
            this.appSessionId,
            this.providerSessionId,
            this.role,
            stored,
            { fullText: this.fullText, canvas: null },
          );
          anchors = storedMessageAnchors(stored, index);
          events = lineEvents;
        } catch {
          /* skip partial/corrupt JSONL rows */
        }
      }
    }
    const base = (index + 1) * LINE_EVENT_STRIDE;
    const messageSeqs = new Map<string, number>();
    events.forEach((e, i) => {
      e.seq = base + Math.min(i, LINE_EVENT_STRIDE - 1);
      if (e.textUpdate && !messageSeqs.has(e.id)) messageSeqs.set(e.id, e.seq);
    });
    const parsed = { events, anchors, messageSeqs };
    this.parsedLines.set(index, parsed);
    if (this.parsedLines.size > MAX_MEMOIZED_LINES) {
      const oldest = this.parsedLines.keys().next().value;
      if (oldest !== undefined) this.parsedLines.delete(oldest);
    }
    return parsed;
  }
}
