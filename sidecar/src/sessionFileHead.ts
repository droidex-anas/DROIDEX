import { closeSync, openSync, readSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';

import { isLlmOnlyMessage } from './sessionTranscriptParser.js';
import type { StoredSessionStart } from './sessionTranscript.js';
import { objectValue } from './values.js';

// Everything the session list needs from one on-disk session file. Building a
// sidebar row must never depend on the transcript body, so this is the only
// read the discovery path performs per file.
export interface SessionFileHead {
  start: StoredSessionStart;
  // A provider writes session_start before the first prompt, so an abandoned
  // turn leaves a valid file with no completed exchange. Those are not durable
  // conversations and must not become permanent sidebar rows. A prompt answered
  // only by a stored error row is one: that is how a crashed chat ended.
  hasCompletedConversation: boolean;
}

// A session_start plus an opening exchange almost always fits in the first few
// kilobytes, and a folder can hold thousands of session files, so the window
// starts small and only grows for files that hide it behind larger records.
const FIRST_SCAN_CHUNK_BYTES = 8 * 1024;
const MAX_SCAN_CHUNK_BYTES = 64 * 1024;
// The session_start record is the first JSONL line, so give up on finding it
// after a few lines rather than parsing an entire head.
const MAX_START_LINES = 8;

export function readSessionFileHead(path: string, sizeBytes: number): SessionFileHead {
  let start: StoredSessionStart | undefined;
  let startLines = 0;
  let hasPrompt = false;
  let hasAnswer = false;

  for (const line of sessionLines(path, sizeBytes)) {
    if (!start && startLines < MAX_START_LINES) {
      startLines += 1;
      start = parseSessionStart(line);
    }
    const part = exchangePart(line);
    if (part === 'prompt') hasPrompt = true;
    if (part === 'answer') hasAnswer = true;
    // Both answers are settled; nothing further in the file can change them.
    const startSettled = start !== undefined || startLines >= MAX_START_LINES;
    if (startSettled && hasPrompt && hasAnswer) break;
  }

  return {
    start: start ?? {},
    hasCompletedConversation: hasPrompt && hasAnswer,
  };
}

export function readSessionStart(path: string, sizeBytes: number): StoredSessionStart {
  let lines = 0;
  for (const line of sessionLines(path, sizeBytes)) {
    lines += 1;
    const start = parseSessionStart(line);
    if (start) return start;
    if (lines >= MAX_START_LINES) break;
  }
  return {};
}

// Streams complete JSONL lines from the head of the file. Callers that break
// out early never pay for the transcript body behind them.
function* sessionLines(path: string, sizeBytes: number): Generator<string> {
  if (sizeBytes <= 0) return;
  const fd = openSync(path, 'r');
  try {
    const decoder = new StringDecoder('utf8');
    let chunkBytes = FIRST_SCAN_CHUNK_BYTES;
    let offset = 0;
    let pending = '';
    while (offset < sizeBytes) {
      const chunk = Buffer.alloc(Math.min(chunkBytes, sizeBytes - offset));
      const bytesRead = readSync(fd, chunk, 0, chunk.length, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
      chunkBytes = Math.min(chunkBytes * 2, MAX_SCAN_CHUNK_BYTES);
      const lines = `${pending}${decoder.write(chunk.subarray(0, bytesRead))}`.split(/\r?\n/);
      pending = lines.pop() ?? '';
      for (const line of lines) if (line) yield line;
    }
    pending += decoder.end();
    if (pending) yield pending;
  } finally {
    closeSync(fd);
  }
}

function parseSessionStart(line: string): StoredSessionStart | undefined {
  try {
    const row = JSON.parse(line) as StoredSessionStart;
    return row.type === 'session_start' ? row : undefined;
  } catch {
    return undefined;
  }
}

// What one stored line contributes to a settled exchange. DROIDEX's own error
// row answers a prompt the same way an assistant message does: the turn ended
// there, and that chat still belongs in the sidebar.
function exchangePart(line: string): 'prompt' | 'answer' | undefined {
  try {
    const parsed: unknown = JSON.parse(line);
    const record = objectValue(parsed);
    // The text is what makes it a row worth showing; a bare marker is not one.
    if (record?.type === 'error' && typeof record.text === 'string') return 'answer';
    if (record?.type !== 'message') return undefined;
    const message = objectValue(record.message);
    if (isLlmOnlyMessage(message)) return undefined;
    if (message?.role === 'user') return 'prompt';
    return message?.role === 'assistant' ? 'answer' : undefined;
  } catch {
    return undefined;
  }
}
