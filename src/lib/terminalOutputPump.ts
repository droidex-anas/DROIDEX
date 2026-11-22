const encoder = new TextEncoder();
const decoder = new TextDecoder();

const TERMINAL_HIDDEN_BUFFER_BYTES = 2 * 1024 * 1024;
const UNPAIRED_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;

interface PendingChunk {
  text: string;
  bytes: number;
  next?: PendingChunk;
}

function trimChunkPrefix(chunk: PendingChunk, dropBytes: number): number {
  let end = 0;
  let bytes = 0;
  while (bytes < dropBytes && end < chunk.text.length) {
    const codeUnit = chunk.text.charCodeAt(end);
    const isSurrogatePair = codeUnit >= 0xd800 && codeUnit <= 0xdbff;
    if (codeUnit <= 0x7f) bytes += 1;
    else if (codeUnit <= 0x7ff) bytes += 2;
    else if (isSurrogatePair) bytes += 4;
    else bytes += 3;
    end += isSurrogatePair ? 2 : 1;
  }
  chunk.text = chunk.text.slice(end);
  chunk.bytes -= bytes;
  return bytes;
}

export function utf8ByteLength(text: string): number {
  return encoder.encode(text).byteLength;
}

export function trimUtf8Prefix(
  text: string,
  dropBytes: number,
): { text: string; droppedBytes: number } {
  if (dropBytes <= 0) return { text, droppedBytes: 0 };
  const encoded = encoder.encode(text);
  if (encoded.byteLength <= dropBytes) {
    return { text: '', droppedBytes: encoded.byteLength };
  }
  let start = dropBytes;
  while (start < encoded.length) {
    const byte = encoded[start];
    if ((byte & 0xc0) !== 0x80) break;
    start += 1;
  }
  return { text: decoder.decode(encoded.subarray(start)), droppedBytes: start };
}

export function createTerminalOutputPump(options: {
  write: (data: string) => void;
  isHidden: () => boolean;
  scheduleFrame: (callback: () => void) => number;
  cancelFrame: (id: number) => void;
  maxHiddenBytes?: number;
}) {
  const maxHiddenBytes = options.maxHiddenBytes ?? TERMINAL_HIDDEN_BUFFER_BYTES;
  let head: PendingChunk | undefined;
  let tail: PendingChunk | undefined;
  let hasUnpairedSurrogate = false;
  let pendingBytes = 0;
  let droppedBytes = 0;
  let truncated = false;
  let frame = 0;

  function cancel() {
    if (!frame) return;
    options.cancelFrame(frame);
    frame = 0;
  }

  function capPending() {
    if (pendingBytes <= maxHiddenBytes) return;
    truncated = true;

    // Encoding concatenated strings can repair surrogate pairs split across pushes.
    if (hasUnpairedSurrogate) {
      const trimmed = trimUtf8Prefix(joinPending(), pendingBytes - maxHiddenBytes);
      pendingBytes = utf8ByteLength(trimmed.text);
      head = tail = trimmed.text ? { text: trimmed.text, bytes: pendingBytes } : undefined;
      hasUnpairedSurrogate = false;
      droppedBytes += trimmed.droppedBytes;
      return;
    }

    while (head && pendingBytes > maxHiddenBytes) {
      const overflow = pendingBytes - maxHiddenBytes;
      if (head.bytes <= overflow) {
        pendingBytes -= head.bytes;
        droppedBytes += head.bytes;
        head = head.next;
        continue;
      }
      const bytes = trimChunkPrefix(head, overflow);
      pendingBytes -= bytes;
      droppedBytes += bytes;
      if (!head.text) head = head.next;
    }
    // TextDecoder consumes a leading BOM without counting it as dropped output.
    if (head?.text.startsWith('\uFEFF')) {
      head.text = head.text.slice(1);
      head.bytes -= 3;
      pendingBytes -= 3;
      if (!head.text) head = head.next;
    }
    if (!head) tail = undefined;
  }

  function joinPending() {
    const chunks: string[] = [];
    for (let chunk = head; chunk; chunk = chunk.next) chunks.push(chunk.text);
    return chunks.join('');
  }

  function clearPending() {
    head = tail = undefined;
    pendingBytes = 0;
    hasUnpairedSurrogate = false;
  }

  function flush() {
    cancel();
    if (!head || options.isHidden()) return;
    const data = joinPending();
    clearPending();
    options.write(data);
  }

  function push(data: string) {
    if (!data) return;
    const chunk: PendingChunk = { text: data, bytes: utf8ByteLength(data) };
    if (tail) tail.next = chunk;
    else head = chunk;
    tail = chunk;
    pendingBytes += chunk.bytes;
    hasUnpairedSurrogate ||= UNPAIRED_SURROGATE.test(data);
    if (options.isHidden()) {
      capPending();
      return;
    }
    if (!frame) frame = options.scheduleFrame(flush);
  }

  function reveal() {
    if (options.isHidden()) return;
    flush();
  }

  function dispose() {
    cancel();
    clearPending();
  }

  // Restart clears the screen: buffered output from the previous shell must
  // not land in it, and the trimmed banner must not stick across it.
  function reset() {
    cancel();
    clearPending();
    droppedBytes = 0;
    truncated = false;
  }

  return {
    push,
    flush,
    reveal,
    dispose,
    reset,
    get truncated() {
      return truncated;
    },
    get droppedBytes() {
      return droppedBytes;
    },
  };
}
