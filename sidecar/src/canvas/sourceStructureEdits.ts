// Edits one layer of the outline where its source writes it: the JSX it is
// written as moves among another element's children, is removed, or is copied
// right after itself, keeping the file's own indentation and line endings.

import ts from 'typescript';
import type { ComponentUses } from './componentUses.js';
import type { ElementEdit, OutlineNode, SourceFiles } from './protocol.js';
import { SourceElementError } from './sourceElementError.js';
import { sourceLayers, type ElementNode } from './sourceElements.js';
import { hiddenClassEdit } from './sourceHiddenClass.js';
import { enclosingFunction, readsLaterBinding } from './sourceLaterBindings.js';
import {
  cutRange,
  indentUnit,
  lineEnding,
  lineIndent,
  reindent,
  splice,
  standsAlone,
  startsLine,
} from './sourceLines.js';

type LayerChange = Extract<ElementEdit, { layer: unknown }>['change'];

/** The one changed file, complete, and a row of the edited source named by its nodeId. */
interface EditedLayers {
  files: SourceFiles;
  /** Null where the row cannot be found. */
  landed: string | null;
}

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

/** What a refusal of each edit says of a frame's root, and asks the agent to do instead. */
const REFUSALS: Record<LayerChange['kind'], { root: string; action: string }> = {
  move: { root: "A frame's top layer can't move.", action: 'move' },
  remove: {
    root: "A frame's top layer can't be deleted. Delete the frame instead.",
    action: 'delete',
  },
  duplicate: {
    root: "A frame's top layer can't be duplicated. Duplicate the frame instead.",
    action: 'duplicate',
  },
  hide: { root: "A frame's top layer can't be hidden. Hide the frame instead.", action: 'hide' },
};

/**
 * The layer `nodeId` changed as `change` says. The row landed on is, in the
 * edited source, the moved, copied or hidden layer, or the row beside a removed
 * layer that takes the keyboard in its place.
 */
export function editLayer(files: SourceFiles, nodeId: string, change: LayerChange): EditedLayers {
  if (change.kind === 'move')
    return moveLayer(files, { nodeId, parentId: change.parentId, beforeId: change.beforeId });
  if (change.kind === 'hide') return hideLayer(files, nodeId, change.hidden);
  return change.kind === 'remove' ? removeLayer(files, nodeId) : duplicateLayer(files, nodeId);
}

