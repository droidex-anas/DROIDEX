// Whether a design follows the kit it pins (spec §10). It reads the design's own
// files once they bundle, never the kit's, and looks for three things only:
// a hard-coded colour where a --ds-* token belongs, a font family the kit does
// not provide, and a design that uses none of the kit's primitives. A --ds-*
// token set in source is a deliberate override, noted once and never flagged.
//
// Colours are read where they style something: CSS declarations and Tailwind
// classes anywhere, and literal values of colour-like JSX attributes and style
// properties (`fill`, `stroke`, `color`, `backgroundColor`, ...). Prose, data
// and computed values are not read, and a `var()` fallback is not a literal.

import postcss from 'postcss';
import valueParser from 'postcss-value-parser';
import ts from 'typescript';
import { ADHERENCE_CODES } from './canvasDiagnostics.js';
import { KIT_SPECIFIER } from './designBundle.js';
import { DESIGN_ENTRY } from './designEntry.js';
import { kitPrimitives } from './designSystemBrief.js';
import type { DesignSystem } from './designSystems.js';
import type { CanvasDiagnostic, DesignSystemAdherence, SourceFiles } from './protocol.js';

export type AdherenceResult =
  | { status: 'passed'; diagnostics: CanvasDiagnostic[] }
  | { status: 'failed'; diagnostics: CanvasDiagnostic[] };

const MAX_FINDINGS = 12;
const SCRIPT_FILE = /\.(tsx|ts|jsx|js)$/;
const COLOR_PROPERTY =
  /(?:^|-)(?:color|background|border|outline|shadow|fill|stroke|caret|accent|decoration)(?:-|$)/;
const COLOR_FUNCTIONS = new Set([
  'rgb',
  'rgba',
  'hsl',
  'hsla',
  'hwb',
  'lab',
  'lch',
  'oklab',
  'oklch',
  'color',
]);
const HEX_COLOR = /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i;
// prettier-ignore
const NAMED_COLORS = new Set(('aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen').split(' '));
const PALETTE_CLASS =
  /^-?(bg|text|border(?:-[xytrblse])?|ring(?:-offset)?|outline|fill|stroke|from|via|to|divide|placeholder|caret|accent|decoration|shadow)-(?:(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|[1-9]00|950)|black|white)(?:\/\S+)?$/;
const ARBITRARY_CLASS = /^-?([a-z][\w-]*?)-\[(.+)\](?:\/\S+)?$/;
const TAILWIND_FONT_CLASS = /^font-(?:sans|serif|mono)$/;
// Families that name no font file: CSS keywords and the platform's generic stacks.
const GENERIC_FAMILIES = new Set([
  'inherit',
  'initial',
  'unset',
  'revert',
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'math',
  'emoji',
  'fangsong',
]);

/** The pinned kit as the check reads it. */
interface Kit {
  tokens: Set<string>;
  families: Set<string>;
  fontTokens: string[];
  classes: Set<string>;
  primitives: string[];
}

/** Where a finding is: a design file and a 1-based line. */
interface Place {
  file: string;
  line: number;
}

/**
 * Checks `files` against `system` under `rule`. Guide passes with its findings;
 * strict fails on any finding other than the override note; off checks nothing.
 */
export function checkDesignSystemAdherence(
  files: SourceFiles,
  system: DesignSystem,
  rule: DesignSystemAdherence,
): AdherenceResult {
  if (rule === 'off') return { status: 'passed', diagnostics: [] };
  const check = new DesignCheck(readKit(system));
  for (const [file, text] of Object.entries(files)) {
    if (file.endsWith('.css')) check.stylesheet(file, text);
    else if (SCRIPT_FILE.test(file)) check.script(file, text);
  }
  const violations = check.findings;
  if (!check.usesKit)
    violations.push({
      code: ADHERENCE_CODES.unused,
      message: `The design imports nothing from ${KIT_SPECIFIER}. Build its controls from the kit's primitives (${check.kit.primitives.join(', ')}) so their states and tokens apply.`,
      file: DESIGN_ENTRY,
    });
  if (rule === 'strict' && violations.length > 0)
    return { status: 'failed', diagnostics: violations };
  const note = overrideNote(check.overrides);
  return { status: 'passed', diagnostics: note ? [...violations, note] : violations };
}

