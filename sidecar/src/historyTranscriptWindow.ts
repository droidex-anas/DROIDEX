import { existsSync, statSync } from 'node:fs';
import type { SessionRole, TranscriptEvent } from '@droidex/protocol';
import { SessionTranscriptReader, type TranscriptWindowCursor } from './sessionTranscript.js';
import { sessionNoticesRevision } from './sessionNotices.js';
import { canvasToolBindingsRevision } from './canvas/canvasToolBindings.js';

// How many orchestrator scrollback events to load per page (initial open and
// each lazy older-page fetch). Bounds work for very long, multi-compaction chats.
const DEFAULT_HISTORY_WINDOW = 400;
// Per-segment span used to derive a global monotonic `seq` from a chain index +
// in-segment position. Must exceed any single segment's seq band: the reader
// assigns each line a LINE_EVENT_STRIDE band, so the ceiling is
// (1<<27)/256 = 524,288 lines per segment — multi-GB at the multi-KB lines
// real sessions store, far beyond any observed file.
const SEQ_SEGMENT_STRIDE = 1 << 27;
const MAX_TRANSCRIPT_READERS = 12;

// Transcript window cursors: "v2:<chainIdx>:<line>:<skip>" addresses a
// line/event position inside one segment; "v2:<chainIdx>:end" starts at a
// segment's tail. Pre-v2 cursors addressed item indexes that no longer exist;
// only their "<chainIdx>:end" form still maps, anything else ends paging
// cleanly (empty page, no cursor) instead of serving a wrong page.
function parseTranscriptCursor(
  cursor: string,
): { ci: number; from?: TranscriptWindowCursor } | null {
  const parts = cursor.split(':');
  if (parts[0] === 'v2') {
    const ci = Number(parts[1]);
    if (!Number.isInteger(ci) || ci < 0) return null;
    if (parts[2] === 'end' && parts.length === 3) return { ci };
    const from = parseTranscriptPosition(parts.slice(2));
    return from ? { ci, from } : null;
  }
  const ci = Number(parts[0]);
  if (parts.length === 2 && parts[1] === 'end' && Number.isInteger(ci) && ci >= 0) return { ci };
  return null;
}

function parseTranscriptPosition(parts: string[]): TranscriptWindowCursor | null {
  const line = Number(parts[0]);
  const skip = Number(parts[1]);
  const notice = parts.length === 3 ? Number(parts[2]) : undefined;
  if (
    (parts.length !== 2 && parts.length !== 3) ||
    !Number.isInteger(line) ||
    !Number.isInteger(skip)
  )
    return null;
  if (notice !== undefined && (!Number.isInteger(notice) || notice < -1)) return null;
  if (line < (notice === undefined ? 0 : -1) || skip < 0) return null;
  return { line, skip, ...(notice !== undefined ? { notice } : {}) };
}

export class HistoryTranscriptWindow {
  // Parsed-segment readers, LRU-bounded: repeat pages and session reopens hit a
  // warm reader instead of re-reading and re-parsing the file. Freshness is
  // validated by stat (mtime + size) on every window, so a live-appended or
  // compacted file is re-read exactly once per change. Entries hold the open
  // promise so overlapping windows share one in-flight line scan.
  private readonly readers = new Map<
    string,
    {
      mtimeMs: number;
      sizeBytes: number;
      appSessionId: string;
      role: SessionRole;
      reader: Promise<SessionTranscriptReader>;
    }
  >();

