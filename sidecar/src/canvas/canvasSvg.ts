// An SVG is a document, not pixels. Opened as a page, embedded with <object>,
// inlined into exported source or served from a user's project, its markup can
// run script, load remote resources and expand entities. Every SVG the canvas
// owns is therefore rebuilt here from an allowlist, so what is stored can only
// draw. Vectors stay vectors: nothing is rasterised, and only what cannot be
// made safe (script, foreignObject, animation, outside references) is dropped.

import { canvasError } from './canvasError.js';
import { FRAGMENT, isSafeValue, sanitiseDeclarations, sanitiseStylesheet } from './canvasSvgCss.js';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink';
/** Every sanitised SVG starts with exactly this, which is how stored bytes are recognised. */
export const SANITISED_SVG_PREFIX = `<svg xmlns="${SVG_NAMESPACE}"`;

const NAME = '[A-Za-z_][\\w.-]*(?::[A-Za-z_][\\w.-]*)?';
const OPEN_TAG = new RegExp(`<(${NAME})`, 'y');
const ATTRIBUTE = new RegExp(`\\s+(${NAME})\\s*=\\s*(?:"([^"<]*)"|'([^'<]*)')`, 'y');
const TAG_END = /\s*(\/?)>/y;
const CLOSE_TAG = new RegExp(`</(${NAME})\\s*>`, 'y');
const REFERENCE = /&(?:#(\d{1,7})|#x([0-9A-Fa-f]{1,6})|(lt|gt|amp|quot|apos));/y;
const NAMED: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
// A DOCTYPE without an internal subset declares nothing; one with a subset can
// declare entities (billion laughs, external files), so it is refused.
const DOCTYPE =
  /<!DOCTYPE\s+svg(?:\s+(?:PUBLIC\s+(?:"[^"]*"|'[^']*')\s+(?:"[^"]*"|'[^']*')|SYSTEM\s+(?:"[^"]*"|'[^']*')))?\s*>/y;
const MAX_DEPTH = 128;
// What sanitising costs on the sidecar's event loop, which bytes alone do not
// bound: elements, attributes and character references, and CSS for PostCSS.
const MAX_NODES = 50_000;
const MAX_CSS_LENGTH = 128 * 1024;
const MAX_DIMENSION = 8192;
const INVALID_SVG = 'Choose a valid SVG file.';
const UNSAFE_SVG =
  'This SVG declares its own entities, which DROIDEX does not read. Export it again as plain SVG.';
const COMPLEX_SVG = 'This SVG is too complex to import. Simplify it, or export a PNG.';

const ELEMENTS = new Set(
  `svg g defs symbol use switch title desc path rect circle ellipse line polyline polygon text
  tspan textPath linearGradient radialGradient stop pattern clipPath mask marker filter image style
  feBlend feColorMatrix feComponentTransfer feComposite feConvolveMatrix feDiffuseLighting
  feDisplacementMap feDistantLight feDropShadow feFlood feFuncA feFuncB feFuncG feFuncR
  feGaussianBlur feMerge feMergeNode feMorphology feOffset fePointLight feSpecularLighting
  feSpotLight feTile feTurbulence`.split(/\s+/),
);

// Geometry, paint, text and filter attributes. Nothing here can name a script,
// an event or a resource outside the document; `href` and `style` are checked apart.
const ATTRIBUTES = new Set(
  `id class lang xml:space xml:lang role aria-label aria-labelledby aria-describedby aria-hidden
  width height viewBox preserveAspectRatio version x y x1 y1 x2 y2 cx cy r rx ry fx fy fr d points
  pathLength transform transform-origin dx dy rotate textLength lengthAdjust startOffset method
  spacing side gradientUnits gradientTransform spreadMethod offset stop-color stop-opacity
  patternUnits patternContentUnits patternTransform clipPathUnits maskUnits maskContentUnits
  clip-path clip-rule mask markerWidth markerHeight markerUnits refX refY orient marker-start
  marker-mid marker-end filterUnits primitiveUnits filter in in2 result stdDeviation mode type
  values operator k1 k2 k3 k4 kernelMatrix order divisor bias targetX targetY edgeMode
  preserveAlpha surfaceScale diffuseConstant specularConstant specularExponent kernelUnitLength
  scale xChannelSelector yChannelSelector radius baseFrequency numOctaves seed stitchTiles azimuth
  elevation pointsAtX pointsAtY pointsAtZ limitingConeAngle flood-color flood-opacity
  lighting-color tableValues slope intercept amplitude exponent color-interpolation-filters
  color-interpolation fill fill-opacity fill-rule stroke stroke-width stroke-linecap
  stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset stroke-opacity opacity
  color display visibility overflow paint-order vector-effect shape-rendering text-rendering
  image-rendering color-rendering mix-blend-mode isolation font-family font-size font-size-adjust
  font-stretch font-style font-variant font-weight letter-spacing word-spacing text-anchor
  text-decoration dominant-baseline alignment-baseline baseline-shift writing-mode direction
  unicode-bidi white-space systemLanguage`.split(/\s+/),
);

/** Elements whose `href` may point at another element of the same document. */
const FRAGMENT_LINKS = new Set([
  'use',
  'linearGradient',
  'radialGradient',
  'pattern',
  'filter',
  'textPath',
]);
const EMBEDDED_RASTER = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=\s]+$/;

