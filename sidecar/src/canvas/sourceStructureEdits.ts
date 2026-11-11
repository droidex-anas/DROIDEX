// Moves one layer of the outline to another place in the source: the JSX it is
// written as is cut from its parent and pasted among another element's
// children, keeping the file's own indentation and line endings.

import ts from 'typescript';
import type { ComponentUses } from './componentUses.js';
import type { OutlineNode, SourceFiles } from './protocol.js';
import { SourceElementError } from './sourceElementError.js';
import { sourceLayers, type ElementNode } from './sourceElements.js';

export interface LayerMove {
  /** The outline row being moved. */
  nodeId: string;
  /** The element row it moves into. */
  parentId: string;
  /** The row it lands before, among that element's children; null for after the last. */
  beforeId: string | null;
}

type JsxParent = ts.JsxElement | ts.JsxFragment;

/** A layer as written: an outline row and the node it is written at. */
interface Layer {
  row: OutlineNode;
  at: ts.Node;
}

/** The JSX child that carries a layer in its parent, and so is what moves. */
interface Anchor {
  node: ts.JsxChild;
  parent: JsxParent;
}

/** Where the moved text goes: `start`..`end` is replaced with `before`, the text and `after`. */
interface Paste {
  start: number;
  end: number;
  before: string;
  after: string;
  /** The indentation the moved text's lines take. */
  indent: string;
}

const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

/** The one changed file, complete, and the moved row's nodeId in the edited source (null if it cannot be found). */
export function moveLayer(
  files: SourceFiles,
  move: LayerMove,
): { files: SourceFiles; landed: string | null } {
  const { uses, outline, written, checker } = sourceLayers(files);
  const rows = new Map(outline.nodes.map((row) => [row.nodeId, row]));
  const layer = (nodeId: string): Layer => {
    const row = rows.get(nodeId);
    const at = written.get(nodeId);
    if (!row || !at) throw staleReference();
    return { row, at };
  };
  const subject = layer(move.nodeId);
  const target = layer(move.parentId);
  const sibling = move.beforeId === null ? null : layer(move.beforeId);

  const anchor = movableAnchor(subject, uses);
  const parent = holder(target, uses);
  checkPlace(anchor, parent);
  const before = sibling && siblingAnchor(sibling, parent, anchor);
  if (hasText(anchor.parent) || hasText(parent))
    throw invalid('This layer sits inside text. Edit the text instead.');
  if (isAlreadyThere(anchor, parent, before)) throw invalid('The layer is already there.');

  const source = anchor.node.getSourceFile();
  const text = source.text;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const movedIndent = lineIndent(text, anchor.node.getStart());
  const cut = cutRange(text, anchor.node);
  const paste = before
    ? pasteBefore(text, before.node, eol)
    : pasteAtEnd(source, parent, eol, movedIndent);
  if (readsLaterBinding(anchor.node, paste.start, checker))
    throw ambiguous(
      'This layer uses a value the code sets further down, so it can’t go there. Ask the agent to move it.',
    );
  const pasted = paste.before + reindent(anchor.node, movedIndent, paste.indent);
  const edited = splice(text, [
    { start: cut.start, end: cut.end, replacement: '' },
    { start: paste.start, end: paste.end, replacement: pasted + paste.after },
  ]);
  const shift = cut.start < paste.start ? cut.end - cut.start : 0;
  const changed = { [source.fileName]: edited };
  return {
    files: changed,
    landed: rowStartingAt(
      { ...files, ...changed },
      source.fileName,
      paste.start + paste.before.length - shift,
    ),
  };
}

/** The subject's anchor, refused when it is not written as one JSX child that renders once. */
function movableAnchor(subject: Layer, uses: ComponentUses): Anchor {
  const anchor = anchorOf(subject.at);
  if (!anchor && subject.row.parentId === null) throw invalid("A frame's top layer can't move.");
  if (!anchor)
    throw ambiguous(
      'This layer is written inside code (a list, a condition or a prop). Ask the agent to move it.',
    );
  if (uses.rendersOnce(subject.at)) return anchor;
  if (subject.row.lock === 'repeated')
    throw ambiguous('Written once and repeated for each item. Ask the agent to change it.');
  throw ambiguous('Used in several places. Ask the agent to change it.');
}