function readKit(system: DesignSystem): Kit {
  const families = new Set(GENERIC_FAMILIES);
  const fontTokens: string[] = [];
  for (const [name, value] of Object.entries({ ...system.modes.light, ...system.modes.dark })) {
    if (!name.startsWith('--ds-font')) continue;
    fontTokens.push(name);
    for (const family of fontFamilies(value)) families.add(family.toLowerCase());
  }
  const classes = new Set<string>();
  for (const [path, css] of Object.entries(system.files)) {
    if (!path.endsWith('.css')) continue;
    const root = postcss.parse(css);
    root.walkAtRules('font-face', (rule) => {
      rule.walkDecls('font-family', (declaration) => {
        for (const family of fontFamilies(declaration.value)) families.add(family.toLowerCase());
      });
    });
    root.walkRules((rule) => {
      for (const match of rule.selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) classes.add(match[1]);
    });
  }
  const tokens = new Set(Object.keys(system.modes.light));
  return { tokens, families, fontTokens, classes, primitives: kitPrimitives(system) };
}

/** One design's findings, and whether any of its files reaches for the kit. */
class DesignCheck {
  readonly findings: CanvasDiagnostic[] = [];
  usesKit = false;
  /** The kit tokens the design sets for itself, which are overrides rather than findings. */
  readonly overrides = new Set<string>();
  private readonly reported = new Set<string>();

  constructor(readonly kit: Kit) {}

  stylesheet(file: string, text: string): void {
    let root;
    try {
      root = postcss.parse(text);
    } catch {
      // The stylesheet build reports the syntax error itself.
      return;
    }
    root.walkAtRules('apply', (rule) => {
      this.classes({ file, line: rule.source?.start?.line ?? 1 }, rule.params);
    });
    root.walkDecls((declaration) => {
      const place = { file, line: declaration.source?.start?.line ?? 1 };
      this.value(place, declaration.prop.toLowerCase(), declaration.value);
    });
  }