export interface SanitisedSvg {
  bytes: Buffer;
  width: number;
  height: number;
}

/** The SVG rebuilt from its safe parts with its intrinsic size, or `invalid_input`. */
export function sanitiseSvg(source: Uint8Array): SanitisedSvg {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(source);
  } catch {
    throw canvasError('invalid_input', INVALID_SVG);
  }
  const reader = new SvgReader(text.replace(/^\uFEFF/, ''));
  const { markup, rootAttributes } = reader.read();
  return { bytes: Buffer.from(markup, 'utf8'), ...intrinsicSize(rootAttributes) };
}

/** The element's output name, or null when it and everything inside are dropped. */
function keptName(
  localName: string,
  inSvg: boolean,
  parent: OpenElement | undefined,
): string | null {
  if (!inSvg) return null;
  if (parent && (parent.kept === null || parent.css !== null)) return null;
  // <a> is a group with a link; the link goes and the group stays.
  const name = localName === 'a' ? 'g' : localName;
  return ELEMENTS.has(name) ? name : null;
}

interface OpenElement {
  qualifiedName: string;
  namespaces: Map<string, string>;
  /** The element's output name, or null when it and everything inside are dropped. */
  kept: string | null;
  /** Where its `>` sits in the output, so an element with no content closes itself. */
  closeAt: number;
  css: string[] | null;
}

class SvgReader {
  private at = 0;
  private readonly out: string[] = [];
  private readonly open: OpenElement[] = [];
  private nodes = 0;
  private cssLength = 0;
  private rootAttributes: Map<string, string> | null = null;
  private rootClosed = false;

  constructor(private readonly text: string) {}

  read(): { markup: string; rootAttributes: Map<string, string> } {
    while (this.at < this.text.length) {
      if (this.text.startsWith('<!--', this.at)) this.skipPast('-->');
      else if (this.text.startsWith('<![CDATA[', this.at)) {
        const end = this.indexOrFail(']]>', this.at + 9);
        this.characters(this.text.slice(this.at + 9, end));
        this.at = end + 3;
      } else if (this.text.startsWith('<?', this.at)) this.skipPast('?>');
      else if (this.text.startsWith('<!', this.at)) this.doctype();
      else if (this.text.startsWith('</', this.at)) this.closeTag();
      else if (this.text[this.at] === '<') this.openTag();
      else {
        const end = this.text.indexOf('<', this.at);
        const stop = end === -1 ? this.text.length : end;
        this.characters(this.decode(this.text.slice(this.at, stop)));
        this.at = stop;
      }
    }
    if (!this.rootAttributes || !this.rootClosed) throw canvasError('invalid_input', INVALID_SVG);
    return { markup: this.out.join(''), rootAttributes: this.rootAttributes };
  }

  private doctype(): void {
    DOCTYPE.lastIndex = this.at;
    if (this.rootAttributes || !DOCTYPE.test(this.text))
      throw canvasError('invalid_input', UNSAFE_SVG);
    this.at = DOCTYPE.lastIndex;
  }

  private openTag(): void {
    OPEN_TAG.lastIndex = this.at;
    const name = OPEN_TAG.exec(this.text);
    if (!name) throw canvasError('invalid_input', INVALID_SVG);
    const attributes = new Map<string, string>();
    let at = OPEN_TAG.lastIndex;
    for (;;) {
      TAG_END.lastIndex = at;
      const closing = TAG_END.exec(this.text);
      if (closing) {
        this.at = TAG_END.lastIndex;
        this.startElement(name[1], attributes, closing[1] === '/');
        return;
      }
      this.countNode();
      ATTRIBUTE.lastIndex = at;
      const match = ATTRIBUTE.exec(this.text);
      if (!match || attributes.has(match[1])) throw canvasError('invalid_input', INVALID_SVG);
      const raw = match.at(2) ?? match[3];
      attributes.set(match[1], this.decode(raw.replace(/[\t\n\r]/g, ' ')));
      at = ATTRIBUTE.lastIndex;
    }
  }

