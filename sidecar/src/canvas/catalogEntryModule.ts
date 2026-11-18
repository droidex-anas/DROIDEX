// A catalog entry as a module of its own: its imports, one per line, then an
// anonymous default component returning its JSX, with the options picked for
// its props written on it. The compiler's catalog check builds each entry this
// way, a kit preview shows one the same way, and a frame made from an entry
// starts as one.

import ts from 'typescript';
import { KIT_SPECIFIER } from './designBundle.js';
import type { CatalogEntry, PropPick } from './kitCatalog.js';
import { SourceElementError } from './sourceElementError.js';
import { splice } from './sourceLines.js';

// Inline styles, because a kit's Tailwind theme may not define the usual
// utilities, and no spacing literal, which a strict kit would refuse. The page
// centres a box that hugs the entry, so the board can size the frame to it.
const FRAME_PAGE = JSON.stringify({
  display: 'flex',
  minHeight: '100vh',
  alignItems: 'center',
  justifyContent: 'center',
});
const ENTRY_BOX = JSON.stringify({
  display: 'inline-flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  maxWidth: '100%',
});

const ICON_SPECIFIER = 'lucide-react';

export function entryImports(entry: CatalogEntry): { name: string; from: string }[] {
  return [
    ...[...new Set(entry.uses)].map((name) => ({ name, from: KIT_SPECIFIER })),
    ...[...new Set(entry.icons)].map((name) => ({ name, from: ICON_SPECIFIER })),
  ];
}

/** The entry's module, returning `jsx`: the entry's own, or the entry inside a wrapper. */
export function entryModule(entry: CatalogEntry, jsx = entry.jsx): string {
  const header = entryImports(entry).map(({ name, from }) => `import { ${name} } from '${from}';`);
  // Anonymous, so no name of the module's own can shadow one the entry imports.
  header.push('', 'export default function () {', '  return (');
  return `${header.join('\n')}\n${jsx}\n  );\n}\n`;
}

/** A frame's source holding only the entry, with the picks written on it. */
export function entryFrameModule(entry: CatalogEntry, picks: readonly PropPick[]): string {
  const jsx = withPicks(entry, picks);
  return entryModule(
    entry,
    `<main style={${FRAME_PAGE}}>\n<div style={${ENTRY_BOX}}>\n${jsx}\n</div>\n</main>`,
  );
}

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