  script(file: string, text: string): void {
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        const specifier = node.moduleSpecifier;
        if (specifier && ts.isStringLiteral(specifier) && specifier.text === KIT_SPECIFIER)
          this.usesKit = true;
        return;
      }
      if (isTextLiteral(node)) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        this.classes({ file, line }, node.text);
        const property = styledProperty(node);
        if (property !== null) this.value({ file, line }, property, node.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  private value(place: Place, property: string, value: string): void {
    if (property.startsWith('--ds-')) {
      this.overrides.add(property);
      return;
    }
    if (property === 'font-family') {
      for (const family of fontFamilies(value)) this.font(place, family, family);
      return;
    }
    if (!property.startsWith('--') && !COLOR_PROPERTY.test(property)) return;
    for (const literal of colorLiterals(value))
      this.add(ADHERENCE_CODES.color, place, literal, this.colorMessage(literal, property, null));
  }

  private classes(place: Place, text: string): void {
    for (const token of text.split(/\s+/)) {
      const utility = withoutVariants(token);
      if (this.kit.classes.has(utility)) this.usesKit = true;
      const palette = PALETTE_CLASS.exec(utility);
      if (palette) {
        const message = this.colorMessage(utility, palette[1], palette[1]);
        this.add(ADHERENCE_CODES.color, place, utility, message);
        continue;
      }
      if (TAILWIND_FONT_CLASS.test(utility)) {
        const message = `${utility} sets Tailwind's own font stack, not the kit's. Use font-[family-name:var(--ds-font-sans)] or inherit the kit font.`;
        this.add(ADHERENCE_CODES.font, place, utility, message);
        continue;
      }
      const arbitrary = ARBITRARY_CLASS.exec(utility);
      if (!arbitrary) continue;
      const [, prefix, raw] = arbitrary;
      const value = raw.replace(/_/g, ' ').replace(/^[a-z-]+:(?!\/)/, '');
      if (prefix === 'font') {
        // `font-[600]` is a weight.
        for (const family of fontFamilies(value))
          if (!/^\d+$/.test(family)) this.font(place, family, utility);
      } else if (colorLiterals(value).length > 0) {
        this.add(ADHERENCE_CODES.color, place, utility, this.colorMessage(utility, prefix, prefix));
      }
    }
  }

  private font(place: Place, family: string, literal: string): void {
    if (this.kit.families.has(family.toLowerCase())) return;
    const tokens = this.kit.fontTokens.map((token) => `var(${token})`).join(' or ');
    const message = `The kit does not provide the font "${family}". Use ${tokens || 'the kit font'} instead.`;
    this.add(ADHERENCE_CODES.font, place, literal, message);
  }

  /** Names the semantic token a utility or property most often wants, when the kit has it. */
  private colorMessage(literal: string, target: string, classPrefix: string | null): string {
    let token = '--ds-accent';
    if (target === 'bg' || target.includes('background')) token = '--ds-surface';
    else if (target === 'text' || target === 'color') token = '--ds-fg';
    else if (/border|divide|ring|outline/.test(target)) token = '--ds-border';
    let example = 'a kit colour token';
    if (this.kit.tokens.has(token))
      example = classPrefix === null ? `var(${token})` : `${classPrefix}-[color:var(${token})]`;
    return `${literal} is a hard-coded colour. Use ${example} instead, or a kit primitive.`;
  }

  /** One finding per literal per file, at its first line, up to the bound. */
  private add(code: string, place: Place, literal: string, message: string): void {
    const key = `${code}\n${place.file}\n${literal}`;
    if (this.reported.has(key) || this.findings.length >= MAX_FINDINGS) return;
    this.reported.add(key);
    this.findings.push({ code, message, ...place });
  }
}

function isTextLiteral(
  node: ts.Node,
): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | ts.TemplateLiteralLikeNode {
  return (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateHead(node) ||
    ts.isTemplateMiddle(node) ||
    ts.isTemplateTail(node)
  );
}

/**
 * The CSS property a literal is the value of, as a JSX attribute or an object
 * property, through conditionals and templates; null for any other literal.
 */
function styledProperty(literal: ts.Node): string | null {
  const value = styledValue(literal);
  if (value === null) return null;
  let name: ts.Node | undefined;
  if (ts.isJsxAttribute(value.parent)) name = value.parent.name;
  else if (ts.isPropertyAssignment(value.parent) && value.parent.initializer === value)
    name = value.parent.name;
  if (!name) return null;
  let text: string;
  if (ts.isJsxNamespacedName(name)) text = name.name.text;
  else if (ts.isIdentifier(name) || ts.isStringLiteral(name)) text = name.text;
  else return null;
  // `backgroundColor` and `stopColor` style what `background-color` and `stop-color` do.
  if (text.startsWith('--')) return text;
  return text.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/** The outermost expression a literal is part of the value of, or null for a condition. */
function styledValue(literal: ts.Node): ts.Node | null {
  let node = literal;
  while (
    ts.isConditionalExpression(node.parent) ||
    ts.isParenthesizedExpression(node.parent) ||
    ts.isBinaryExpression(node.parent) ||
    ts.isTemplateExpression(node.parent) ||
    ts.isTemplateSpan(node.parent) ||
    ts.isJsxExpression(node.parent)
  ) {
    if (ts.isConditionalExpression(node.parent) && node.parent.condition === node) return null;
    node = node.parent;
  }
  return node;
}

/** `hover:data-[state=open]:bg-red-500` is `bg-red-500`; a colon inside brackets is part of it. */
function withoutVariants(token: string): string {
  let depth = 0;
  let start = 0;
  for (let index = 0; index < token.length; index += 1) {
    const character = token[index];
    if (character === '[') depth += 1;
    else if (character === ']') depth -= 1;
    else if (character === ':' && depth === 0) start = index + 1;
  }
  return token.slice(start).replace(/^!/, '');
}

/** Hex, colour functions and named colours, outside any `var()`. */
function colorLiterals(value: string): string[] {
  const found: string[] = [];
  valueParser(value).walk((node) => {
    if (node.type === 'function') {
      const name = node.value.toLowerCase();
      if (name === 'var') return false;
      if (!COLOR_FUNCTIONS.has(name)) return undefined;
      found.push(valueParser.stringify(node));
      return false;
    }
    if (
      node.type === 'word' &&
      (HEX_COLOR.test(node.value) || NAMED_COLORS.has(node.value.toLowerCase()))
    )
      found.push(node.value);
    return undefined;
  });
  return found;
}

/** Each family a `font-family` value names, unquoted, ignoring `var()`. */
function fontFamilies(value: string): string[] {
  const named = valueParser(value)
    .nodes.filter((node) => !(node.type === 'function' && node.value.toLowerCase() === 'var'))
    .map((node) => valueParser.stringify(node))
    .join('');
  return named
    .split(',')
    .map((family) => family.trim().replace(/^(['"])(.*)\1$/, '$2'))
    .filter((family) => family.length > 0);
}

/** One note naming every kit token the design sets for itself. */
function overrideNote(overrides: ReadonlySet<string>): CanvasDiagnostic | null {
  const overridden = [...overrides].sort();
  if (overridden.length === 0) return null;
  return {
    code: ADHERENCE_CODES.override,
    message: `The design overrides kit tokens in source: ${overridden.join(', ')}. They stay as deliberate overrides.`,
  };
}
