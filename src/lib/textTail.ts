// String#lastIndexOf is several times slower than indexOf over long lines, so
// search forward through windows that double back from `end`.
function lastNewlineBefore(text: string, end: number): number {
  for (let size = 256; ; size *= 2) {
    const start = Math.max(0, end - size);
    let newline = -1;
    let at = text.indexOf('\n', start);
    while (at !== -1 && at < end) {
      newline = at;
      at = text.indexOf('\n', at + 1);
    }
    if (newline !== -1 || start === 0) return newline;
  }
}

/** `text.split('\n').slice(-count)` for a positive integer `count`, reading only as far back as those lines reach. */
export function lastLines(text: string, count: number): string[] {
  const lines: string[] = [];
  let end = text.length;
  while (lines.length < count) {
    const newline = lastNewlineBefore(text, end);
    lines.push(text.slice(newline + 1, end));
    if (newline === -1) break;
    end = newline;
  }
  return lines.reverse();
}
