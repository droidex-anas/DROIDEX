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
  if ('element' in held) {
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
