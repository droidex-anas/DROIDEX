const encoder = new TextEncoder();

const TERMINAL_HIDDEN_BUFFER_BYTES = 2 * 1024 * 1024;
const TERMINAL_PENDING_BLOCK_BYTES = 16 * 1024;

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
    const nextCodeUnit = chunk.text.charCodeAt(end + 1);
    const isSurrogatePair =
      codeUnit >= 0xd800 && codeUnit <= 0xdbff && nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff;
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
    let bytes = utf8ByteLength(data);
    const lastCodeUnit = tail?.text.charCodeAt(tail.text.length - 1);
    const endsWithHighSurrogate =
      lastCodeUnit !== undefined && lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff;
    if (tail && (tail.bytes < TERMINAL_PENDING_BLOCK_BYTES || endsWithHighSurrogate)) {
      const firstCodeUnit = data.charCodeAt(0);
      if (endsWithHighSurrogate && firstCodeUnit >= 0xdc00 && firstCodeUnit <= 0xdfff) bytes -= 2;
      tail.text += data;
      tail.bytes += bytes;
    } else {
      const chunk: PendingChunk = { text: data, bytes };
      if (tail) tail.next = chunk;
      else head = chunk;
      tail = chunk;
    }
    pendingBytes += bytes;
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