export function moveLayer(files: SourceFiles, move: LayerMove): EditedLayers {
  const { uses, layer, checker } = layersIn(files);
  const subject = layer(move.nodeId);
  const target = layer(move.parentId);
  const sibling = move.beforeId === null ? null : layer(move.beforeId);

  const anchor = writtenOnceAnchor(subject, uses, 'move');
  const parent = holder(target, uses);
  checkPlace(anchor, parent);
  const before = sibling && siblingAnchor(sibling, parent, anchor);
  if (hasText(anchor.parent) || hasText(parent))
    throw invalid('This layer sits inside text. Edit the text instead.');
  if (isAlreadyThere(anchor, parent, before)) throw invalid('The layer is already there.');

  const source = anchor.node.getSourceFile();
  const text = source.text;
  const eol = lineEnding(text);
  const movedIndent = lineIndent(text, anchor.node.getStart());
  const cut = cutRange(text, anchor.node);
  const paste = before ? pasteBefore(text, before.node, eol) : pasteAtEnd(source, parent, eol);
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

/** Removes the layer; a parent left with no children keeps no blank line between its tags. */
function removeLayer(files: SourceFiles, nodeId: string): EditedLayers {
  const { uses, outline, written, layer } = layersIn(files);
  const subject = layer(nodeId);
  const anchor = writtenOnceAnchor(subject, uses, 'remove');
  // A fragment can hold a frame's top layer; with it gone the frame would draw nothing.
  const isOtherTopLayer = (row: OutlineNode) => row.parentId === null && row !== subject.row;
  if (subject.row.parentId === null && !outline.nodes.some(isOtherTopLayer))
    throw invalid(REFUSALS.remove.root);
  const source = anchor.node.getSourceFile();
  const cut = isOnlyChild(anchor) ? between(anchor.parent) : cutRange(source.text, anchor.node);
  const changed = { [source.fileName]: splice(source.text, [{ ...cut, replacement: '' }]) };
  const next = keyboardRow(outline.nodes, subject.row);
  const at = next && written.get(next.nodeId);
  if (!at) return { files: changed, landed: null };
  const file = at.getSourceFile().fileName;
  const start = at.getStart();
  const moved =
    file === source.fileName && start >= cut.end ? start - (cut.end - cut.start) : start;
  return { files: changed, landed: rowStartingAt({ ...files, ...changed }, file, moved) };
}

/** Puts a copy of the layer right after it: on a line of its own when the layer has one. */
function duplicateLayer(files: SourceFiles, nodeId: string): EditedLayers {
  const { uses, layer } = layersIn(files);
  const { node } = writtenOnceAnchor(layer(nodeId), uses, 'duplicate');
  checkCopy(node);
  const source = node.getSourceFile();
  const { text } = source;
  const start = node.getStart();
  const before = standsAlone(text, node) ? lineEnding(text) + lineIndent(text, start) : '';
  const copy = before + text.slice(start, node.end);
  const changed = {
    [source.fileName]: splice(text, [{ start: node.end, end: node.end, replacement: copy }]),
  };
  return {
    files: changed,
    landed: rowStartingAt({ ...files, ...changed }, source.fileName, node.end + before.length),
  };
}

/**
 * Hides the element with Tailwind's `hidden` class, or takes the class away to
 * show it again. A frame keeps a top layer that shows.
 */
function hideLayer(files: SourceFiles, nodeId: string, hidden: boolean): EditedLayers {
  const { uses, outline, layer } = layersIn(files);
  const subject = layer(nodeId);
  const { row, at } = subject;
  if (row.kind !== 'element' || !(ts.isJsxElement(at) || ts.isJsxSelfClosingElement(at)))
    throw invalid('Only an element can be hidden.');
  // Only its hidden class or a hidden attribute says a sibling is not showing.
  const isOtherShownTopLayer = (other: OutlineNode) =>
    other.parentId === null &&
    other !== row &&
    other.visibility !== 'hidden' &&
    other.visibility !== 'attribute';
  if (hidden && row.parentId === null && !outline.nodes.some(isOtherShownTopLayer))
    throw invalid(REFUSALS.hide.root);
  writtenOnceAnchor(subject, uses, 'hide');
  const source = at.getSourceFile();
  const edited = splice(source.text, [hiddenClassEdit(at, hidden)]);
  // An edit inside the opening tag leaves the row its id.
  return { files: { [source.fileName]: edited }, landed: nodeId };
}

/** The outline's rows by id, refusing an id the source no longer writes. */
function layersIn(files: SourceFiles) {
  const { uses, outline, written, checker } = sourceLayers(files);
  const rows = new Map(outline.nodes.map((row) => [row.nodeId, row]));
  const layer = (nodeId: string): Layer => {
    const row = rows.get(nodeId);
    const at = written.get(nodeId);
    if (!row || !at) throw staleReference();
    return { row, at };
  };
  return { uses, outline, written, checker, layer };
}

/** The subject's anchor, refused when it is not written as one JSX child that renders once. */
function writtenOnceAnchor(subject: Layer, uses: ComponentUses, edit: LayerChange['kind']): Anchor {
  const anchor = anchorOf(subject.at);
  const { root, action } = REFUSALS[edit];
  if (!anchor && subject.row.parentId === null) throw invalid(root);
  // Refused as its row's lock says, whether or not code writes it.
  if (!uses.rendersOnce(subject.at))
    throw ambiguous(
      subject.row.lock === 'repeated'
        ? 'Written once and repeated for each item. Ask the agent to change it.'
        : 'Used in several places. Ask the agent to change it.',
    );
  if (!anchor)
    throw ambiguous(
      `This layer is written inside code (a list, a condition or a prop). Ask the agent to ${action} it.`,
    );
  return anchor;
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
function pasteAtEnd(source: ts.SourceFile, parent: ElementNode, eol: string): Paste {
  const text = source.text;
  const outer = lineIndent(text, parent.getStart());
  const inner = outer + indentUnit(source, outer);
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

/** Whether the layer is its parent's one child, beside only the line breaks JSX drops. */
function isOnlyChild({ node, parent }: Anchor): boolean {
  return parent.children.every(
    (child) => child === node || (ts.isJsxText(child) && child.containsOnlyTriviaWhiteSpaces),
  );
}

/** Everything between a parent's opening and closing tags. */
function between(parent: JsxParent): { start: number; end: number } {
  return ts.isJsxElement(parent)
    ? { start: parent.openingElement.end, end: parent.closingElement.getStart() }
    : { start: parent.openingFragment.end, end: parent.closingFragment.getStart() };
}

/** The row the keyboard goes to once `row` is gone: the next of its siblings, else the one before, else its parent. */
function keyboardRow(rows: readonly OutlineNode[], row: OutlineNode): OutlineNode | null {
  const siblings = rows.filter((each) => each.parentId === row.parentId);
  const at = siblings.indexOf(row);
  return (
    siblings.find((_, index) => index > at) ??
    siblings.findLast((_, index) => index < at) ??
    rows.find((each) => each.nodeId === row.parentId) ??
    null
  );
}

/**
 * Refuses a copy that would repeat what must be one of a kind: an `id`, which
 * a document holds once, or one props spread from code may set; a `ref`, which
 * the copy would take over; or a `key` among the parent's children.
 */
function checkCopy(copied: ts.Node): void {
  if (writesSiblingKey(copied))
    throw invalid(
      'This layer has a key, and a copy would repeat it. Ask the agent to duplicate it.',
    );
  const attribute = copiedAttribute(copied);
  if (attribute === 'id') throw invalid('This layer has an id, and a copy would repeat it.');
  if (attribute === 'ref')
    throw invalid(
      'This layer has a ref, which a copy would take over. Ask the agent to duplicate it.',
    );
  if (attribute === 'spread')
    throw ambiguous(
      'This layer takes props from code, which may set an id a copy would repeat. Ask the agent to duplicate it.',
    );
}

/** The first `id`, `ref` or spread of props the layer, or anything inside it, writes. */
function copiedAttribute(node: ts.Node): 'id' | 'ref' | 'spread' | undefined {
  if (ts.isJsxSpreadAttribute(node)) return 'spread';
  if (ts.isJsxAttribute(node)) {
    const name = node.name.getText();
    if (name === 'id' || name === 'ref') return name;
  }
  return node.forEachChild(copiedAttribute);
}

/** Whether an element the copy puts among the parent's children has a `key`; a list's keys are its own. */
function writesSiblingKey(node: ts.Node): boolean {
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
    const opening = ts.isJsxElement(node) ? node.openingElement : node;
    return opening.attributes.properties.some(
      (attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText() === 'key',
    );
  }
  if (ts.isFunctionLike(node)) return false;
  return node.forEachChild(writesSiblingKey) ?? false;
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
