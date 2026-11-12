import { createHash } from 'node:crypto';
import ts from 'typescript';
import { componentUses, functionName, type ComponentUses } from './componentUses.js';
import { attribute, attributeValue, isLiteral, propertyName } from './jsxAttributes.js';
import type { SourceElement, SourceFiles, SourceOutline } from './protocol.js';
import { resolveRelative } from './relativeImport.js';
import { CANVAS_LIMITS } from './schema.js';
import { SourceElementError } from './sourceElementError.js';
import { inlineSourceMap } from './sourceInstrumentationMap.js';
import { sourceOutline } from './sourceOutline.js';

export type ElementNode = ts.JsxElement | ts.JsxSelfClosingElement;
export interface Site {
  element: SourceElement;
  node: ElementNode;
  source: ts.SourceFile;
}
const MARKER = 'data-droidex-element';

/** IDs describe a canonical revision, never the derived instrumented text. */
export function instrumentSource(
  files: SourceFiles,
  revisionId: string,
): { files: SourceFiles; elements: SourceElement[]; outline: SourceOutline } {
  const program = parseProgram(files);
  const uses = componentUses(program);
  const sites = programSites(program, uses, files, revisionId);
  const derived: SourceFiles = { ...files };
  const byFile = new Map<ts.SourceFile, Site[]>();
  for (const site of sites) {
    const list = byFile.get(site.source) ?? [];
    list.push(site);
    byFile.set(site.source, list);
  }
  for (const [source, entries] of byFile) {
    const inserts = entries
      .map(({ node, element }) => {
        const opening = ts.isJsxElement(node) ? node.openingElement : node;
        return { at: opening.attributes.end, text: ` ${MARKER}="${element.elementId}"` };
      })
      .sort((a, b) => a.at - b.at);
    let text = '';
    let offset = 0;
    for (const insert of inserts) {
      text += source.text.slice(offset, insert.at) + insert.text;
      offset = insert.at;
    }
    text += source.text.slice(offset);
    derived[source.fileName] = text + inlineSourceMap(source, inserts);
  }
  return {
    files: derived,
    elements: sites.map((site) => site.element),
    outline: sourceOutline(program, uses, sites),
  };
}

/** The outline of a set of files with the node each row is written at; row ids do not depend on a revision. */
export function sourceLayers(files: SourceFiles): {
  uses: ComponentUses;
  outline: SourceOutline;
  written: Map<string, ts.Node>;
  checker: ts.TypeChecker;
} {
  const program = parseProgram(files);
  const uses = componentUses(program);
  const written = new Map<string, ts.Node>();
  const outline = sourceOutline(program, uses, programSites(program, uses, files, ''), written);
  return { uses, outline, written, checker: program.getTypeChecker() };
}

export function sourceSites(files: SourceFiles, revisionId: string): Site[] {
  const program = parseProgram(files);
  return programSites(program, componentUses(program), files, revisionId);
}

