// An owned SVG drawn as the frame's own JSX, so the frame stays a vector design
// whose paths are source the board can pick. The input is canvasSvg's sanitised
// rebuild, which is well-formed and escaped, so a small tokenizer reads it.

import postcss from 'postcss';
import type { OwnedAsset, SvgImageReason } from './protocol.js';
import { CANVAS_LIMITS } from './schema.js';

export interface SvgFrameSource {
  mainTsx: string;
  /** Why the frame draws the asset as an `<img>` instead, or null when it is inline. */
  svgAsImage: SvgImageReason | null;
}

interface SvgElement {
  name: string;
  attributes: Map<string, string>;
  children: (SvgElement | string)[];
}

interface ClassDeclaration {
  rule: number;
  value: string;
}

type ClassStyles = Map<string, Map<string, ClassDeclaration>>;

const TOKEN = /<\/[\w:.-]+>|<([\w:.-]+)((?: [\w:.-]+="[^"]*")*)(\/?)>|([^<]+)/gy;
const ATTRIBUTE = / ([\w:.-]+)="([^"]*)"/g;
const ENTITY = /&(amp|lt|gt|quot);/g;
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"' };
const FRAGMENT_URL = /url\(\s*(["']?)#([^"')\s]+)\1\s*\)/gi;
const CLASS_SELECTOR = /^\.-?[A-Za-z_][\w-]*$/;
const TEXT_CONTENT = new Set(['text', 'tspan', 'textPath', 'title', 'desc']);

// The hyphenated presentation attributes React knows by a camelCase name; any
// other is written as it is, which React passes through unchanged.
const REACT_CAMEL_CASE = new Set(
  `alignment-baseline baseline-shift clip-path clip-rule color-interpolation
  color-interpolation-filters color-rendering dominant-baseline fill-opacity fill-rule flood-color
  flood-opacity font-family font-size font-size-adjust font-stretch font-style font-variant
  font-weight image-rendering letter-spacing lighting-color marker-end marker-mid marker-start
  paint-order shape-rendering stop-color stop-opacity stroke-dasharray stroke-dashoffset
  stroke-linecap stroke-linejoin stroke-miterlimit stroke-opacity stroke-width text-anchor
  text-decoration text-rendering transform-origin unicode-bidi vector-effect word-spacing
  writing-mode`.split(/\s+/),
);

// CSS properties that mean the same as the presentation attribute of that name.
const PRESENTATION = new Set(
  `fill fill-opacity fill-rule stroke stroke-width stroke-linecap stroke-linejoin
  stroke-miterlimit stroke-dasharray stroke-dashoffset stroke-opacity opacity color display
  visibility overflow paint-order vector-effect shape-rendering text-rendering image-rendering
  color-rendering color-interpolation color-interpolation-filters mix-blend-mode isolation
  font-family font-size font-size-adjust font-stretch font-style font-variant font-weight
  letter-spacing word-spacing text-anchor text-decoration dominant-baseline alignment-baseline
  baseline-shift writing-mode direction unicode-bidi white-space clip-path clip-rule mask filter
  marker-start marker-mid marker-end stop-color stop-opacity flood-color flood-opacity
  lighting-color`.split(/\s+/),
);

/**
 * `main.tsx` for a frame seeded from a sanitised SVG. Ids get the design's own
 * prefix, so two pasted SVGs never answer each other's `url(#…)`.
 */
export function svgFrameSource(
  asset: OwnedAsset,
  sanitised: Buffer,
  designId: string,
): SvgFrameSource {
  try {
    return { mainTsx: vectorSource(asset, sanitised.toString('utf8'), designId), svgAsImage: null };
  } catch (error) {
    if (error instanceof KeptAsImage) return imageFrame(asset, error.reason);
    throw error;
  }
}

/** Thrown as soon as the conversion meets what keeps the SVG an image, so no more work is spent on it. */
class KeptAsImage extends Error {
  constructor(readonly reason: SvgImageReason) {
    super(reason);
  }
}

function vectorSource(asset: OwnedAsset, sanitised: string, designId: string): string {
  const root = readSanitised(sanitised);
  applyClassRules(root, classStyles(takeStylesheets(root)));
  root.attributes.set('width', String(asset.width));
  root.attributes.set('height', String(asset.height));

  const writer = new JsxWriter(`v${designId.slice(0, 8)}-`);
  const markup = writer.element(root, '    ', ' className="block"');
  const mainTsx = `export default function Vector() {\n  return (\n${markup}\n  );\n}\n`;
  if (Buffer.byteLength(mainTsx, 'utf8') > CANVAS_LIMITS.maxFileBytes)
    throw new KeptAsImage('too_large');
  return mainTsx;
}

function imageFrame(asset: OwnedAsset, reason: SvgImageReason): SvgFrameSource {
  const image = `<img className="block" src="canvas-asset:${asset.assetId}" width="${String(asset.width)}" height="${String(asset.height)}" alt="" />`;
  return {
    mainTsx: `export default function Vector() {\n  return (\n    ${image}\n  );\n}\n`,
    svgAsImage: reason,
  };
}

function readSanitised(markup: string): SvgElement {
  const document: SvgElement = { name: '', attributes: new Map(), children: [] };
  const open = [document];
  let elements = 0;
  for (const token of markup.matchAll(TOKEN)) {
    const parent = open[open.length - 1];
    const name = token.at(1);
    const characters = token.at(4);
    if (characters !== undefined) parent.children.push(decode(characters));
    else if (name === undefined) open.pop();
    else {
      elements += 1;
      if (elements > CANVAS_LIMITS.maxSourceElements) throw new KeptAsImage('too_large');
      const element: SvgElement = { name, attributes: new Map(), children: [] };
      for (const [, attribute, value] of token[2].matchAll(ATTRIBUTE))
        element.attributes.set(attribute, decode(value));
      parent.children.push(element);
      if (token[3] === '') open.push(element);
    }
  }
  const [root] = document.children;
  if (typeof root !== 'object') throw new Error('A sanitised SVG has one root element.');
  return root;
}

function decode(text: string): string {
  return text.replace(ENTITY, (_, name: string) => ENTITIES[name]);
}

/** Every `<style>`'s CSS in document order; the elements leave the tree. */
function takeStylesheets(element: SvgElement): string[] {
  const stylesheets: string[] = [];
  element.children = element.children.filter((child) => {
    if (typeof child === 'string') return true;
    if (child.name === 'style') {
      stylesheets.push(child.children.filter((text) => typeof text === 'string').join(''));
      return false;
    }
    stylesheets.push(...takeStylesheets(child));
    return true;
  });
  return stylesheets;
}

/**
 * What each class sets: its properties' last declarations and the number of
 * the rule they are in, from rules that are all `.class { presentation }`.
 */
function classStyles(stylesheets: string[]): ClassStyles {
  const styles: ClassStyles = new Map();
  let rule = 0;
  for (const css of stylesheets) {
    for (const node of postcss.parse(css).nodes) {
      if (node.type === 'comment') continue;
      if (
        node.type !== 'rule' ||
        !node.selectors.every((selector) => CLASS_SELECTOR.test(selector))
      )
        throw new KeptAsImage('stylesheet');
      rule += 1;
      for (const declaration of node.nodes) {
        if (declaration.type === 'comment') continue;
        const property = declaration.type === 'decl' ? declaration.prop.toLowerCase() : '';
        if (declaration.type !== 'decl' || declaration.important || !PRESENTATION.has(property))
          throw new KeptAsImage('stylesheet');
        for (const selector of node.selectors) {
          const name = selector.slice(1);
          const declared = styles.get(name) ?? new Map<string, ClassDeclaration>();
          declared.set(property, { rule, value: declaration.value });
          styles.set(name, declared);
        }
      }
    }
  }
  return styles;
}

// A class rule beats a presentation attribute and loses to `style`, so writing
// it over the attribute keeps the cascade; of two rules, the later one wins. The
// class goes either way: it meant nothing outside the SVG's own stylesheet, and
// in a frame it is Tailwind's.
function applyClassRules(element: SvgElement, styles: ClassStyles): void {
  const winners = new Map<string, ClassDeclaration>();
  for (const name of new Set((element.attributes.get('class') ?? '').split(/\s+/)))
    for (const [property, declared] of styles.get(name) ?? [])
      if ((winners.get(property)?.rule ?? 0) < declared.rule) winners.set(property, declared);
  element.attributes.delete('class');
  for (const [property, { value }] of winners) element.attributes.set(property, value);
  for (const child of element.children)
    if (typeof child !== 'string') applyClassRules(child, styles);
}

class JsxWriter {
  // Characters are at least as many bytes, so running out of room means the file is too large.
  private room = CANVAS_LIMITS.maxFileBytes;

  constructor(private readonly idPrefix: string) {}

  /** Text content stays on one line, where JSX keeps its spaces. */
  element(element: SvgElement, indent: string, extraAttributes = ''): string {
    if (TEXT_CONTENT.has(element.name)) return indent + this.inline(element);
    const start = this.spend(
      `${indent}<${element.name}${extraAttributes}${this.attributes(element)}`,
    );
    // Characters outside text content draw nothing.
    const children = element.children.filter((child) => typeof child !== 'string');
    if (children.length === 0) return `${start} />`;
    return [
      `${start}>`,
      ...children.map((child) => this.element(child, `${indent}  `)),
      `${indent}</${element.name}>`,
    ].join('\n');
  }

  private inline(element: SvgElement): string {
    const start = this.spend(`<${element.name}${this.attributes(element)}`);
    const content = element.children
      .map((child) => (typeof child === 'string' ? this.spend(jsxText(child)) : this.inline(child)))
      .join('');
    return content === '' ? `${start} />` : `${start}>${content}</${element.name}>`;
  }

  private spend(written: string): string {
    this.room -= written.length;
    if (this.room < 0) throw new KeptAsImage('too_large');
    return written;
  }
  private attributes(element: SvgElement): string {
    let written = '';
    for (const [name, value] of element.attributes) {
      if (name === 'xmlns') continue;
      if (name === 'style') {
        const style = this.styleObject(value);
        if (style !== '') written += ` style={{ ${style} }}`;
        continue;
      }
      written += ` ${jsxName(name)}="${jsxAttribute(this.attributeValue(name, value))}"`;
    }
    return written;
  }

  private attributeValue(name: string, value: string): string {
    if (name === 'id') return this.idPrefix + value;
    if (name === 'href' && value.startsWith('#')) return `#${this.idPrefix}${value.slice(1)}`;
    if (name === 'aria-labelledby' || name === 'aria-describedby')
      return value
        .trim()
        .split(/\s+/)
        .map((id) => this.idPrefix + id)
        .join(' ');
    return this.withPrefixedUrls(value);
  }

  private withPrefixedUrls(value: string): string {
    return value.replace(FRAGMENT_URL, (_, _quote, id: string) => `url(#${this.idPrefix}${id})`);
  }

  // React sets a style object property by property and cannot say `!important`.
  private styleObject(style: string): string {
    const entries: string[] = [];
    postcss.parse(style).walkDecls((declaration) => {
      const value = JSON.stringify(this.withPrefixedUrls(declaration.value));
      entries.push(`${styleKey(declaration.prop)}: ${value}`);
    });
    return entries.join(', ');
  }
}

function jsxName(attribute: string): string {
  if (attribute === 'xml:space') return 'xmlSpace';
  if (attribute === 'xml:lang') return 'xmlLang';
  return REACT_CAMEL_CASE.has(attribute) ? camelCase(attribute) : attribute;
}

function styleKey(property: string): string {
  if (property.startsWith('--')) return JSON.stringify(property);
  const key = camelCase(property.toLowerCase().replace(/^-ms-/, 'ms-'));
  return /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
}

function camelCase(name: string): string {
  return name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function jsxAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

// Braces open an expression in JSX text; entities are how text says them.
const TEXT_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '{': '&#123;',
  '}': '&#125;',
};

function jsxText(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/[&<>{}]/g, (character) => TEXT_ESCAPES[character]);
}
