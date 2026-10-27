// Applies one direct edit to a site in the element map: the map says which
// canonical source range an element is, and an edit replaces exactly one range.

import ts from 'typescript';
import type { ElementEdit, ElementRef, SourceElement, SourceFiles } from './protocol.js';
import {
  ambiguous,
  attribute,
  attributeValue,
  isLiteral,
  propertyName,
  SourceElementError,
  sourceSites,
  type ElementNode,
} from './sourceElements.js';
import { STYLE_PROPERTIES } from './styleEdits.js';

/** One edit as source sees it: a style edit arrives already resolved to the CSS it writes. */
export type SourceChange =
  | Extract<ElementEdit['change'], { kind: 'text' | 'image' }>
  | { kind: 'style'; property: string; value: string };

export interface SourceEdit {
  element: ElementRef;
  change: SourceChange;
}

interface SourceReplacement {
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
  let changed: SourceReplacement;
  switch (edit.change.kind) {
    case 'text':
      changed = replaceText(node, source, edit.change.value);
      break;
    case 'image':
      changed = replaceImage(opening, source, edit.change.assetId);
      break;
    case 'style':
      changed = setStyle(opening, source, edit.change.property, edit.change.value);
      break;
  }
  const { start, end, replacement } = changed;
  return { [source.fileName]: source.text.slice(0, start) + replacement + source.text.slice(end) };
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

/**
 * Sets one property in the element's literal style object: its value is
 * replaced where it is set, appended as the last entry where it is not, and a
 * style attribute is added last when the element has none. Inline style is
 * what the board previews, so the edit writes exactly what the user saw.
 */
function setStyle(
  opening: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  source: ts.SourceFile,
  property: string,
  value: string,
): SourceReplacement {
  // The property becomes source text, so only a whitelisted name may reach it.
  if (!Object.hasOwn(STYLE_PROPERTIES, property))
    throw new SourceElementError('unsupported_edit', `${property} is not a style Canvas can edit.`);
  const entry = `${property}: ${JSON.stringify(value)}`;
  const styleAttribute = attribute(opening, 'style');
  if (!styleAttribute) {
    const end = opening.attributes.end;
    return { start: end, end, replacement: ` style={{ ${entry} }}` };
  }
  const style = attributeValue(styleAttribute);
  if (!style || !ts.isObjectLiteralExpression(style)) throw ambiguous();
  const existing = style.properties.find(
    (candidate) => candidate.name && propertyName(candidate.name) === property,
  );
  if (existing) {
    if (!ts.isPropertyAssignment(existing)) throw ambiguous();
    return {
      start: existing.initializer.getStart(source),
      end: existing.initializer.end,
      replacement: JSON.stringify(value),
    };
  }
  const last = style.properties.at(-1);
  if (!last) return { start: style.getStart(source), end: style.end, replacement: `{ ${entry} }` };
  return { start: last.end, end: last.end, replacement: `, ${entry}` };
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
