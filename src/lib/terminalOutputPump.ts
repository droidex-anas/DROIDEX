const encoder = new TextEncoder();

const TERMINAL_HIDDEN_BUFFER_BYTES = 2 * 1024 * 1024;
const TERMINAL_PENDING_BLOCK_BYTES = 16 * 1024;

interface PendingChunk {
  parts: string[];
  bytes: number;
  next?: PendingChunk;
}

function trimChunkPrefix(chunk: PendingChunk, dropBytes: number): number {
  const text = chunk.parts.join('');
  let end = 0;
  let bytes = 0;
  while (bytes < dropBytes && end < text.length) {
    const codeUnit = text.charCodeAt(end);
    const nextCodeUnit = text.charCodeAt(end + 1);
    const isSurrogatePair =
      codeUnit >= 0xd800 && codeUnit <= 0xdbff && nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff;
    if (codeUnit <= 0x7f) bytes += 1;
    else if (codeUnit <= 0x7ff) bytes += 2;
    else if (isSurrogatePair) bytes += 4;
    else bytes += 3;
    end += isSurrogatePair ? 2 : 1;
  }
  chunk.parts = [text.slice(end)];
  chunk.bytes -= bytes;
  return bytes;
}

function utf8ByteLength(text: string): number {
  return encoder.encode(text).byteLength;
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
  let lastCodeUnit = 0;
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
      if (!head.bytes) head = head.next;
    }
    if (!head) tail = undefined;
  }

  function joinPending() {
    const chunks: string[] = [];
    for (let chunk = head; chunk; chunk = chunk.next) {
      for (const part of chunk.parts) chunks.push(part);
    }
    return chunks.join('');
  }

  function clearPending() {
    head = tail = undefined;
    pendingBytes = 0;
    lastCodeUnit = 0;
  }

  function flush() {
    cancel();
    if (!head || options.isHidden()) return;
    const data = joinPending();
    clearPending();
    options.write(data);
  }

  function appendPending(data: string) {
    let bytes = utf8ByteLength(data);
    const firstCodeUnit = data.charCodeAt(0);
    const completesPair =
      tail !== undefined &&
      lastCodeUnit >= 0xd800 &&
      lastCodeUnit <= 0xdbff &&
      firstCodeUnit >= 0xdc00 &&
      firstCodeUnit <= 0xdfff;
    const previousCodeUnit = lastCodeUnit;
    lastCodeUnit = data.charCodeAt(data.length - 1);
    if (completesPair) bytes -= 2;
    pendingBytes += bytes;

    if (tail && tail.bytes + bytes <= TERMINAL_PENDING_BLOCK_BYTES) {
      tail.parts.push(data);
      tail.bytes += bytes;
      return;
    }
    if (tail) {
      const text = tail.parts.join('');
      tail.parts = [completesPair ? text.slice(0, -1) : text];
      if (completesPair) {
        tail.bytes -= 3;
        data = String.fromCharCode(previousCodeUnit) + data;
        bytes += 3;
      }
      if (!tail.bytes) {
        tail.parts = [data];
        tail.bytes = bytes;
        return;
      }
    }
    const chunk: PendingChunk = { parts: [data], bytes };
    if (tail) tail.next = chunk;
    else head = chunk;
    tail = chunk;
  }

  function push(data: string) {
    if (!data) return;
    appendPending(data);
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
