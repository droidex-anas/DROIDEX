// Writes a style edit into one element's own attributes the way a person
// writing Tailwind would: each property becomes the class that says it
// (tailwindStyles.ts) in place of the classes it makes dead, and goes into the
// style attribute only where no class says it or a class would not win. An SVG
// presentation attribute the edit sets goes too, as any class or style beats it.

import ts from 'typescript';
import { attribute, attributeValue, isLiteral, propertyName } from './jsxAttributes.js';
import type { KitTheme } from './kitTailwindTheme.js';
import type { SourceReplacement } from './sourceElementEdits.js';
import { SourceElementError } from './sourceElementError.js';
import { ambiguous, classLiterals } from './sourceElements.js';
import {
  STYLE_PROPERTIES,
  styleName,
  styleValue,
  unsupportedStyle,
  type StyleResolution,
} from './styleEdits.js';
import { classStyle, longhands, styleClass } from './tailwindStyles.js';

export interface ResolvedStyle {
  property: string;
  resolution: StyleResolution;
}

type Opening = ts.JsxOpeningElement | ts.JsxSelfClosingElement;
type Literal = ts.StringLiteral | ts.NoSubstitutionTemplateLiteral;

/** One class as the edit leaves it: removed when `name` is null, added when `at` is. */
interface ClassEntry {
  name: string | null;
  /** Its index among the classes of the source literal it came from. */
  at: number | null;
}

/** One string literal of the className, or the attribute an edit would add when there is none. */
interface ClassSlot {
  literal: Literal | null;
  raw: string;
  entries: ClassEntry[];
}

interface StyleEntry {
  name: string;
  /** Its index in the source object, null for an added entry. */
  at: number | null;
  /** The value's new source text; null keeps what the source says. */
  value: string | null;
  removed: boolean;
}

interface InlineStyle {
  attribute: ts.JsxAttribute | undefined;
  entries: StyleEntry[];
}

// React writes a bare number in these as it is, and in any other property as pixels.
const UNITLESS_PROPERTIES = new Set(['opacity', 'fontWeight', 'lineHeight', 'flexGrow']);
const BARE_NUMBER = /^(-?(?:\d+|\d*\.\d+))$/;
const PIXELS = /^(-?(?:\d+|\d*\.\d+))px$|^(0)$/;
const FILTERS = new Set(['filter', 'backdropFilter']);
const BLUR_OR_RESET_CLASS = /^!?(?:backdrop-)?(?:blur(?:-|$)|filter-none$)/;
// An SVG paint's presentation attributes, in each spelling JSX passes through.
const PRESENTATION_ATTRIBUTES: Readonly<Record<string, readonly string[]>> = {
  fill: ['fill'],
  stroke: ['stroke'],
  strokeWidth: ['strokeWidth', 'stroke-width'],
};

/** The replacements that set every style in `styles`, in order, on one element. */
export function styleReplacements(
  opening: Opening,
  source: ts.SourceFile,
  styles: readonly ResolvedStyle[],
  theme: KitTheme = {},
): SourceReplacement[] {
  // A property becomes source text, so only a whitelisted name may reach it.
  for (const { property } of styles)
    if (!Object.hasOwn(STYLE_PROPERTIES, property)) throw unsupportedStyle(property);
  const slots = readClasses(opening, source);
  const style = readStyle(opening);
  for (const change of styles) setStyle(slots, style, change, theme);
  const styleKept = style.entries.some((entry) => !entry.removed);
  return [
    ...writeClasses(opening, source, slots, styleKept ? style.attribute : undefined),
    ...writeStyle(opening, source, style),
    ...removePresentation(opening, styles),
  ];
}

/**
 * Removes the presentation attribute, such as `fill="#000"`, of each SVG paint
 * the edit sets. One worked out in code is the user's logic, which the edit
 * leaves to the agent rather than drop.
 */
function removePresentation(
  opening: Opening,
  styles: readonly ResolvedStyle[],
): SourceReplacement[] {
  const spellings = new Set(
    styles.flatMap(({ property }) =>
      Object.hasOwn(PRESENTATION_ATTRIBUTES, property) ? PRESENTATION_ATTRIBUTES[property] : [],
    ),
  );
  return opening.attributes.properties.flatMap((dead) => {
    if (!ts.isJsxAttribute(dead) || !spellings.has(dead.name.getText())) return [];
    const value = attributeValue(dead);
    if (!value || !(isLiteral(value) || ts.isNumericLiteral(value)))
      throw new SourceElementError(
        'ambiguous_element',
        `This shape's ${dead.name.getText()} is worked out in code. Ask the agent to change it.`,
      );
    return [{ start: dead.getFullStart(), end: dead.end, replacement: '' }];
  });
}

