// Applies one direct edit to a site in the element map: the map says which
// canonical source range an element is, and an edit replaces only bytes within it.

import ts from 'typescript';
import { attribute, attributeValue, isLiteral } from './jsxAttributes.js';
import type { KitTheme } from './kitTailwindTheme.js';
import type { ElementEdit, ElementRef, SourceElement, SourceFiles } from './protocol.js';
import { SourceElementError } from './sourceElementError.js';
import { ambiguous, sourceSites, type ElementNode } from './sourceElements.js';
import { styleReplacements, type ResolvedStyle } from './sourceStyles.js';

/**
 * One edit as source sees it: a style edit arrives with each style resolved
 * against the kit, and the kit's Tailwind theme its classes compile with.
 */
export type SourceChange =
  | Extract<ElementEdit['change'], { kind: 'text' | 'image' | 'path' }>
  | { kind: 'style'; styles: ResolvedStyle[]; theme?: KitTheme };

export interface SourceEdit {
  element: ElementRef;
  change: SourceChange;
}

export interface SourceReplacement {
  start: number;
  end: number;
  replacement: string;
}

/** Returns only changed paths, with their complete contents, for workspace.write. */
export function applyElementEdit(
  files: SourceFiles,
  elements: SourceElement[],
  edit: SourceEdit,
): SourceFiles {
  const selected = elements.filter((element) => element.elementId === edit.element.elementId);
  if (selected.length !== 1) throw staleReference();
  const site = sourceSites(files, edit.element.revisionId).find(
    ({ element }) => element.elementId === edit.element.elementId,
  );
  const supplied = selected.at(0);
  if (!site || !supplied) throw staleReference();
  if (
    site.element.file !== supplied.file ||
    site.element.start !== supplied.start ||
    site.element.end !== supplied.end ||
    site.element.tagName !== supplied.tagName ||
    site.element.editability !== supplied.editability
  )
    throw staleReference();
  if (site.element.editability !== 'literal') throw ambiguous();
  const { node, source } = site;
  const opening = ts.isJsxElement(node) ? node.openingElement : node;
  let replacements: SourceReplacement[];
  switch (edit.change.kind) {
    case 'text':
      replacements = [replaceText(node, source, edit.change.value)];
      break;
    case 'image':
      replacements = [replaceImage(opening, source, edit.change.assetId)];
      break;
    case 'style':
      replacements = styleReplacements(opening, source, edit.change.styles, edit.change.theme);
      break;
    case 'path':
      replacements = [replacePath(opening, source, edit.change.d)];
      break;
  }
  return { [source.fileName]: replace(source.text, replacements) };
}

/** Applies non-overlapping replacements; two at one point keep the order they were made in. */
function replace(text: string, replacements: readonly SourceReplacement[]): string {
  let result = '';
  let cursor = 0;
  for (const { start, end, replacement } of replacements.toSorted((a, b) => a.start - b.start)) {
    if (start < cursor) throw new Error('Canvas made overlapping source replacements.');
    result += text.slice(cursor, start) + replacement;
    cursor = end;
  }
  return result + text.slice(cursor);
}

function replaceText(node: ElementNode, source: ts.SourceFile, value: string): SourceReplacement {
  if (!ts.isJsxElement(node) || node.children.length > 1) throw ambiguous();
  if (node.children.length === 0)
    return {
      start: node.openingElement.end,
      end: node.openingElement.end,
      replacement: escapeJsxText(value),
    };
  const child = node.children.at(0);
  if (!child) throw ambiguous();
  if (ts.isJsxText(child))
    return { start: child.pos, end: child.end, replacement: escapeJsxText(value) };
  if (ts.isJsxExpression(child) && child.expression && isLiteral(child.expression))
    return {
      start: child.expression.getStart(source),
      end: child.expression.end,
      replacement: JSON.stringify(value),
    };
  throw ambiguous();
}

function replaceImage(
  opening: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  source: ts.SourceFile,
  assetId: string,
): SourceReplacement {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(assetId))
    throw new SourceElementError('invalid_edit', 'Choose an owned Canvas image.');
  const src = attributeValue(attribute(opening, 'src'));
  if (
    opening.tagName.getText(source) !== 'img' ||
    !src ||
    !isLiteral(src) ||
    !/^canvas-asset:[A-Za-z0-9_-]{1,128}$/.test(src.text)
  )
    throw ambiguous();
  return {
    start: src.getStart(source),
    end: src.end,
    replacement: JSON.stringify(`canvas-asset:${assetId}`),
  };
}

/** A `<path>`'s own `d`, where it is written as one quoted string; the schema has checked the new one. */
function replacePath(
  opening: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  source: ts.SourceFile,
  d: string,
): SourceReplacement {
  const written = attributeValue(attribute(opening, 'd'));
  if (opening.tagName.getText(source) !== 'path' || !written || !ts.isStringLiteral(written))
    throw ambiguous();
  return { start: written.getStart(source), end: written.end, replacement: JSON.stringify(d) };
}

function staleReference(): SourceElementError {
  return new SourceElementError(
    'stale_reference',
    'This selection belongs to different source. Reselect the element in the current revision.',
  );
}
function escapeJsxText(text: string): string {
  let escaped = '';
  for (const char of text) {
    if (char === '&') escaped += '&amp;';
    else if (char === '<') escaped += '&lt;';
    else if (char === '>') escaped += '&gt;';
    else if (char === '{') escaped += '&#123;';
    else if (char === '}') escaped += '&#125;';
    else if (char === '"') escaped += '&quot;';
    else if (char === "'") escaped += '&#39;';
    else if (char !== ' ' && /\s/.test(char)) escaped += `&#${String(char.codePointAt(0))};`;
    else escaped += char;
  }
  return escaped;
}
