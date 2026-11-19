// The options picked for a catalog entry's props, written on its JSX. Only the
// compiler process loads the TypeScript parser, so only it imports this module;
// the sidecar asks it through `entryWithPicks`.

import ts from 'typescript';
import type { PropPick } from '@droidex/protocol';
import type { CatalogEntry } from './kitCatalog.js';
import { SourceElementError } from './sourceElementError.js';
import { splice } from './sourceLines.js';

/**
 * The entry's JSX with each pick written on its first element written with a
 * component it uses: in place of the quoted value it writes, else added after
 * the tag name. A value the entry writes in code, or writes more than once,
 * is left alone and refused.
 */
export function withPicks(entry: CatalogEntry, picks: readonly PropPick[]): string {
  if (picks.length === 0) return entry.jsx;
  const source = ts.createSourceFile(
    'entry.tsx',
    entry.jsx,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const element = firstUsedElement(source, entry.uses);
  if (element === undefined || element.attributes.properties.some(ts.isJsxSpreadAttribute))
    throw invalid('This entry has no element to give the picked options to.');
  const afterTag = element.attributes.pos;
  const edits: { start: number; end: number; replacement: string }[] = [];
  let added = '';
  for (const { name, value } of picks) {
    const prop = entry.props?.find((each) => each.name === name);
    if (!prop?.options.includes(value))
      throw invalid(`This entry has no option ${value} for ${name}. Pick one it lists.`);
    const written = element.attributes.properties.filter(
      (each): each is ts.JsxAttribute => ts.isJsxAttribute(each) && each.name.getText() === name,
    );
    // The last one written wins, so rewriting one of several would not apply the pick.
    if (written.length > 1)
      throw invalid(`This entry writes ${name} more than once, so it cannot be picked.`);
    const attribute = written.at(0);
    const quoted = `${name}="${value}"`;
    if (attribute === undefined) added += ` ${quoted}`;
    else if (attribute.initializer !== undefined && ts.isStringLiteral(attribute.initializer))
      edits.push({ start: attribute.getStart(), end: attribute.end, replacement: quoted });
    else throw invalid(`This entry writes ${name} in code, so it cannot be picked.`);
  }
  return splice(entry.jsx, [...edits, { start: afterTag, end: afterTag, replacement: added }]);
}

function firstUsedElement(
  source: ts.SourceFile,
  uses: readonly string[],
): ts.JsxOpeningElement | ts.JsxSelfClosingElement | undefined {
  const visit = (node: ts.Node): ts.JsxOpeningElement | ts.JsxSelfClosingElement | undefined => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      ts.isIdentifier(node.tagName) &&
      uses.includes(node.tagName.text)
    )
      return node;
    return ts.forEachChild(node, visit);
  };
  return visit(source);
}

function invalid(message: string): SourceElementError {
  return new SourceElementError('invalid_edit', message);
}
