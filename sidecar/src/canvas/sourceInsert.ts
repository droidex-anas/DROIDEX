// Adds a kit catalog entry to a frame's source where the picked layer is
// written: last inside it when it holds other layers, else right after it,
// with the kit and icon names the entry uses imported once into that file.

import ts from 'typescript';
import type { ComponentUses } from './componentUses.js';
import { KIT_SPECIFIER } from './designBundle.js';
import type { CatalogEntry } from './kitCatalog.js';
import type { SourceFiles } from './protocol.js';
import { ICON_SPECIFIER, importEdits } from './sourceImports.js';
import {
  indentUnit,
  lineEnding,
  lineIndent,
  placeSnippet,
  splice,
  standsAlone,
} from './sourceLines.js';
import {
  anchorOf,
  hasText,
  holdingElement,
  invalid,
  layersIn,
  pasteAtEnd,
  rowStartingAt,
  tagOf,
  writtenOnceAnchor,
  type EditedLayers,
  type Layer,
  type Paste,
} from './sourceStructureEdits.js';

/** The entry written into the layer `nodeId`, and the row of the element it adds. */
export function insertLayer(files: SourceFiles, nodeId: string, entry: CatalogEntry): EditedLayers {
  const { uses, layer } = layersIn(files);
  const target = layer(nodeId);
  const source = target.at.getSourceFile();
  const { text } = source;
  const eol = lineEnding(text);
  const paste = landing(target, uses, eol);
  checkIds(files, entry.jsx);
  const imports = importEdits(
    source,
    [
      { module: KIT_SPECIFIER, names: entry.uses },
      { module: ICON_SPECIFIER, names: entry.icons },
    ],
    eol,
  );
  const jsx = placeSnippet(entry.jsx, paste.indent, indentUnit(source, paste.indent), eol);
  const edited = splice(text, [
    ...imports,
    { start: paste.start, end: paste.end, replacement: paste.before + jsx + paste.after },
  ]);
  // The imports go in above the JSX, so they move where it starts.
  const shift = imports
    .filter((edit) => edit.start < paste.start)
    .reduce((sum, edit) => sum + edit.replacement.length - (edit.end - edit.start), 0);
  const changed = { [source.fileName]: edited };
  return {
    files: changed,
    landed: rowStartingAt(
      { ...files, ...changed },
      source.fileName,
      paste.start + shift + paste.before.length,
    ),
  };
}

/** Where the entry goes: last among the layer's children when it holds others, else after it. */
function landing(target: Layer, uses: ComponentUses, eol: string): Paste {
  const source = target.at.getSourceFile();
  const held = holdingElement(target, uses);
  // Code decides whether a layer it writes renders, as `{open && <section />}` does,
  // so only a free layer or the frame's top layer takes the entry inside.
  if ('element' in held && (target.row.free || target.row.parentId === null)) {
    const { element } = held;
    if (!hasText(element) && !isVector(element)) return pasteAtEnd(source, element, eol);
    if (hasText(element) && target.row.parentId === null && !anchorOf(element))
      throw invalid("This frame's top layer holds text. Pick a layer that holds others.");
  }
  const anchor = writtenOnceAnchor(target, uses, 'insert');
  if (hasText(anchor.parent))
    throw invalid('This layer sits inside text. Pick a layer that holds others.');
  if (isVector(anchor.parent))
    throw invalid('This layer is part of a vector. Pick a layer outside it.');
  const { text } = source;
  const { node } = anchor;
  const indent = lineIndent(text, node.getStart());
  const before = standsAlone(text, node) ? eol + indent : '';
  return { start: node.end, end: node.end, before, after: '', indent };
}

/** Refuses an entry that gives an element an `id` the frame already gives one: a document holds each id once. */
function checkIds(files: SourceFiles, jsx: string): void {
  const wanted = idsIn('entry.tsx', jsx);
  if (wanted.length === 0) return;
  const taken = new Set(
    Object.entries(files)
      .filter(([name]) => /\.[jt]sx?$/.test(name))
      .flatMap(([name, text]) => idsIn(name, text)),
  );
  if (taken.has(null) || wanted.includes(null))
    throw invalid(
      "This frame writes an id the edit can't read, so the entry's id might repeat it.",
    );
  const repeated = wanted.find((id) => taken.has(id));
  if (repeated !== undefined)
    throw invalid(
      `This frame already has an element with id "${String(repeated)}", and the entry would repeat it.`,
    );
}

/**
 * The literal `id` values the JSX in `text` writes, as the document gets them,
 * or null for one spelled with a character reference this does not read.
 */
function idsIn(name: string, text: string): (string | null)[] {
  const ids: (string | null)[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxAttribute(node) && node.name.getText() === 'id') {
      const value = node.initializer;
      // Only an attribute's quoted value reads character references; a string in braces is JavaScript.
      if (value && ts.isStringLiteral(value)) ids.push(withReferencesRead(value.text));
      else if (value && ts.isJsxExpression(value) && value.expression) {
        const literal = skipParentheses(value.expression);
        if (ts.isStringLiteralLike(literal)) ids.push(literal.text);
      }
    }
    node.forEachChild(visit);
  };
  visit(ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX));
  return ids;
}

function skipParentheses(expression: ts.Expression): ts.Expression {
  let inner = expression;
  while (ts.isParenthesizedExpression(inner)) inner = inner.expression;
  return inner;
}

const NAMED_REFERENCES = new Map([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
]);

const CHARACTER_REFERENCE = /&(?:#(\d+)|#x([\da-f]+)|([a-z][a-z\d]*));/gi;

/** An attribute value with its `&#97;`, `&#x61;` and `&amp;`-style references read, or null for one this does not know. */
function withReferencesRead(raw: string): string | null {
  let read = '';
  let from = 0;
  for (const reference of raw.matchAll(CHARACTER_REFERENCE)) {
    const char = referenced(reference);
    if (char === null) return null;
    read += raw.slice(from, reference.index) + char;
    from = reference.index + reference[0].length;
  }
  return read + raw.slice(from);
}

/** A matched reference's groups, the ones it did not match undefined. */
function referenced([, decimal, hex, named]: (string | undefined)[]): string | null {
  if (named !== undefined) return NAMED_REFERENCES.get(named) ?? null;
  const code = decimal === undefined ? Number.parseInt(hex ?? '', 16) : Number(decimal);
  return code <= 0x10ffff ? String.fromCodePoint(code) : null;
}

/** Whether the node is an `svg` or inside one, where only vector parts belong. */
function isVector(node: ts.Node): boolean {
  return (
    ts.findAncestor(
      node,
      (each) =>
        (ts.isJsxElement(each) || ts.isJsxSelfClosingElement(each)) && tagOf(each) === 'svg',
    ) !== undefined
  );
}
