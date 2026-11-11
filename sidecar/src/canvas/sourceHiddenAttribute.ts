// The `hidden` attribute a layer is hidden with: whether an element is written
// with it, and the text edit that writes it or takes it away.

import ts from 'typescript';
import { SourceElementError } from './sourceElementError.js';
import { attribute, type ElementNode } from './sourceElements.js';
import { cutRange, lineEnding, lineIndent, standsAlone, startsLine } from './sourceLines.js';

interface Replacement {
  start: number;
  end: number;
  replacement: string;
}

/** Whether the element is written with a bare `hidden`, the one form the eye reads and writes. */
export function isHidden(element: ElementNode): boolean {
  const written = attribute(openingOf(element), 'hidden');
  return written !== undefined && written.initializer === undefined;
}

/**
 * Writes a bare `hidden` first among the element's attributes, on a line of
 * its own where they start on one, or takes it away with its line.
 */
export function hiddenEdit(element: ElementNode, hidden: boolean): Replacement {
  const opening = openingOf(element);
  const written = attribute(opening, 'hidden');
  if (written?.initializer)
    throw new SourceElementError(
      'ambiguous_element',
      'Whether this layer shows is worked out in code. Ask the agent.',
    );
  if (hidden === (written !== undefined))
    throw new SourceElementError(
      'invalid_edit',
      hidden ? 'The layer is already hidden.' : 'The layer already shows.',
    );
  const { text } = opening.getSourceFile();
  if (written) {
    const cut = standsAlone(text, written)
      ? cutRange(text, written)
      : { start: written.pos, end: written.end };
    return { ...cut, replacement: '' };
  }
  const first = opening.attributes.properties.at(0);
  if (first && startsLine(text, first.getStart())) {
    const start = first.getStart();
    return {
      start,
      end: start,
      replacement: `hidden${lineEnding(text)}${lineIndent(text, start)}`,
    };
  }
  return { start: opening.attributes.pos, end: opening.attributes.pos, replacement: ' hidden' };
}

function openingOf(element: ElementNode): ts.JsxOpeningElement | ts.JsxSelfClosingElement {
  return ts.isJsxElement(element) ? element.openingElement : element;
}