function programSites(
  program: ts.Program,
  { rendersOnce }: ComponentUses,
  files: SourceFiles,
  revisionId: string,
): Site[] {
  const hash = createHash('sha256').update(
    JSON.stringify([revisionId, Object.entries(files).sort(([a], [b]) => comparePaths(a, b))]),
  );
  const sites: Site[] = [];
  for (const source of program.getSourceFiles()) {
    const file = source.fileName;
    const pending: ts.Node[] = [source];
    while (pending.length) {
      const node = pending.pop();
      if (!node) break;
      node.forEachChild((child) => {
        pending.push(child);
      });
      if (!ts.isJsxElement(node) && !ts.isJsxSelfClosingElement(node)) continue;
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      if (!ts.isIdentifier(opening.tagName) || !/^[a-z]/.test(opening.tagName.text)) continue;
      if (attribute(opening, MARKER))
        throw new SourceElementError(
          'invalid_source',
          `${MARKER} is reserved for Canvas. Remove it and rebuild.`,
          file,
        );
      if (sites.length === CANVAS_LIMITS.maxSourceElements)
        throw new SourceElementError(
          'selection_limit',
          `This design has more than ${CANVAS_LIMITS.maxSourceElements.toLocaleString('en-US')} native JSX elements. Selection is unavailable for this revision. Simplify the source and rebuild to select elements.`,
          file,
        );
      const start = node.getStart(source);
      let editability: SourceElement['editability'] = 'literal';
      if (!rendersOnce(node)) editability = 'shared';
      else if (isComputed(node)) editability = 'computed';
      sites.push({
        node,
        source,
        element: {
          elementId: hash
            .copy()
            .update(JSON.stringify([file, start]))
            .digest('hex'),
          file,
          start,
          end: node.end,
          line: source.getLineAndCharacterOfPosition(start).line + 1,
          tagName: opening.tagName.text,
          component: componentOf(node),
          editability,
        },
      });
    }
  }
  return sites.sort(
    (a, b) => comparePaths(a.element.file, b.element.file) || a.element.start - b.element.start,
  );
}

/**
 * One program over the design's sources, so the checker resolves a name by
 * scope and an import as the bundler does. Throws on the first syntax error.
 */
function parseProgram(files: SourceFiles): ts.Program {
  const sources = new Map<string, ts.SourceFile>();
  let file = '';
  try {
    for (const [path, text] of Object.entries(files)) {
      if (path.endsWith('.css')) continue;
      file = path;
      sources.set(
        path,
        ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX),
      );
    }
    const program = ts.createProgram({
      rootNames: [...sources.keys()],
      options: { noLib: true, types: [], jsx: ts.JsxEmit.Preserve },
      host: {
        getSourceFile: (name) => sources.get(name),
        resolveModuleNameLiterals: (literals, importer) =>
          literals.map(({ text }) => ({ resolvedModule: designModule(files, importer, text) })),
        getDefaultLibFileName: () => '',
        writeFile: () => undefined,
        getCurrentDirectory: () => '',
        getDirectories: () => [],
        getCanonicalFileName: (name) => name,
        useCaseSensitiveFileNames: () => true,
        getNewLine: () => '\n',
        fileExists: (name) => sources.has(name),
        readFile: (name) => sources.get(name)?.text,
      },
    });
    for (const source of sources.values()) {
      file = source.fileName;
      const diagnostic = program.getSyntacticDiagnostics(source).at(0);
      if (!diagnostic) continue;
      const position = source.getLineAndCharacterOfPosition(diagnostic.start);
      throw new SourceElementError(
        'invalid_source',
        ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
        file,
        position.line + 1,
        Buffer.byteLength(
          source.text.slice(diagnostic.start - position.character, diagnostic.start),
          'utf8',
        ),
      );
    }
    return program;
  } catch (error) {
    if (error instanceof SourceElementError) throw error;
    throw new SourceElementError(
      'invalid_source',
      'Fix the source syntax before selecting or editing an element.',
      file,
    );
  }
}

/** A relative import of another design source; anything else resolves to nothing. */
function designModule(
  files: SourceFiles,
  importer: string,
  specifier: string,
): ts.ResolvedModuleFull | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const resolved = resolveRelative(files, importer, specifier);
  if (resolved.kind !== 'file' || resolved.path.endsWith('.css')) return undefined;
  const extension = resolved.path.endsWith('.ts') ? ts.Extension.Ts : ts.Extension.Tsx;
  return { resolvedFileName: resolved.path, extension };
}
function componentOf(node: ElementNode): string | null {
  for (let parent = node.parent; !ts.isSourceFile(parent); parent = parent.parent) {
    if (!ts.isFunctionLike(parent)) continue;
    const name = functionName(parent);
    if (name && /^[A-Z]/.test(name)) return name;
  }
  return null;
}

