import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import ts from 'typescript';
import type { SourceElement, SourceFiles } from './protocol.js';
import { CANVAS_LIMITS } from './schema.js';
import { inlineSourceMap } from './sourceInstrumentationMap.js';

export class SourceElementError extends Error {
  constructor(
    readonly code:
      | 'stale_reference'
      | 'ambiguous_element'
      | 'invalid_source'
      | 'invalid_edit'
      | 'unsupported_edit'
      | 'selection_limit',
    message: string,
    readonly file?: string,
    readonly line?: number,
    readonly column?: number,
  ) {
    super(message);
    this.name = 'SourceElementError';
  }
}

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
): { files: SourceFiles; elements: SourceElement[] } {
  const sites = sourceSites(files, revisionId);
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
  return { files: derived, elements: sites.map((site) => site.element) };
}

export function sourceSites(files: SourceFiles, revisionId: string): Site[] {
  const hash = createHash('sha256').update(
    JSON.stringify([revisionId, Object.entries(files).sort(([a], [b]) => comparePaths(a, b))]),
  );
  const sources = Object.entries(files)
    .filter(([file]) => !file.endsWith('.css'))
    .map(([file, text]) => parseSource(file, text));
  const importsEntry = sources.some((source) =>
    source.statements.some((statement) => {
      if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) return false;
      const specifier = statement.moduleSpecifier;
      if (!specifier || !ts.isStringLiteral(specifier) || !specifier.text.startsWith('.'))
        return false;
      const target = posix.normalize(posix.join(posix.dirname(source.fileName), specifier.text));
      return target === 'main' || target === 'main.tsx' || target === 'main.ts';
    }),
  );
  const sites: Site[] = [];
  for (const source of sources) {
    const file = source.fileName;
    const root = file === 'main.tsx' && !importsEntry ? defaultComponent(source) : undefined;
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
      if (isShared(node, root)) editability = 'shared';
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
          tagName: opening.tagName.text,
          editability,
        },
      });
    }
  }
  return sites.sort(
    (a, b) => comparePaths(a.element.file, b.element.file) || a.element.start - b.element.start,
  );
}

function parseSource(file: string, text: string): ts.SourceFile {
  try {
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const program = ts.createProgram(
      [file],
      { noLib: true, noResolve: true, jsx: ts.JsxEmit.Preserve },
      {
        getSourceFile: (name) => (name === file ? source : undefined),
        getDefaultLibFileName: () => '',
        writeFile: () => undefined,
        getCurrentDirectory: () => '',
        getDirectories: () => [],
        getCanonicalFileName: (name) => name,
        useCaseSensitiveFileNames: () => true,
        getNewLine: () => '\n',
        fileExists: (name) => name === file,
        readFile: (name) => (name === file ? text : undefined),
      },
    );
    const diagnostic = program.getSyntacticDiagnostics(source).at(0);
    if (diagnostic) {
      const position = source.getLineAndCharacterOfPosition(diagnostic.start);
      throw new SourceElementError(
        'invalid_source',
        ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
        file,
        position.line + 1,
        Buffer.byteLength(
          text.slice(diagnostic.start - position.character, diagnostic.start),
          'utf8',
        ),
      );
    }
    return source;
  } catch (error) {
    if (error instanceof SourceElementError) throw error;
    throw new SourceElementError(
      'invalid_source',
      'Fix the source syntax before selecting or editing an element.',
      file,
    );
  }
}

function defaultComponent(source: ts.SourceFile): ts.Node | undefined {
  for (const statement of source.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)
    )
      return referencedElsewhere(source, statement.name) ? undefined : statement;
    if (
      ts.isExportAssignment(statement) &&
      !statement.isExportEquals &&
      (ts.isArrowFunction(statement.expression) || ts.isFunctionExpression(statement.expression))
    )
      return statement.expression;
  }
  return undefined;
}

function referencedElsewhere(source: ts.SourceFile, name: ts.Identifier | undefined): boolean {
  if (!name) return false;
  const pending: ts.Node[] = [source];
  while (pending.length) {
    const node = pending.pop();
    if (!node) break;
    if (ts.isIdentifier(node) && node !== name && node.text === name.text) return true;
    node.forEachChild((child) => {
      pending.push(child);
    });
  }
  return false;
}

function isShared(node: ElementNode, root: ts.Node | undefined): boolean {
  for (let parent = node.parent; !ts.isSourceFile(parent); parent = parent.parent) {
    if (parent === root) return false;
    if (canReuseJsx(parent)) return true;
    if (ts.isJsxElement(parent) || ts.isJsxSelfClosingElement(parent)) {
      const tag = ts.isJsxElement(parent) ? parent.openingElement.tagName : parent.tagName;
      if (!ts.isIdentifier(tag) || !/^[a-z]/.test(tag.text)) return true;
    }
  }
  return true;
}

function canReuseJsx(node: ts.Node): boolean {
  return (
    ts.isFunctionLike(node) ||
    ts.isVariableDeclaration(node) ||
    ts.isCallExpression(node) ||
    ts.isArrayLiteralExpression(node) ||
    ts.isPropertyAssignment(node) ||
    ts.isForStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isWhileStatement(node) ||
    ts.isDoStatement(node)
  );
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
      !(
        ts.isJsxExpression(child) &&
        !child.dotDotDotToken &&
        child.expression &&
        isLiteral(child.expression)
      ),
  );
}

function hasComputedAttributes(attributes: ts.JsxAttributes): boolean {
  const names = new Set<string>();
  for (const attr of attributes.properties) {
    if (ts.isJsxSpreadAttribute(attr)) return true;
    const name = attr.name.getText();
    if (names.has(name)) return true;
    names.add(name);
    if (
      name === 'children' ||
      name === 'dangerouslySetInnerHTML' ||
      name.toLowerCase() === 'srcset'
    )
      return true;
    const value = attributeValue(attr);
    if ((name === 'className' || name === 'src') && value && !isLiteral(value)) return true;
    if (name === 'style' && hasComputedStyle(value)) return true;
  }
  return false;
}

function hasComputedStyle(value: ts.Expression | undefined): boolean {
  if (!value || !ts.isObjectLiteralExpression(value)) return true;
  const keys = new Set<string>();
  for (const property of value.properties) {
    if (
      !ts.isPropertyAssignment(property) ||
      (!isLiteral(property.initializer) && !ts.isNumericLiteral(property.initializer))
    )
      return true;
    const key = propertyName(property.name);
    if (!key || keys.has(key)) return true;
    keys.add(key);
  }
  return false;
}

export function attribute(opening: ts.JsxOpeningElement | ts.JsxSelfClosingElement, name: string) {
  return opening.attributes.properties.find(
    (attr): attr is ts.JsxAttribute => ts.isJsxAttribute(attr) && attr.name.getText() === name,
  );
}
export function attributeValue(attr: ts.JsxAttribute | undefined): ts.Expression | undefined {
  const value = attr?.initializer;
  if (!value) return undefined;
  return ts.isJsxExpression(value) ? value.expression : value;
}
export function propertyName(name: ts.PropertyName): string {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : '';
}
export function isLiteral(
  node: ts.Node,
): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
}
export function ambiguous(): SourceElementError {
  return new SourceElementError(
    'ambiguous_element',
    'This source is computed or shared. Ask the agent to edit the selected scope.',
  );
}
function comparePaths(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