/** The element the layer moves into: a native element that renders once and may hold children. */
function holder(target: Layer, uses: ComponentUses): ElementNode {
  const { at } = target;
  if (
    target.row.kind === 'element' &&
    (ts.isJsxElement(at) || ts.isJsxSelfClosingElement(at)) &&
    !VOID_TAGS.has(tagOf(at)) &&
    uses.rendersOnce(at)
  ) {
    if (target.row.contentFromProps)
      throw invalid("This layer's props may set its content, so it can't hold other layers.");
    return at;
  }
  throw invalid("This layer can't hold other layers.");
}

function checkPlace(anchor: Anchor, parent: ElementNode): void {
  const start = anchor.node.getStart();
  if (parent.getStart() >= start && parent.end <= anchor.node.end)
    throw invalid("A layer can't move into itself.");
  if (
    anchor.node.getSourceFile() !== parent.getSourceFile() ||
    enclosingFunction(anchor.node) !== enclosingFunction(parent)
  )
    throw invalid("Layers can move only within the component they're written in.");
  if (enclosingBlock(anchor.node) !== enclosingBlock(parent))
    throw ambiguous(
      'This layer and that place are in different blocks of code. Ask the agent to move it.',
    );
}

/** The sibling the layer lands before: one of the parent's own children, other than the layer. */
function siblingAnchor(sibling: Layer, parent: ElementNode, moving: Anchor): Anchor {
  const anchor = anchorOf(sibling.at);
  if (anchor?.parent === parent && anchor.node !== moving.node) return anchor;
  throw invalid("A layer can't go there.");
}

/**
 * The direct JSX child that is or holds a written node: the node itself, or
 * the `{…}` it stands in, as `{open && <aside />}` or `{items.map(…)}`.
 */
function anchorOf(at: ts.Node): Anchor | null {
  if (isJsxParent(at.parent)) return { node: at as ts.JsxChild, parent: at.parent };
  let holding = at.parent;
  while (ts.isParenthesizedExpression(holding)) holding = holding.parent;
  if (ts.isJsxExpression(holding) && isJsxParent(holding.parent))
    return { node: holding, parent: holding.parent };
  return null;
}

function isJsxParent(node: ts.Node): node is JsxParent {
  return ts.isJsxElement(node) || ts.isJsxFragment(node);
}

function tagOf(node: ElementNode): string {
  return (ts.isJsxElement(node) ? node.openingElement.tagName : node.tagName).getText();
}

function enclosingFunction(node: ts.Node): ts.Node | undefined {
  return ts.findAncestor(node, ts.isFunctionLike);
}

/** The nearest scope a variable can be declared in: a layer leaving it may lose names it reads. */
function enclosingBlock(node: ts.Node): ts.Node | undefined {
  return ts.findAncestor(
    node,
    (scope) =>
      ts.isFunctionLike(scope) ||
      ts.isBlock(scope) ||
      ts.isCaseOrDefaultClause(scope) ||
      ts.isIterationStatement(scope, false),
  );
}

/**
 * Whether the JSX reads a name its function (or the module, outside any)
 * declares at or after `position`: pasted there, it would read the name
 * before it is set. Function declarations are hoisted whole, so they don't count.
 */
function readsLaterBinding(moved: ts.Node, position: number, checker: ts.TypeChecker): boolean {
  const scope = enclosingFunction(moved);
  const declaredLater = (declaration: ts.Declaration) =>
    (ts.isVariableDeclaration(declaration) ||
      ts.isBindingElement(declaration) ||
      ts.isClassDeclaration(declaration)) &&
    declaration.end > position &&
    enclosingFunction(declaration) === scope;
  const reads = (node: ts.Node): boolean => {
    if (ts.isIdentifier(node)) {
      const symbol = ts.isShorthandPropertyAssignment(node.parent)
        ? checker.getShorthandAssignmentValueSymbol(node.parent)
        : checker.getSymbolAtLocation(node);
      if (symbol?.declarations?.some(declaredLater)) return true;
    }
    return node.forEachChild(reads) ?? false;
  };
  return reads(moved);
}
/** Whitespace that breaks a line is formatting JSX drops; any other text, spaces too, renders. */
function hasText(parent: JsxParent | ElementNode): boolean {
  if (ts.isJsxSelfClosingElement(parent)) return false;
  return parent.children.some(
    (child) => ts.isJsxText(child) && !child.containsOnlyTriviaWhiteSpaces,
  );
}

