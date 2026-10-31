import type ts from 'typescript';

// Map every UTF-16 column, including both edges of an insertion. A line-only
// map would silently collapse later token columns when esbuild composes it.
export function inlineSourceMap(
  source: ts.SourceFile,
  inserts: { at: number; text: string }[],
): string {
  const lines = source.getLineStarts();
  let index = 0;
  let previousColumn = 0;
  const mappings = lines
    .map((start, line) => {
      const segments = [vlq(0) + vlq(0) + vlq(line === 0 ? 0 : 1) + vlq(-previousColumn)];
      previousColumn = 0;
      const nextLine = lines.at(line + 1);
      while (index < inserts.length) {
        const insert = inserts.at(index);
        if (!insert || insert.at >= (nextLine ?? Infinity)) break;
        const column = insert.at - start;
        segments.push(',CAAC'.repeat(column - previousColumn), ',', vlq(insert.text.length), 'AAA');
        previousColumn = column;
        index++;
      }
      const lastColumn = (nextLine === undefined ? source.text.length : nextLine - 1) - start;
      segments.push(',CAAC'.repeat(lastColumn - previousColumn));
      previousColumn = lastColumn;
      return segments.join('');
    })
    .join(';');
  const map = {
    version: 3,
    sources: [`canvas-design:${source.fileName}`],
    sourcesContent: [source.text],
    names: [],
    mappings,
  };
  return `\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(map)).toString('base64')}\n`;
}

function vlq(value: number): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let encoded = '';
  let rest = value < 0 ? -value * 2 + 1 : value * 2;
  do {
    const digit = rest % 32;
    rest = Math.floor(rest / 32);
    encoded += alphabet[digit + (rest ? 32 : 0)];
  } while (rest);
  return encoded;
}
