// Text-level helpers for rewriting JSX where it is written: its lines, their
// indentation, and the file's own indent step, so an edit keeps the file's style.

import ts from 'typescript';

/** The layer's text, with its whole line when it stands alone on one, so no blank line is left. */
export function cutRange(text: string, node: ts.Node): { start: number; end: number } {
  const start = node.getStart();
  const lineEnd = text.indexOf('\n', node.end);
  const alone =
    startsLine(text, start) && lineEnd !== -1 && /^[ \t]*\r?$/.test(text.slice(node.end, lineEnd));
  return alone ? { start: lineStart(text, start), end: lineEnd + 1 } : { start, end: node.end };
}

/**
 * The node's text with every line after the first shifted from one indentation
 * to another; blank lines and lines inside a string or template stay as written.
 */
export function reindent(node: ts.Node, from: string, to: string): string {
  const start = node.getStart();
  const moved = node.getSourceFile().text.slice(start, node.end);
  if (from === to) return moved;
  const literals = literalRanges(node);
  let lineStartsAt = start;
  return moved
    .split('\n')
    .map((line, index) => {
      const at = lineStartsAt;
      lineStartsAt += line.length + 1;
      const inLiteral = literals.some((literal) => literal.start < at && at < literal.end);
      if (index === 0 || inLiteral || line.trim() === '' || !line.startsWith(from)) return line;
      return to + line.slice(from.length);
    })
    .join('\n');
}

function literalRanges(node: ts.Node): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  const visit = (child: ts.Node): void => {
    if (ts.isStringLiteral(child) || ts.isTemplateLiteral(child))
      ranges.push({ start: child.getStart(), end: child.end });
    else child.forEachChild(visit);
  };
  visit(node);
  return ranges;
}

/**
 * One level of indentation as the file writes JSX: a tab where the lines in
 * play use tabs, else the smallest step in spaces from a JSX parent's line to
 * a child on a line of its own, else two spaces.
 */
export function indentUnit(source: ts.SourceFile, sample: string): string {
  if (sample.includes('\t')) return '\t';
  const text = source.text;
  let step = Infinity;
  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      const outer = lineIndent(text, node.getStart());
      for (const child of node.children) {
        const start = child.getStart();
        if (ts.isJsxText(child) || !startsLine(text, start)) continue;
        const difference = lineIndent(text, start).length - outer.length;
        if (difference > 0 && !`${outer}${lineIndent(text, start)}`.includes('\t'))
          step = Math.min(step, difference);
      }
    }
    node.forEachChild(visit);
  };
  visit(source);
  return step === Infinity ? '  ' : ' '.repeat(step);
}

/** Applies non-overlapping replacements, the later one first so earlier offsets hold. */
export function splice(
  text: string,
  replacements: { start: number; end: number; replacement: string }[],
): string {
  let result = text;
  for (const { start, end, replacement } of replacements.toSorted((a, b) => b.start - a.start))
    result = result.slice(0, start) + replacement + result.slice(end);
  return result;
}

function lineStart(text: string, position: number): number {
  return text.lastIndexOf('\n', position - 1) + 1;
}

export function startsLine(text: string, position: number): boolean {
  return /^[ \t]*$/.test(text.slice(lineStart(text, position), position));
}

export function lineIndent(text: string, position: number): string {
  return /^[ \t]*/.exec(text.slice(lineStart(text, position)))?.[0] ?? '';
}