/** Whether the layer already sits right before `before` in the parent, or last when it is null. */
function isAlreadyThere(anchor: Anchor, parent: ElementNode, before: Anchor | null): boolean {
  if (anchor.parent !== parent || !ts.isJsxElement(parent)) return false;
  const { children } = parent;
  const next = children
    .slice(children.indexOf(anchor.node) + 1)
    .find((child) => !ts.isJsxText(child));
  return before === null ? next === undefined : before.node === next;
}

/** The layer's text, with its whole line when it stands alone on one, so no blank line is left. */
function cutRange(text: string, node: ts.Node): { start: number; end: number } {
  const start = node.getStart();
  const lineEnd = text.indexOf('\n', node.end);
  const alone =
    startsLine(text, start) && lineEnd !== -1 && /^[ \t]*\r?$/.test(text.slice(node.end, lineEnd));
  return alone ? { start: lineStart(text, start), end: lineEnd + 1 } : { start, end: node.end };
}

/** On its own line above a sibling that starts one, inline right before one that does not. */
function pasteBefore(text: string, sibling: ts.Node, eol: string): Paste {
  const start = sibling.getStart();
  const indent = lineIndent(text, start);
  const after = startsLine(text, start) ? eol + indent : '';
  return { start, end: start, before: '', after, indent };
}

/**
 * After the parent's last child: on a new line at that child's indentation
 * when the closing tag has a line of its own, else one indent deeper than the
 * parent, with the closing tag moved to its own line. A self-closing parent opens.
 */
function pasteAtEnd(
  source: ts.SourceFile,
  parent: ElementNode,
  eol: string,
  sample: string,
): Paste {
  const text = source.text;
  const outer = lineIndent(text, parent.getStart());
  const inner = outer + indentUnit(source, outer + sample);
  if (ts.isJsxSelfClosingElement(parent))
    return {
      start: parent.attributes.end,
      end: parent.end,
      before: `>${eol}${inner}`,
      after: `${eol}${outer}</${tagOf(parent)}>`,
      indent: inner,
    };
  const last = parent.children.filter((child) => !ts.isJsxText(child)).at(-1);
  const closing = parent.closingElement.getStart();
  if (!last)
    return {
      start: parent.openingElement.end,
      end: closing,
      before: eol + inner,
      after: eol + outer,
      indent: inner,
    };
  if (startsLine(text, closing)) {
    const indent = lineIndent(text, last.getStart());
    return { start: last.end, end: last.end, before: eol + indent, after: '', indent };
  }
  return { start: closing, end: closing, before: eol + inner, after: eol + outer, indent: inner };
}

/**
 * The node's text with every line after the first shifted from one indentation
 * to another; blank lines and lines inside a string or template stay as written.
 */
function reindent(node: ts.Node, from: string, to: string): string {
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
function indentUnit(source: ts.SourceFile, sample: string): string {
  if (sample.includes('\t')) return '\t';
  const text = source.text;
  let step = Infinity;
  const visit = (node: ts.Node): void => {
    if (isJsxParent(node)) {
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

/** The row of the edited source written at `position`, or whose anchor starts there. */
function rowStartingAt(files: SourceFiles, file: string, position: number): string | null {
  const { outline, written } = sourceLayers(files);
  for (const { nodeId } of outline.nodes) {
    const at = written.get(nodeId);
    if (at?.getSourceFile().fileName !== file) continue;
    if (at.getStart() === position || anchorOf(at)?.node.getStart() === position) return nodeId;
  }
  return null;
}

/** Applies non-overlapping replacements, the later one first so earlier offsets hold. */
function splice(
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

function startsLine(text: string, position: number): boolean {
  return /^[ \t]*$/.test(text.slice(lineStart(text, position), position));
}

function lineIndent(text: string, position: number): string {
  return /^[ \t]*/.exec(text.slice(lineStart(text, position)))?.[0] ?? '';
}

function staleReference(): SourceElementError {
  return new SourceElementError(
    'stale_reference',
    'This selection belongs to different source. Reselect the element in the current revision.',
  );
}

function invalid(message: string): SourceElementError {
  return new SourceElementError('invalid_edit', message);
}

function ambiguous(message: string): SourceElementError {
  return new SourceElementError('ambiguous_element', message);
}
