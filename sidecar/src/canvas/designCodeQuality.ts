// What a reviewer would ask of a frame's code before merging it, as the design
// brief asks the agent to write it: nothing declared and never read, static
// styling in classes rather than style={{}}, tokens rather than raw colours and
// scale values in [..] classes, repeated markup mapped from data, and files and
// components small enough to read. The findings are advice on a frame that
// built: they never fail a build under any rule, and `off` turns them off with
// the kit check. Each check reports once per file, naming every place.

import postcss from 'postcss';
import ts from 'typescript';
import { CODE_QUALITY_CODES } from './canvasDiagnostics.js';
import { colorLiterals } from './cssColors.js';
import { holdsToKit, isTextLiteral } from './designSystemAdherence.js';
import { lengthWords } from './designSystemAdherenceKit.js';
import type { DesignSystem } from './designSystems.js';
import { arbitraryUtility, withoutVariants } from './tailwindClasses.js';
import type { CanvasDiagnostic, DesignSystemAdherence, SourceFiles } from './protocol.js';

const MAX_FINDINGS = 12;
const MAX_LISTED = 6;
const MAX_FILE_LINES = 300;
const MAX_FUNCTION_LINES = 150;
/** Sibling blocks of one shape, each this many elements or more, read as copied markup. */
const REPEATED_COPIES = 3;
const REPEATED_ELEMENTS = 3;
const SCRIPT_KINDS: ReadonlyMap<string, ts.ScriptKind> = new Map([
  ['.tsx', ts.ScriptKind.TSX],
  ['.ts', ts.ScriptKind.TS],
  ['.jsx', ts.ScriptKind.JSX],
  ['.js', ts.ScriptKind.JS],
]);
/** Arbitrary utilities whose value belongs on a scale: font size, radius, spacing, shadow. */
const SCALE_UTILITY =
  /^(?:text|rounded(?:-[a-z]{1,2})?|[pm][xytrblse]?|gap(?:-[xy])?|space-[xy]|shadow)$/;
// Only the unused-name checks are read, so no library, types or imports are loaded.
const UNUSED_NAME_CHECK: ts.CompilerOptions = {
  noLib: true,
  noResolve: true,
  types: [],
  allowJs: true,
  checkJs: true,
  jsx: ts.JsxEmit.ReactJSX,
  target: ts.ScriptTarget.Latest,
  module: ts.ModuleKind.ESNext,
  noUnusedLocals: true,
  noUnusedParameters: true,
  noEmit: true,
};

export function checkCodeQuality(
  files: SourceFiles,
  system: DesignSystem,
  rule: DesignSystemAdherence,
): CanvasDiagnostic[] {
  if (rule === 'off') return [];
  const scripts = scriptSources(files);
  const findings = unusedNames(scripts);
  for (const source of scripts)
    findings.push(...staticStyles(source), ...repeatedMarkup(source), ...oversized(source));
  // Under a kit, the kit check names each raw value with the token to use instead.
  if (!holdsToKit(system, rule)) findings.push(...rawClassValues(scripts, files));
  return findings.slice(0, MAX_FINDINGS);
}

function scriptSources(files: SourceFiles): ts.SourceFile[] {
  const sources: ts.SourceFile[] = [];
  for (const [file, text] of Object.entries(files)) {
    const kind = SCRIPT_KINDS.get(file.slice(file.lastIndexOf('.')));
    if (kind === undefined) continue;
    sources.push(ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind));
  }
  return sources;
}

/** Imports, variables, functions and parameters each file declares and never reads. */
function unusedNames(sources: readonly ts.SourceFile[]): CanvasDiagnostic[] {
  const byName = new Map(sources.map((source) => [source.fileName, source]));
  const host: ts.CompilerHost = {
    getSourceFile: (name) => byName.get(name),
    fileExists: (name) => byName.has(name),
    readFile: () => undefined,
    writeFile: () => undefined,
    getDefaultLibFileName: () => 'lib.d.ts',
    getCurrentDirectory: () => '',
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
  };
  const program = ts.createProgram({
    rootNames: [...byName.keys()],
    options: UNUSED_NAME_CHECK,
    host,
  });
  const findings: CanvasDiagnostic[] = [];
  for (const source of sources) {
    const unused: string[] = [];
    let firstLine = 0;
    for (const diagnostic of program.getSemanticDiagnostics(source)) {
      const { start, length } = diagnostic;
      if (!diagnostic.reportsUnnecessary || start === undefined || length === undefined) continue;
      const line = lineOf(source, start);
      unused.push(`${unusedName(diagnostic, source, start, length)} (line ${String(line)})`);
      if (firstLine === 0) firstLine = line;
    }
    if (unused.length === 0) continue;
    findings.push({
      code: CODE_QUALITY_CODES.unused,
      message: `Declared and never used: ${listed(unused)}. Remove each one.`,
      file: source.fileName,
      line: firstLine,
    });
  }
  return findings;
}

