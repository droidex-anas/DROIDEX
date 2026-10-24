import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import type { StoredMessageLine } from '../sessionTranscriptParser.js';
import { objectValue, stringValue } from '../values.js';

function keyedBlocks(line: StoredMessageLine): Record<string, unknown>[] {
  if (line.message?.role !== 'assistant') return [];
  const content = line.message.content;
  if (!Array.isArray(content)) return [];
  return content.flatMap((value) => {
    const block = objectValue(value);
    return block && isKeyedBlock(block) ? [block] : [];
  });
}

function isKeyedBlock(block: Record<string, unknown>): boolean {
  return (block.type === 'text' || block.type === 'thinking') && block.textUpdate !== undefined;
}

function messageKey(block: Record<string, unknown>): string {
  const update = objectValue(block.textUpdate);
  const messageId = stringValue(update?.messageId);
  if (!messageId || (update?.kind !== 'delta' && update?.kind !== 'snapshot'))
    throw new Error('Invalid native message identity in saved transcript. Start a new chat.');
  return `${String(block.type)}:${messageId}`;
}

export function storedMessageAnchors(
  line: StoredMessageLine,
  lineIndex: number,
): Map<string, number> {
  const anchors = new Map<string, number>();
  for (const block of keyedBlocks(line)) {
    const start = block.messageStartLine;
    if (typeof start !== 'number' || !Number.isSafeInteger(start) || start < 1 || start > lineIndex)
      throw new Error('Invalid native message anchor in saved transcript. Start a new chat.');
    anchors.set(messageKey(block), start);
  }
  return anchors;
}

// Physical line anchors survive forks, which replace the head but keep message lines.
export class ProviderTranscriptAnchors {
  private initialized = false;
  private nextLine = 0;
  private readonly starts = new Map<string, number>();

  private async initialize(path: string, newHead: boolean): Promise<void> {
    if (this.initialized) return;
    if (newHead) this.nextLine = 1;
    else {
      const input = createReadStream(path);
      const lines = createInterface({ input, crlfDelay: Infinity });
      try {
        let index = 0;
        for await (const raw of lines) {
          if (!raw.trim()) {
            index += 1;
            continue;
          }
          const line = JSON.parse(raw) as StoredMessageLine;
          for (const [key, start] of storedMessageAnchors(line, index)) {
            const previous = this.starts.get(key);
            if (
              (previous === undefined && start !== index) ||
              (previous !== undefined && previous !== start)
            )
              throw new Error(
                'Inconsistent native message anchor in saved transcript. Start a new chat.',
              );
            this.starts.set(key, start);
          }
          index += 1;
        }
        this.nextLine = index;
      } finally {
        lines.close();
        input.destroy();
      }
    }
    this.initialized = true;
  }

  async prepare(
    line: StoredMessageLine,
    path: string,
    newHead: boolean,
  ): Promise<{ line: StoredMessageLine; commit: () => void }> {
    if (!keyedBlocks(line).length)
      return {
        line,
        commit: () => {
          if (this.initialized) this.nextLine += 1;
        },
      };
    await this.initialize(path, newHead);
    const additions = new Map<string, number>();
    const content = line.message?.content?.map((value) => {
      const block = objectValue(value);
      if (line.message?.role !== 'assistant' || !block || !isKeyedBlock(block)) return value;
      const key = messageKey(block);
      const start = this.starts.get(key) ?? this.nextLine;
      additions.set(key, start);
      return { ...block, messageStartLine: start };
    });
    return {
      line: content ? { ...line, message: { ...line.message, content } } : line,
      commit: () => {
        for (const [key, start] of additions) this.starts.set(key, start);
        this.nextLine += 1;
      },
    };
  }
}