function isComputed(node: ElementNode): boolean {
  const opening = ts.isJsxElement(node) ? node.openingElement : node;
  if (opening.tagName.getText() === 'img') {
    for (let parent = node.parent; !ts.isSourceFile(parent); parent = parent.parent) {
      if (ts.isJsxElement(parent) && parent.openingElement.tagName.getText() === 'picture')
        return true;
    }
  }
  if (hasComputedAttributes(opening.attributes)) return true;
  if (ts.isJsxSelfClosingElement(node)) return false;
  if (node.children.length > 1 && node.children.some(ts.isJsxExpression)) return true;
  return node.children.some(
    (child) =>
      !ts.isJsxText(child) &&
      !ts.isJsxElement(child) &&
      !ts.isJsxSelfClosingElement(child) &&
      !ts.isJsxFragment(child) &&
      !(
        ts.isJsxExpression(child) &&
        !child.dotDotDotToken &&
        child.expression &&
        isLiteral(child.expression)
      ),
  );
}

// SVG paint attributes, which a paint edit replaces and so must be able to read.
const PAINT_ATTRIBUTES = new Set(['fill', 'stroke', 'strokeWidth', 'stroke-width']);

function hasComputedAttributes(attributes: ts.JsxAttributes): boolean {
  const names = new Set<string>();
  for (const attr of attributes.properties) {
    if (ts.isJsxSpreadAttribute(attr)) return true;
    const name = attr.name.getText();
    if (names.has(name) || isComputedAttribute(name, attributeValue(attr))) return true;
    names.add(name);
  }
  return false;
}

function isComputedAttribute(name: string, value: ts.Expression | undefined): boolean {
  if (name === 'children' || name === 'dangerouslySetInnerHTML' || name.toLowerCase() === 'srcset')
    return true;
  if (name === 'className') return value !== undefined && classLiterals(value) === null;
  if (name === 'src') return value !== undefined && !isLiteral(value);
  if (name === 'style') return hasComputedStyle(value);
  if (PAINT_ATTRIBUTES.has(name))
    return value === undefined || !(isLiteral(value) || ts.isNumericLiteral(value));
  // A path edit replaces its data, which it writes only over one quoted string.
  if (name === 'd') return value !== undefined && !ts.isStringLiteral(value);
  return false;
}

function hasComputedStyle(value: ts.Expression | undefined): boolean {
  if (!value || !ts.isObjectLiteralExpression(value)) return true;
  const keys = new Set<string>();
  for (const property of value.properties) {
    if (
      !ts.isPropertyAssignment(property) ||
      (!isLiteral(property.initializer) && !isNumber(property.initializer))
    )
      return true;
    const key = propertyName(property.name);
    if (!key || keys.has(key)) return true;
    keys.add(key);
  }
  return false;
}

const CLASS_JOINERS = new Set(['cn', 'clsx', 'cx']);

/**
 * The string literals a className is spelled with: the value itself, or every
 * argument of a class-joining call such as `cn("p-4", "flex")`. Null when any
 * part of it is computed.
 */
export function classLiterals(
  value: ts.Expression,
): (ts.StringLiteral | ts.NoSubstitutionTemplateLiteral)[] | null {
  if (isLiteral(value)) return [value];
  if (
    !ts.isCallExpression(value) ||
    !ts.isIdentifier(value.expression) ||
    !CLASS_JOINERS.has(value.expression.text) ||
    value.arguments.length === 0
  )
    return null;
  const literals = value.arguments.filter(isLiteral);
  return literals.length === value.arguments.length ? literals : null;
}

/** A number as a style object writes it: `12` or `-12`. */
function isNumber(node: ts.Expression): boolean {
  if (ts.isNumericLiteral(node)) return true;
  return (
    ts.isPrefixUnaryExpression(node) &&
    node.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(node.operand)
  );
}
export function ambiguous(): SourceElementError {
  return new SourceElementError(
    'ambiguous_element',
    'Canvas can’t change this element directly. Ask the agent to change it.',
  );
}
function comparePaths(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