  private async readerFor(
    appSessionId: string,
    providerSessionId: string,
    path: string,
    role: SessionRole,
  ): Promise<SessionTranscriptReader> {
    const stat = statSync(path);
    const cached = this.readers.get(path);
    if (
      cached?.mtimeMs === stat.mtimeMs &&
      cached.sizeBytes === stat.size &&
      cached.appSessionId === appSessionId &&
      cached.role === role
    ) {
      const reader = await cached.reader.catch(() => undefined);
      if (
        reader?.noticesRevision === sessionNoticesRevision(providerSessionId) &&
        reader.canvasBindingsRevision === canvasToolBindingsRevision(appSessionId)
      ) {
        this.readers.delete(path);
        this.readers.set(path, cached);
        return reader;
      }
    }
    const opened = SessionTranscriptReader.open(appSessionId, providerSessionId, path, role);
    const entry = {
      mtimeMs: stat.mtimeMs,
      sizeBytes: stat.size,
      appSessionId,
      role,
      reader: opened,
    };
    this.readers.delete(path);
    this.readers.set(path, entry);
    if (this.readers.size > MAX_TRANSCRIPT_READERS) {
      const oldest = this.readers.keys().next().value;
      if (oldest) this.readers.delete(oldest);
    }
    try {
      return await opened;
    } catch (error) {
      // A failed scan is retried by the next window rather than cached.
      if (this.readers.get(path) === entry) this.readers.delete(path);
      throw error;
    }
  }

  invalidate(): void {
    this.readers.clear();
  }

  // Window the primary transcript backward across the compaction chain.
  // Segments are read newest -> oldest only as far as needed to fill `limit`,
  // and each segment parses its lines lazily from the tail, so a months-long,
  // heavily-compacted chat opens fast and pages older history in on demand.
  async loadWindow(
    sessionIndex: ReadonlyMap<string, string>,
    appSessionId: string,
    chainProviderSessionIds: string[],
    opts: { cursor?: string; limit?: number; role?: SessionRole; fullText?: boolean } = {},
  ): Promise<{ events: TranscriptEvent[]; olderCursor?: string }> {
    const limit = Math.max(1, opts.limit ?? DEFAULT_HISTORY_WINDOW);
    const role = opts.role ?? 'primary';
    const chain = chainProviderSessionIds.flatMap((providerSessionId) => {
      const path = sessionIndex.get(providerSessionId);
      return path === undefined ? [] : [{ providerSessionId, path }];
    });
    if (chain.length === 0) return { events: [] };

    let startIdx = chain.length - 1;
    let from: TranscriptWindowCursor | undefined;
    if (opts.cursor) {
      const parsed = parseTranscriptCursor(opts.cursor);
      if (!parsed || parsed.ci >= chain.length) return { events: [] };
      startIdx = parsed.ci;
      from = parsed.from;
    }

    const picked: TranscriptEvent[] = [];
    let olderCursor: string | undefined;
    const segments = chain.slice(0, startIdx + 1).reverse();
    for (const [offset, { providerSessionId, path }] of segments.entries()) {
      const ci = startIdx - offset;
      const reader = opts.fullText
        ? await SessionTranscriptReader.open(appSessionId, providerSessionId, path, role, true)
        : await this.readerFor(appSessionId, providerSessionId, path, role);
      // Chain-derived monotonic order: older segments (lower ci) and earlier
      // in-segment positions sort first, independent of wall-clock ts.
      const window = reader.windowBackward(
        limit - picked.length,
        ci * SEQ_SEGMENT_STRIDE,
        ci === startIdx ? from : undefined,
      );
      picked.unshift(...window.events);
      if (window.older) {
        const notice = window.older.notice;
        olderCursor = `v2:${String(ci)}:${String(window.older.line)}:${String(window.older.skip)}${notice !== undefined ? `:${String(notice)}` : ''}`;
        break;
      }
      if (picked.length >= limit) {
        if (ci > 0) olderCursor = `v2:${String(ci - 1)}:end`;
        break;
      }
    }
    return { events: picked, olderCursor };
  }

  async loadOpenTail(
    appSessionId: string,
    path: string,
    limit: number,
    fullText = false,
  ): Promise<TranscriptEvent[]> {
    if (!existsSync(path)) return [];
    const reader = fullText
      ? await SessionTranscriptReader.open(appSessionId, appSessionId, path, 'primary', true)
      : await this.readerFor(appSessionId, appSessionId, path, 'primary');
    return reader.windowBackward(Math.max(1, limit), 0).events;
  }
}