  private closeTag(): void {
    CLOSE_TAG.lastIndex = this.at;
    const match = CLOSE_TAG.exec(this.text);
    const element = this.open.at(-1);
    if (!match || element?.qualifiedName !== match[1])
      throw canvasError('invalid_input', INVALID_SVG);
    this.at = CLOSE_TAG.lastIndex;
    this.endElement();
  }

  private startElement(
    qualifiedName: string,
    attributes: Map<string, string>,
    selfClosing: boolean,
  ): void {
    if (this.rootClosed) throw canvasError('invalid_input', INVALID_SVG);
    this.countNode();
    if (this.open.length >= MAX_DEPTH) throw canvasError('invalid_input', COMPLEX_SVG);

    const parent = this.open.at(-1);
    const namespaces = declaredNamespaces(parent?.namespaces, attributes);
    const [prefix, localName] = splitName(qualifiedName);
    // A root <svg> pasted from HTML often has no xmlns; it can only mean SVG.
    if (!parent && prefix === '' && !namespaces.has('')) namespaces.set('', SVG_NAMESPACE);
    const inSvg = namespaces.get(prefix) === SVG_NAMESPACE;
    if (!parent && (!inSvg || localName !== 'svg')) throw canvasError('invalid_input', INVALID_SVG);

    const kept = keptName(localName, inSvg, parent);
    const element: OpenElement = {
      qualifiedName,
      namespaces,
      kept,
      closeAt: -1,
      css: kept === 'style' ? [] : null,
    };
    if (kept !== null) element.closeAt = this.writeStartTag(kept, attributes, namespaces);
    this.open.push(element);
    if (selfClosing) this.endElement();
  }

  /** Writes the kept element's start tag and returns where its `>` sits. */
  private writeStartTag(
    kept: string,
    attributes: Map<string, string>,
    namespaces: Map<string, string>,
  ): number {
    this.countCss(attributes.get('style') ?? '');
    const safe = safeAttributes(kept, attributes, namespaces);
    const isRoot = this.open.length === 0;
    if (isRoot) this.rootAttributes = safe;
    let tag = isRoot ? SANITISED_SVG_PREFIX : `<${kept}`;
    for (const [name, value] of safe) tag += ` ${name}="${escapeAttribute(value)}"`;
    this.out.push(tag, '>');
    return this.out.length - 1;
  }

  private endElement(): void {
    const element = this.open.pop();
    if (!element) throw canvasError('invalid_input', INVALID_SVG);
    if (this.open.length === 0) this.rootClosed = true;
    if (element.kept === null) return;
    if (element.css) {
      const stylesheet = element.css.join('');
      this.countCss(stylesheet);
      const css = sanitiseStylesheet(stylesheet);
      if (css) this.out.push(escapeText(css));
    }
    if (this.out.length - 1 === element.closeAt) this.out[element.closeAt] = '/>';
    else this.out.push(`</${element.kept}>`);
  }

  private characters(value: string): void {
    const element = this.open.at(-1);
    if (!element) {
      if (value.trim() !== '') throw canvasError('invalid_input', INVALID_SVG);
      return;
    }
    if (element.kept === null) return;
    if (element.css) element.css.push(value);
    else this.out.push(escapeText(value));
  }

  private countNode(): void {
    this.nodes += 1;
    if (this.nodes > MAX_NODES) throw canvasError('invalid_input', COMPLEX_SVG);
  }

  private countCss(css: string): void {
    this.cssLength += css.length;
    if (this.cssLength > MAX_CSS_LENGTH) throw canvasError('invalid_input', COMPLEX_SVG);
  }

  /** XML's five entities and character references; any other `&name;` needs a DTD, which is refused. */
  private decode(text: string): string {
    if (!text.includes('&')) return text;
    let decoded = '';
    let at = 0;
    for (let amp = text.indexOf('&'); amp !== -1; amp = text.indexOf('&', at)) {
      this.countNode();
      decoded += text.slice(at, amp);
      REFERENCE.lastIndex = amp;
      const match = REFERENCE.exec(text);
      if (!match) throw canvasError('invalid_input', UNSAFE_SVG);
      if (match[3]) decoded += NAMED[match[3]];
      else {
        const code = match[1] ? Number(match[1]) : Number.parseInt(match[2], 16);
        if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff))
          throw canvasError('invalid_input', INVALID_SVG);
        decoded += String.fromCodePoint(code);
      }
      at = REFERENCE.lastIndex;
    }
    return decoded + text.slice(at);
  }

  private skipPast(terminator: string): void {
    this.at = this.indexOrFail(terminator, this.at + 2) + terminator.length;
  }

  private indexOrFail(search: string, from: number): number {
    const index = this.text.indexOf(search, from);
    if (index === -1) throw canvasError('invalid_input', INVALID_SVG);
    return index;
  }
}

