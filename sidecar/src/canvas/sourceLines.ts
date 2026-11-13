// Text-level helpers for rewriting JSX where it is written: its lines, their
// indentation, and the file's own indent step, so an edit keeps the file's style.

import ts from 'typescript';

/** The layer's text, with its whole line when it stands alone on one, so no blank line is left. */
export function cutRange(text: string, node: ts.Node): { start: number; end: number } {
  const start = node.getStart();
  return standsAlone(text, node)
    ? { start: lineStart(text, start), end: text.indexOf('\n', node.end) + 1 }
    : { start, end: node.end };
}

/** Whether the node has its lines to itself, with only indentation before it and nothing after. */
export function standsAlone(text: string, node: ts.Node): boolean {
  const lineEnd = text.indexOf('\n', node.end);
  return (
    startsLine(text, node.getStart()) &&
    lineEnd !== -1 &&
    /^[ \t]*\r?$/.test(text.slice(node.end, lineEnd))
  );
}

/** The file's line ending: CRLF where it uses one, else LF. */
export function lineEnding(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n';
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

/**
 * JSX written from column 0 in two-space steps, as a kit catalog writes it,
 * with every line after the first set at `indent` in a file that steps by
 * `unit`, and lines ended with `eol`. The first line starts wherever the
 * caller places it; blank lines and lines inside a string or template stay as written.
 */
export function placeSnippet(jsx: string, indent: string, unit: string, eol: string): string {
  const text = jsx.replaceAll('\r\n', '\n');
  const snippet = ts.createSourceFile(
    'snippet.tsx',
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const literals = literalRanges(snippet);
  let lineStartsAt = 0;
  return text
    .split('\n')
    .map((line, index) => {
      const at = lineStartsAt;
      lineStartsAt += line.length + 1;
      const inLiteral = literals.some((literal) => literal.start < at && at < literal.end);
      if (index === 0 || inLiteral || line.trim() === '') return line;
      const steps = Math.floor((/^ */.exec(line)?.[0].length ?? 0) / 2);
      return indent + unit.repeat(steps) + line.slice(steps * 2);
    })
    .join(eol);
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
 * One level of indentation below a line indented `outer`, as the destination
 * and the file write JSX: a tab where `outer` has one, else the smallest step
 * in spaces from a JSX parent's line to a child on a line of its own, else a
 * tab where the file steps in tabs, else two spaces.
 */
export function indentUnit(source: ts.SourceFile, outer: string): string {
  if (outer.includes('\t')) return '\t';
  const text = source.text;
  const steps: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      const parent = lineIndent(text, node.getStart());
      for (const child of node.children) {
        const start = child.getStart();
        if (ts.isJsxText(child) || !startsLine(text, start)) continue;
        const indent = lineIndent(text, start);
        if (indent.length > parent.length && indent.startsWith(parent))
          steps.push(indent.slice(parent.length));
      }
    }
    node.forEachChild(visit);
  };
  visit(source);
  const spaces = steps.filter((step) => !step.includes('\t')).map((step) => step.length);
  if (spaces.length > 0) return ' '.repeat(Math.min(...spaces));
  return steps.length > 0 ? '\t' : '  ';
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
