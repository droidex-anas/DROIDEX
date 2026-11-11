// Hiding a layer with Tailwind's `hidden` class: whether an element is hidden
// that way, and the edit of its className that adds the class or takes it
// away. Only a className written as one plain string is read or written, and
// only where nothing else the element writes could decide its display instead.

import ts from 'typescript';
import { attribute, attributeValue, isLiteral, propertyName } from './jsxAttributes.js';
import type { OutlineNode } from './protocol.js';
import { SourceElementError } from './sourceElementError.js';
import type { ElementNode } from './sourceElements.js';
import { cutRange, lineEnding, lineIndent, standsAlone, startsLine } from './sourceLines.js';
import { splitOutside } from './tailwindStyles.js';

type Visibility = OutlineNode['visibility'];
type HideLock = Exclude<Visibility, 'shown' | 'hidden'>;

interface Replacement {
  start: number;
  end: number;
  replacement: string;
}

/** The className the eye edits, absent or one literal, or why the eye can't edit one. */
type Classes =
  | { lock: HideLock }
  | {
      written: ts.JsxAttribute | undefined;
      literal: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | undefined;
      raw: string;
    };

const HIDE_REFUSALS: Record<HideLock, string> = {
  computed: 'Its classes or props are worked out in code. Ask the agent to hide or show it.',
  display:
    'Its classes or style set how it displays, which can win over hiding it. Ask the agent to hide or show it.',
  attribute: 'Its hidden attribute decides whether it shows. Ask the agent to hide or show it.',
};

// Tailwind 3 writes `hidden` after every other display utility, so it wins over
// any of them written plainly, but not over one behind a variant, marked
// important, or written as an arbitrary property.
const DISPLAY_UTILITIES = new Set([
  'block',
  'inline-block',
  'inline',
  'flex',
  'inline-flex',
  'table',
  'inline-table',
  'table-caption',
  'table-cell',
  'table-column',
  'table-column-group',
  'table-footer-group',
  'table-header-group',
  'table-row-group',
  'table-row',
  'flow-root',
  'grid',
  'inline-grid',
  'contents',
  'list-item',
  'hidden',
]);

const HIDDEN = 'hidden';
const CHARACTER_REFERENCE = /&(?:#\d+|#x[\da-f]+|[a-z][a-z\d]*);/i;

/** Whether the element shows, is hidden by its `hidden` class, or decides that some way the eye can't edit. */
export function visibility(element: ElementNode): Visibility {
  const classes = readClasses(element);
  if ('lock' in classes) return classes.lock;
  return tokens(classes.raw).includes(HIDDEN) ? 'hidden' : 'shown';
}

/**
 * Adds `hidden` after the element's classes, or a `className="hidden"` after
 * its attributes where it has none; showing takes away what hiding wrote.
 */
export function hiddenClassEdit(element: ElementNode, hidden: boolean): Replacement {
  const classes = readClasses(element);
  if ('lock' in classes)
    throw new SourceElementError('ambiguous_element', HIDE_REFUSALS[classes.lock]);
  const { written, literal, raw } = classes;
  if (hidden === tokens(raw).includes(HIDDEN))
    throw new SourceElementError(
      'invalid_edit',
      hidden ? 'The layer is already hidden.' : 'The layer already shows.',
    );
  const text = element.getSourceFile().text;
  if (!written || !literal) return addedClassName(openingOf(element), text);
  const start = literal.getStart() + 1;
  if (!hidden) {
    const shown = withoutHidden(raw);
    if (tokens(shown).length === 0) return removed(written, text);
    return { start, end: literal.end - 1, replacement: shown };
  }
  const last = [...raw.matchAll(/\S+/g)].at(-1);
  const at = last ? start + last.index + last[0].length : start;
  return { start: at, end: at, replacement: last ? ` ${HIDDEN}` : HIDDEN };
}

function readClasses(element: ElementNode): Classes {
  const opening = openingOf(element);
  if (mayHide(attribute(opening, 'hidden'))) return { lock: 'attribute' };
  if (opening.attributes.properties.some(ts.isJsxSpreadAttribute)) return { lock: 'computed' };
  if (mayStyleDisplay(attribute(opening, 'style'))) return { lock: 'display' };
  const written = attribute(opening, 'className');
  if (!written) return { written, literal: undefined, raw: '' };
  const literal = attributeValue(written);
  if (!literal || !isLiteral(literal)) return { lock: 'computed' };
  const raw = literal.getText().slice(1, -1);
  // An escape or a character reference (`&#32;`) would make the source
  // spelling differ from the classes it names; a bare `&`, as in `[&>*]:p-2`, is itself.
  if (raw.includes('\\') || CHARACTER_REFERENCE.test(raw)) return { lock: 'computed' };
  if (tokens(raw).some(outranksHidden)) return { lock: 'display' };
  return { written, literal, raw };
}

/** Whether a `hidden` attribute hides the element, or may; `hidden={false}` is as good as none. */
function mayHide(hidden: ts.JsxAttribute | undefined): boolean {
  return hidden !== undefined && attributeValue(hidden)?.kind !== ts.SyntaxKind.FalseKeyword;
}

/** Whether an inline style sets, or may set, `display`, which wins over any class. */
function mayStyleDisplay(style: ts.JsxAttribute | undefined): boolean {
  if (!style) return false;
  const value = attributeValue(style);
  if (!value || !ts.isObjectLiteralExpression(value)) return true;
  return value.properties.some(
    (property) =>
      !ts.isPropertyAssignment(property) || ['display', ''].includes(propertyName(property.name)),
  );
}

/** A display class that wins over `hidden`: `md:flex`, `!flex` or `[display:flex]`. */
function outranksHidden(token: string): boolean {
  const variants = splitOutside(token, ':');
  const written = variants.pop() ?? '';
  const utility = written.replace(/^!/, '');
  const arbitrary = utility.startsWith('[display:');
  if (!arbitrary && !DISPLAY_UTILITIES.has(utility)) return false;
  return arbitrary || variants.length > 0 || written !== utility;
}

/** The classes without `hidden`, each taken with the space before it, or after it when it comes first. */
function withoutHidden(raw: string): string {
  return raw.replace(/\s+hidden(?=\s|$)/g, '').replace(/^(\s*)hidden(?:\s+|$)/, '$1');
}

/** A `className="hidden"` on a line of its own after the attributes where they each have one. */
function addedClassName(
  opening: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  text: string,
): Replacement {
  const added = `className="${HIDDEN}"`;
  const last = opening.attributes.properties.at(-1);
  const end = opening.attributes.end;
  if (last && startsLine(text, last.getStart()))
    return {
      start: end,
      end,
      replacement: lineEnding(text) + lineIndent(text, last.getStart()) + added,
    };
  return { start: end, end, replacement: ` ${added}` };
}

/** The attribute with its line where it has one, else with the spaces before it, keeping any comment. */
function removed(written: ts.JsxAttribute, text: string): Replacement {
  if (standsAlone(text, written)) return { ...cutRange(text, written), replacement: '' };
  const end = written.end;
  let start = written.getStart();
  while (/\s/.test(text[start - 1] ?? '')) start -= 1;
  return { start, end, replacement: '' };
}

function tokens(raw: string): string[] {
  return raw.split(/\s+/).filter((token) => token !== '');
}

function openingOf(element: ElementNode): ts.JsxOpeningElement | ts.JsxSelfClosingElement {
  return ts.isJsxElement(element) ? element.openingElement : element;
}