/** `style={{}}` attributes that set a value written out in source. */
function staticStyles(source: ts.SourceFile): CanvasDiagnostic[] {
  const lines: string[] = [];
  const properties = new Set<string>();
  const visit = (node: ts.Node): void => {
    const object = styleObject(node);
    const fixed = object ? object.properties.map(staticPropertyName).filter(isName) : [];
    if (fixed.length > 0) {
      lines.push(String(lineOf(source, node.getStart(source))));
      for (const name of fixed) properties.add(name);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (lines.length === 0) return [];
  return [
    {
      code: CODE_QUALITY_CODES.staticStyle,
      message: `style={{}} holds static values (${listed([...properties])}) on line ${listed(lines)}. Move static styling to classes and keep style={{}} for values computed at run time.`,
      file: source.fileName,
      line: Number(lines[0]),
    },
  ];
}

function styleObject(node: ts.Node): ts.ObjectLiteralExpression | null {
  if (!ts.isJsxAttribute(node) || !ts.isIdentifier(node.name) || node.name.text !== 'style')
    return null;
  const expression =
    node.initializer && ts.isJsxExpression(node.initializer)
      ? node.initializer.expression
      : undefined;
  return expression && ts.isObjectLiteralExpression(expression) ? expression : null;
}

function staticPropertyName(property: ts.ObjectLiteralElementLike): string | null {
  if (!ts.isPropertyAssignment(property) || !isLiteralValue(property.initializer)) return null;
  const { name } = property;
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : null;
}

function isLiteralValue(expression: ts.Expression): boolean {
  if (ts.isPrefixUnaryExpression(expression) && expression.operator === ts.SyntaxKind.MinusToken)
    return ts.isNumericLiteral(expression.operand);
  return (
    ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression) ||
    ts.isNumericLiteral(expression)
  );
}

function isName(name: string | null): name is string {
  return name !== null;
}

/** Sibling elements of one shape written out again and again instead of mapped from data. */
function repeatedMarkup(source: ts.SourceFile): CanvasDiagnostic[] {
  const findings: CanvasDiagnostic[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      const byShape = new Map<string, (ts.JsxElement | ts.JsxSelfClosingElement)[]>();
      for (const child of node.children) {
        if (!ts.isJsxElement(child) && !ts.isJsxSelfClosingElement(child)) continue;
        const shape = shapeOf(child, source);
        if (shape === null || shape.elements < REPEATED_ELEMENTS) continue;
        byShape.set(shape.key, [...(byShape.get(shape.key) ?? []), child]);
      }
      for (const copies of byShape.values()) {
        if (copies.length < REPEATED_COPIES) continue;
        const first = lineOf(source, copies[0].getStart(source));
        const last = lineOf(source, copies[copies.length - 1].getStart(source));
        findings.push({
          code: CODE_QUALITY_CODES.repeatedMarkup,
          message: `${String(copies.length)} sibling <${tagOf(copies[0], source)}> blocks on lines ${String(first)}-${String(last)} repeat the same markup. Keep what differs in an array and map it over one component.`,
          file: source.fileName,
          line: first,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

interface Shape {
  key: string;
  elements: number;
}

/** A block's elements, attribute names and nesting; text and attribute values are what differs. */
function shapeOf(node: ts.JsxChild, source: ts.SourceFile): Shape | null {
  if (ts.isJsxExpression(node)) return node.expression ? { key: '{}', elements: 0 } : null;
  if (ts.isJsxText(node)) return null;
  if (ts.isJsxSelfClosingElement(node))
    return {
      key: `<${tagOf(node, source)}${attributeNames(node.attributes, source)}/>`,
      elements: 1,
    };
  const children = node.children
    .map((child) => shapeOf(child, source))
    .filter((shape): shape is Shape => shape !== null);
  const tag = ts.isJsxElement(node) ? tagOf(node, source) : '';
  const attributes = ts.isJsxElement(node)
    ? attributeNames(node.openingElement.attributes, source)
    : '';
  return {
    key: `<${tag}${attributes}>${children.map((child) => child.key).join('')}</>`,
    elements: children.reduce((total, child) => total + child.elements, 1),
  };
}

function tagOf(element: ts.JsxElement | ts.JsxSelfClosingElement, source: ts.SourceFile): string {
  const tag = ts.isJsxElement(element) ? element.openingElement.tagName : element.tagName;
  return tag.getText(source);
}

function attributeNames(attributes: ts.JsxAttributes, source: ts.SourceFile): string {
  const names = attributes.properties.map((attribute) =>
    ts.isJsxAttribute(attribute) ? attribute.name.getText(source) : '...',
  );
  return names.length > 0 ? ` ${names.sort().join(' ')}` : '';
}

/** A file, or a top-level function in it, too long to read as one piece. */
function oversized(source: ts.SourceFile): CanvasDiagnostic[] {
  const findings: CanvasDiagnostic[] = [];
  const fileLines = lineOf(source, source.end);
  if (fileLines > MAX_FILE_LINES)
    findings.push({
      code: CODE_QUALITY_CODES.size,
      message: `${source.fileName} is ${String(fileLines)} lines. Split it into small single-purpose components in their own relative modules.`,
      file: source.fileName,
      line: 1,
    });
  for (const { name, node } of topLevelFunctions(source)) {
    const first = lineOf(source, node.getStart(source));
    const length = lineOf(source, node.end) - first + 1;
    if (length <= MAX_FUNCTION_LINES) continue;
    findings.push({
      code: CODE_QUALITY_CODES.size,
      message: `${name} is ${String(length)} lines. Split it into small single-purpose components.`,
      file: source.fileName,
      line: first,
    });
  }
  return findings;
}

function topLevelFunctions(source: ts.SourceFile): { name: string; node: ts.Node }[] {
  const functions: { name: string; node: ts.Node }[] = [];
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement))
      functions.push({ name: statement.name?.text ?? 'The default export', node: statement });
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const value = declaration.initializer;
      if (!ts.isIdentifier(declaration.name) || !value) continue;
      if (ts.isArrowFunction(value) || ts.isFunctionExpression(value))
        functions.push({ name: declaration.name.text, node: declaration });
    }
  }
  return functions;
}

/** `[..]` classes holding a raw colour or scale value rather than a token reference. */
function rawClassValues(scripts: readonly ts.SourceFile[], files: SourceFiles): CanvasDiagnostic[] {
  const findings: CanvasDiagnostic[] = [];
  const report = (file: string, raw: ReadonlyMap<string, number>): void => {
    if (raw.size === 0) return;
    const places = [...raw].map(([utility, line]) => `${utility} (line ${String(line)})`);
    findings.push({
      code: CODE_QUALITY_CODES.rawValue,
      message: `Raw values in [..] classes: ${listed(places)}. Name each value once as a --ds-* token in styles.css, or use the project's own token, and reference it, as in bg-[color:var(--ds-surface)].`,
      file,
      line: Math.min(...raw.values()),
    });
  };
  for (const source of scripts) {
    const raw = new Map<string, number>();
    const visit = (node: ts.Node): void => {
      if (isTextLiteral(node))
        readRawClasses(raw, node.text, lineOf(source, node.getStart(source)));
      ts.forEachChild(node, visit);
    };
    visit(source);
    report(source.fileName, raw);
  }
  for (const [file, text] of Object.entries(files)) {
    if (!file.endsWith('.css')) continue;
    const raw = new Map<string, number>();
    try {
      postcss.parse(text).walkAtRules('apply', (rule) => {
        readRawClasses(raw, rule.params, rule.source?.start?.line ?? 1);
      });
    } catch {
      // The stylesheet build reports the syntax error itself.
      continue;
    }
    report(file, raw);
  }
  return findings;
}

/** Notes each raw-valued utility in a class list at its first line. */
function readRawClasses(raw: Map<string, number>, classList: string, line: number): void {
  for (const token of classList.split(/\s+/)) {
    const utility = withoutVariants(token);
    if (!raw.has(utility) && holdsRawValue(utility)) raw.set(utility, line);
  }
}

function holdsRawValue(utility: string): boolean {
  const arbitrary = arbitraryUtility(utility);
  if (!arbitrary || arbitrary.value.includes('var(')) return false;
  if (colorLiterals(arbitrary.value).length > 0) return true;
  return SCALE_UTILITY.test(arbitrary.prefix) && lengthWords(arbitrary.value).length > 0;
}

/** The name the diagnostic is about; a binding pattern's span covers its braces. */
function unusedName(
  diagnostic: ts.Diagnostic,
  source: ts.SourceFile,
  start: number,
  length: number,
): string {
  const quoted = /^'([^']+)'/.exec(ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '));
  return quoted ? quoted[1] : source.text.slice(start, start + length).replace(/\s+/g, ' ');
}

function lineOf(source: ts.SourceFile, position: number): number {
  return source.getLineAndCharacterOfPosition(position).line + 1;
}

/** The first few items, then how many more there are. */
function listed(items: readonly string[]): string {
  const shown = items.slice(0, MAX_LISTED).join(', ');
  if (items.length <= MAX_LISTED) return shown;
  return `${shown} and ${String(items.length - MAX_LISTED)} more`;
}