/**
 * Sets one property. The classes and inline entries it would make dead go; a
 * class says the value when one can and would apply in every frame, and the
 * style attribute says it otherwise.
 */
function setStyle(
  slots: ClassSlot[],
  style: InlineStyle,
  { property, resolution }: ResolvedStyle,
  theme: KitTheme,
) {
  const own = longhands(property);
  const within = (sets: readonly string[]) => sets.every((longhand) => own.includes(longhand));
  const live = liveClasses(slots, theme);
  // A class that stays may be what this frame shows: a breakpoint or
  // colour-mode one, or one a kit theme key makes two utilities. Only the
  // style attribute is sure to win over it.
  const outranking = live.filter(
    ({ read }) =>
      (read.scope === 'frame' || (read.scope === 'always' && read.shared)) &&
      read.sets.some((longhand) => own.includes(longhand)),
  );
  if (outranking.some(({ read }) => read.important))
    throw new SourceElementError(
      'ambiguous_element',
      `A class that overrides everything else sets this element’s ${styleName(property)}, so a change here would not show. Ask the agent to change it.`,
    );
  const outranked = outranking.length > 0;
  // An inline shorthand that also sets this property would win over a class.
  const inlineShorthand = style.entries.some((entry) => {
    const sets = longhands(entry.name);
    return !entry.removed && !within(sets) && own.every((longhand) => sets.includes(longhand));
  });
  const name = outranked || inlineShorthand ? null : styleClass(property, resolution, theme);

  const dead = live.filter(
    ({ read }) => read.scope === 'always' && !read.shared && within(read.sets),
  );
  keepFilter(property, name, dead, style);
  const first = dead.at(0)?.entry;
  const important = dead.some(({ read }) => read.important);
  let lostLineHeight: string | undefined;
  for (const { entry, read } of dead) {
    lostLineHeight = read.lineHeight ?? lostLineHeight;
    entry.name = null;
  }
  for (const entry of style.entries)
    if (entry.name !== property && within(longhands(entry.name))) entry.removed = true;

  if (name === null) {
    setInline(style, property, inlineValue(property, styleValue(property, resolution)));
  } else {
    for (const entry of style.entries) if (entry.name === property) entry.removed = true;
    if (first) first.name = important ? `!${name}` : name;
    else addClass(slots, name);
  }
  keepLineHeight(slots, style, lostLineHeight, theme);
}

/**
 * A blur class sets one function of a filter that composes with the others,
 * which a blur inline, or in place of a filter set another way, would drop. A
 * `filter-none` reset would win over the blur, so the blur takes its place.
 */
function keepFilter(
  property: string,
  name: string | null,
  dead: readonly { entry: ClassEntry }[],
  style: InlineStyle,
) {
  if (!FILTERS.has(property)) return;
  if (
    name === null ||
    dead.some(({ entry }) => !BLUR_OR_RESET_CLASS.test(entry.name ?? '')) ||
    style.entries.some((entry) => !entry.removed && entry.name === property)
  )
    throw new SourceElementError(
      'ambiguous_element',
      `This element has other filters beside its ${styleName(property)}, so changing it here would drop them. Ask the agent to change it.`,
    );
}

/** A font-size class sets the line height too, which stays what it was when the class goes. */
function keepLineHeight(
  slots: ClassSlot[],
  style: InlineStyle,
  lostLineHeight: string | undefined,
  theme: KitTheme,
) {
  if (lostLineHeight === undefined || setsLineHeight(slots, style, theme)) return;
  const leading = styleClass('lineHeight', { kind: 'raw', value: lostLineHeight }, theme);
  if (leading) addClass(slots, leading);
  else setInline(style, 'lineHeight', inlineValue('lineHeight', lostLineHeight));
}