function declaredNamespaces(
  inherited: Map<string, string> | undefined,
  attributes: Map<string, string>,
): Map<string, string> {
  let namespaces = inherited ?? new Map<string, string>();
  for (const [name, value] of attributes) {
    if (name !== 'xmlns' && !name.startsWith('xmlns:')) continue;
    if (namespaces === inherited) namespaces = new Map(inherited);
    namespaces.set(name === 'xmlns' ? '' : name.slice(6), value);
  }
  return namespaces;
}

function splitName(qualifiedName: string): [prefix: string, localName: string] {
  const colon = qualifiedName.indexOf(':');
  return colon === -1
    ? ['', qualifiedName]
    : [qualifiedName.slice(0, colon), qualifiedName.slice(colon + 1)];
}

function safeAttributes(
  element: string,
  attributes: Map<string, string>,
  namespaces: Map<string, string>,
): Map<string, string> {
  const safe = new Map<string, string>();
  for (const [qualifiedName, value] of attributes) {
    const [prefix, localName] = splitName(qualifiedName);
    const isHref =
      (prefix === '' && localName === 'href') ||
      (namespaces.get(prefix) === XLINK_NAMESPACE && localName === 'href');
    if (isHref) {
      const link = value.trim();
      if (FRAGMENT_LINKS.has(element) && FRAGMENT.test(link)) safe.set('href', link);
      if (element === 'image' && EMBEDDED_RASTER.test(link))
        safe.set('href', link.replace(/\s/g, ''));
      continue;
    }
    if (qualifiedName === 'style') {
      const style = sanitiseDeclarations(value);
      if (style) safe.set('style', style);
      continue;
    }
    if (ATTRIBUTES.has(qualifiedName) && isSafeValue(value)) safe.set(qualifiedName, value);
  }
  return safe;
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

function escapeText(text: string): string {
  return text.replace(/[&<>]/g, (character) => ESCAPES[character]);
}

function escapeAttribute(value: string): string {
  return value.replace(/[&<>"]/g, (character) => ESCAPES[character]);
}

const UNIT_PX: Record<string, number> = {
  '': 1,
  px: 1,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  pt: 4 / 3,
  pc: 16,
};

/** An absolute length in CSS pixels; percentages and font-relative units have no intrinsic size. */
function absoluteLength(value: string | undefined): number | null {
  const match = /^\s*(\+?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(px|in|cm|mm|pt|pc|)\s*$/i.exec(
    value ?? '',
  );
  if (!match) return null;
  const length = Number(match[1]) * UNIT_PX[match[2].toLowerCase()];
  return Number.isFinite(length) && length > 0 ? length : null;
}

function viewBoxSize(value: string | undefined): { width: number; height: number } | null {
  const numbers = (value ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (numbers.length !== 4 || !numbers.every(Number.isFinite)) return null;
  const [, , width, height] = numbers;
  return width > 0 && height > 0 ? { width, height } : null;
}

/**
 * The size an <img> gives the SVG: its absolute width and height, the missing
 * one from the viewBox's aspect ratio, and the browser's 300 × 150 without
 * either. Scaled to fit the canvas's pixel cap; vectors lose nothing by it.
 */
function intrinsicSize(attributes: Map<string, string>): { width: number; height: number } {
  const box = viewBoxSize(attributes.get('viewBox'));
  const ratio = box ? box.width / box.height : null;
  const width = absoluteLength(attributes.get('width'));
  const height = absoluteLength(attributes.get('height'));
  if (width !== null && height !== null) return fitted(width, height);
  if (width !== null) return fitted(width, ratio === null ? 150 : width / ratio);
  if (height !== null) return fitted(ratio === null ? 300 : height * ratio, height);
  return box ? fitted(box.width, box.height) : fitted(300, 150);
}

function fitted(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, MAX_DIMENSION / width, MAX_DIMENSION / height);
  return {
    width: Math.min(MAX_DIMENSION, Math.max(1, Math.round(width * scale))),
    height: Math.min(MAX_DIMENSION, Math.max(1, Math.round(height * scale))),
  };
}