function liveClasses(slots: ClassSlot[], theme: KitTheme) {
  return slots.flatMap(({ entries }) =>
    entries.flatMap((entry) => {
      const read = entry.name === null ? null : classStyle(entry.name, theme);
      return read ? [{ entry, read }] : [];
    }),
  );
}

function setsLineHeight(slots: ClassSlot[], style: InlineStyle, theme: KitTheme): boolean {
  return (
    liveClasses(slots, theme).some(
      ({ read }) => read.scope === 'always' && read.sets.includes('lineHeight'),
    ) || style.entries.some((entry) => !entry.removed && entry.name === 'lineHeight')
  );
}

function addClass(slots: ClassSlot[], name: string) {
  slots.at(-1)?.entries.push({ name, at: null });
}

/**
 * Sets an inline entry where it is, unless a shorthand after it would undo
 * it; then it moves to the end, as a new entry does.
 */
function setInline(style: InlineStyle, property: string, value: string) {
  const own = longhands(property);
  const index = style.entries.findIndex((entry) => !entry.removed && entry.name === property);
  if (index !== -1) {
    const overridden = style.entries
      .slice(index + 1)
      .some(
        (entry) =>
          !entry.removed &&
          entry.name !== property &&
          own.every((longhand) => longhands(entry.name).includes(longhand)),
      );
    if (!overridden) {
      style.entries[index].value = value;
      return;
    }
    style.entries[index].removed = true;
  }
  style.entries.push({ name: property, at: null, value, removed: false });
}

function inlineValue(property: string, css: string): string {
  const match = (UNITLESS_PROPERTIES.has(property) ? BARE_NUMBER : PIXELS).exec(css);
  const number = match?.[1] ?? match?.[2];
  return number === undefined ? JSON.stringify(css) : String(Number(number));
}

function readClasses(opening: Opening, source: ts.SourceFile): ClassSlot[] {
  const classAttribute = attribute(opening, 'className');
  if (!classAttribute) return [{ literal: null, raw: '', entries: [] }];
  const value = attributeValue(classAttribute);
  const literals = value ? classLiterals(value) : null;
  if (!literals) throw ambiguous();
  return literals.map((literal) => {
    const raw = source.text.slice(literal.getStart(source) + 1, literal.end - 1);
    // An escape would make the source spelling differ from the class it names.
    if (raw.includes('\\')) throw ambiguous();
    const entries = [...raw.matchAll(/\S+/g)].map((match, at) => ({ name: match[0], at }));
    return { literal, raw, entries };
  });
}

function readStyle(opening: Opening): InlineStyle {
  const styleAttribute = attribute(opening, 'style');
  if (!styleAttribute) return { attribute: undefined, entries: [] };
  const object = attributeValue(styleAttribute);
  if (!object || !ts.isObjectLiteralExpression(object)) throw ambiguous();
  const entries = object.properties.map((property, at) => {
    if (!ts.isPropertyAssignment(property)) throw ambiguous();
    return { name: propertyName(property.name), at, value: null, removed: false };
  });
  return { attribute: styleAttribute, entries };
}

/** `before` is the style attribute that stays, which a new className goes ahead of. */
function writeClasses(
  opening: Opening,
  source: ts.SourceFile,
  slots: ClassSlot[],
  before: ts.JsxAttribute | undefined,
): SourceReplacement[] {
  const texts = slots.map((slot) => classText(slot.raw, slot.entries));
  const changed = slots.some((slot, index) => texts[index] !== slot.raw);
  if (!changed) return [];
  const classAttribute = attribute(opening, 'className');
  if (!classAttribute) {
    if (before) {
      const start = before.getStart(source);
      return [{ start, end: start, replacement: `className="${texts.join('')}" ` }];
    }
    const end = opening.attributes.end;
    return [{ start: end, end, replacement: ` className="${texts.join('')}"` }];
  }
  if (texts.every((text) => text.trim() === ''))
    return [{ start: classAttribute.getFullStart(), end: classAttribute.end, replacement: '' }];
  const kept = texts.map((text) => text.trim() !== '');
  const edits: SourceReplacement[] = [];
  slots.forEach(({ literal, raw }, index) => {
    const text = texts[index] ?? '';
    if (!literal || !kept[index] || text === raw) return;
    edits.push({ start: literal.getStart(source) + 1, end: literal.end - 1, replacement: text });
  });
  const call = attributeValue(classAttribute);
  if (call && ts.isCallExpression(call) && kept.includes(false))
    edits.push(...listEdits(call.arguments, source, kept, []));
  return edits;
}

/**
 * A literal's classes as the entries leave them. Each kept class keeps the
 * whitespace before it, an added one follows a space, and the literal's own
 * leading and trailing whitespace stays.
 */
function classText(raw: string, entries: readonly ClassEntry[]): string {
  const tokens = [...raw.matchAll(/\S+/g)];
  const firstToken = tokens.at(0);
  const lastToken = tokens.at(-1);
  const lead = firstToken ? raw.slice(0, firstToken.index) : raw;
  const trail = lastToken ? raw.slice(lastToken.index + lastToken[0].length) : '';
  let text = '';
  for (const { name, at } of entries) {
    if (name === null) continue;
    if (text === '') {
      text = name;
      continue;
    }
    const token = at === null ? undefined : tokens.at(at);
    const previous = at === null ? undefined : tokens.at(at - 1);
    const separator =
      token && previous ? raw.slice(previous.index + previous[0].length, token.index) : ' ';
    text += separator + name;
  }
  return text === '' ? '' : lead + text + trail;
}

function writeStyle(opening: Opening, source: ts.SourceFile, style: InlineStyle) {
  const added = style.entries
    .filter((entry) => entry.at === null && !entry.removed)
    .map((entry) => `${entry.name}: ${entry.value ?? ''}`);
  if (!style.attribute) {
    if (added.length === 0) return [];
    const end = opening.attributes.end;
    return [{ start: end, end, replacement: ` style={{ ${added.join(', ')} }}` }];
  }
  const object = attributeValue(style.attribute);
  if (!object || !ts.isObjectLiteralExpression(object)) throw ambiguous();
  const originals = style.entries.filter((entry) => entry.at !== null);
  const changed =
    added.length > 0 || originals.some((entry) => entry.removed || entry.value !== null);
  if (!changed) return [];
  if (style.entries.every((entry) => entry.removed))
    return [{ start: style.attribute.getFullStart(), end: style.attribute.end, replacement: '' }];
  if (object.properties.length === 0)
    return [
      { start: object.getStart(source), end: object.end, replacement: `{ ${added.join(', ')} }` },
    ];
  const edits: SourceReplacement[] = [];
  for (const entry of originals) {
    const property = entry.at === null ? undefined : object.properties[entry.at];
    if (entry.removed || entry.value === null || !property || !ts.isPropertyAssignment(property))
      continue;
    const start = property.initializer.getStart(source);
    edits.push({ start, end: property.initializer.end, replacement: entry.value });
  }
  const kept = originals.map((entry) => !entry.removed);
  return [...edits, ...listEdits(object.properties, source, kept, added)];
}

/**
 * Edits a comma-separated list in place: drops each item not kept along with
 * the separator that went with it, and appends `added` after the last kept
 * item. When none is kept, the added items take the place of all of them.
 */
function listEdits(
  items: ts.NodeArray<ts.Node>,
  source: ts.SourceFile,
  kept: readonly boolean[],
  added: readonly string[],
): SourceReplacement[] {
  const first = items.at(0);
  const last = items.at(-1);
  if (!first || !last) return [];
  const lastKeptIndex = kept.lastIndexOf(true);
  if (lastKeptIndex === -1)
    return [{ start: first.getStart(source), end: last.end, replacement: added.join(', ') }];
  const lastKept = items[lastKeptIndex];
  const edits: SourceReplacement[] = [];
  let trailing: SourceReplacement | null = null;
  for (let index = 0; index < items.length; ) {
    if (kept[index]) {
      index += 1;
      continue;
    }
    let end = index;
    while (end + 1 < items.length && !kept[end + 1]) end += 1;
    const next = items.at(end + 1);
    if (next)
      edits.push({
        start: items[index].getStart(source),
        end: next.getStart(source),
        replacement: '',
      });
    else {
      trailing = { start: lastKept.end, end: last.end, replacement: '' };
      edits.push(trailing);
    }
    index = end + 1;
  }
  if (added.length === 0) return edits;
  const tail = `, ${added.join(', ')}`;
  if (trailing) trailing.replacement = tail;
  else edits.push({ start: lastKept.end, end: lastKept.end, replacement: tail });
  return edits;
}
