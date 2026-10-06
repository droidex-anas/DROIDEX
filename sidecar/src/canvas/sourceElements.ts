import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import ts from 'typescript';
import type { ElementEdit, SourceElement, SourceFiles } from './protocol.js';
import { CANVAS_LIMITS } from './schema.js';

export class SourceElementError extends Error {
  constructor(
    readonly code: 'stale_reference' | 'ambiguous_element' | 'invalid_source' | 'invalid_edit',
    message: string,
    readonly file?: string,
    readonly line?: number,
    readonly column?: number,
  ) {
    super(message);
    this.name = 'SourceElementError';
  }
}

type ElementNode = ts.JsxElement | ts.JsxSelfClosingElement;
interface Site {
  element: SourceElement;
  node: ElementNode;
  source: ts.SourceFile;
}
const MARKER = 'data-droidex-element';
const TOKEN_PROPERTIES = new Set([
  'color',
  'backgroundColor',
  'borderColor',
  'borderRadius',
  'boxShadow',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
  'gap',
  'padding',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'margin',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
]);

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

/** Returns only changed paths, with their complete contents, for workspace.write. */
export function applyElementEdit(
  files: SourceFiles,
  elements: SourceElement[],
  edit: ElementEdit,
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
  let start: number;
  let end: number;
  let replacement: string;
  switch (edit.change.kind) {
    case 'text': {
      if (!ts.isJsxElement(node) || node.children.length > 1) throw ambiguous();
      if (node.children.length === 0) {
        start = node.openingElement.end;
        end = start;
        replacement = escapeJsxText(edit.change.value);
        break;
      }
      const child = node.children.at(0);
      if (!child) throw ambiguous();
      if (ts.isJsxText(child)) {
        start = child.pos;
        end = child.end;
        replacement = escapeJsxText(edit.change.value);
      } else if (ts.isJsxExpression(child) && child.expression && isLiteral(child.expression)) {
        start = child.expression.getStart(source);
        end = child.expression.end;
        replacement = JSON.stringify(edit.change.value);
      } else throw ambiguous();
      break;
    }
    case 'token': {
      if (
        !TOKEN_PROPERTIES.has(edit.change.property) ||
        !/^--[a-z0-9]+(-[a-z0-9]+)*$/.test(edit.change.token)
      )
        throw new SourceElementError(
          'invalid_edit',
          'Choose a supported style property and a design-system token.',
        );
      const style = attributeValue(attribute(opening, 'style'));
      if (!style || !ts.isObjectLiteralExpression(style)) throw ambiguous();
      const propertyNameToEdit = edit.change.property;
      const properties = style.properties.filter(
        (property) => property.name && propertyName(property.name) === propertyNameToEdit,
      );
      const property = properties.at(0);
      if (
        properties.length !== 1 ||
        !property ||
        !ts.isPropertyAssignment(property) ||
        !isLiteral(property.initializer) ||
        !/^var\(--[a-z0-9]+(-[a-z0-9]+)*\)$/.test(property.initializer.text)
      )
        throw ambiguous();
      start = property.initializer.getStart(source);
      end = property.initializer.end;
      replacement = JSON.stringify(`var(${edit.change.token})`);
      break;
    }
    case 'image': {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(edit.change.assetId))
        throw new SourceElementError('invalid_edit', 'Choose an owned Canvas image.');
      const src = attributeValue(attribute(opening, 'src'));
      if (
        site.element.tagName !== 'img' ||
        !src ||
        !isLiteral(src) ||
        !/^canvas-asset:[A-Za-z0-9_-]{1,128}$/.test(src.text)
      )
        throw ambiguous();
      start = src.getStart(source);
      end = src.end;
      replacement = JSON.stringify(`canvas-asset:${edit.change.assetId}`);
      break;
    }
  }
  return { [source.fileName]: source.text.slice(0, start) + replacement + source.text.slice(end) };
}

function sourceSites(files: SourceFiles, revisionId: string): Site[] {
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
          'invalid_source',
          `A design can map at most ${String(CANVAS_LIMITS.maxSourceElements)} native JSX elements. Simplify the source and rebuild.`,
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
    if (
      ts.isFunctionLike(parent) ||
      ts.isVariableDeclaration(parent) ||
      ts.isCallExpression(parent) ||
      ts.isArrayLiteralExpression(parent) ||
      ts.isPropertyAssignment(parent) ||
      ts.isForStatement(parent) ||
      ts.isForOfStatement(parent) ||
      ts.isForInStatement(parent) ||
      ts.isWhileStatement(parent) ||
      ts.isDoStatement(parent)
    )
      return true;
    if (ts.isJsxElement(parent)) {
      const tag = parent.openingElement.tagName;
      if (!ts.isIdentifier(tag) || !/^[a-z]/.test(tag.text)) return true;
    }
  }
  return true;
}

function isComputed(node: ElementNode): boolean {
  const opening = ts.isJsxElement(node) ? node.openingElement : node;
  if (opening.tagName.getText() === 'img') {
    for (let parent = node.parent; !ts.isSourceFile(parent); parent = parent.parent) {
      if (ts.isJsxElement(parent) && parent.openingElement.tagName.getText() === 'picture')
        return true;
    }
  }
  const names = new Set<string>();
  for (const attr of opening.attributes.properties) {
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
    if (name === 'style') {
      if (!value || !ts.isObjectLiteralExpression(value)) return true;
      const keys = new Set<string>();
      for (const property of value.properties) {
        if (
          !ts.isPropertyAssignment(property) ||
          !propertyName(property.name) ||
          (!isLiteral(property.initializer) && !ts.isNumericLiteral(property.initializer))
        )
          return true;
        const key = propertyName(property.name);
        if (keys.has(key)) return true;
        keys.add(key);
      }
    }
  }
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

function attribute(opening: ts.JsxOpeningElement | ts.JsxSelfClosingElement, name: string) {
  return opening.attributes.properties.find(
    (attr): attr is ts.JsxAttribute => ts.isJsxAttribute(attr) && attr.name.getText() === name,
  );
}
function attributeValue(attr: ts.JsxAttribute | undefined): ts.Expression | undefined {
  const value = attr?.initializer;
  if (!value) return undefined;
  return ts.isJsxExpression(value) ? value.expression : value;
}
function propertyName(name: ts.PropertyName): string {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : '';
}
function isLiteral(node: ts.Node): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
}
function staleReference(): SourceElementError {
  return new SourceElementError(
    'stale_reference',
    'This selection belongs to different source. Reselect the element in the current revision.',
  );
}
function ambiguous(): SourceElementError {
  return new SourceElementError(
    'ambiguous_element',
    'This source is computed or shared. Ask the agent to edit the selected scope.',
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

// Map every UTF-16 column, including both edges of an insertion. A line-only
// map would silently collapse later token columns when esbuild composes it.
function inlineSourceMap(source: ts.SourceFile, inserts: { at: number; text: string }[]): string {
  const lines = source.getLineStarts();
  let index = 0;
  let previousColumn = 0;
  const mappings = lines
    .map((start, line) => {
      const segments = [vlq(0) + vlq(0) + vlq(line === 0 ? 0 : 1) + vlq(-previousColumn)];
      previousColumn = 0;
      const nextLine = lines.at(line + 1);
      while (index < inserts.length) {
        const insert = inserts.at(index);
        if (!insert || insert.at >= (nextLine ?? Infinity)) break;
        const column = insert.at - start;
        segments.push(',CAAC'.repeat(column - previousColumn), ',', vlq(insert.text.length), 'AAA');
        previousColumn = column;
        index++;
      }
      const lastColumn = (nextLine === undefined ? source.text.length : nextLine - 1) - start;
      segments.push(',CAAC'.repeat(lastColumn - previousColumn));
      previousColumn = lastColumn;
      return segments.join('');
    })
    .join(';');
  const map = {
    version: 3,
    sources: [`canvas-design:${source.fileName}`],
    sourcesContent: [source.text],
    names: [],
    mappings,
  };
  return `\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(map)).toString('base64')}\n`;
}
function vlq(value: number): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let encoded = '';
  let rest = value < 0 ? -value * 2 + 1 : value * 2;
  do {
    const digit = rest % 32;
    rest = Math.floor(rest / 32);
    encoded += alphabet[digit + (rest ? 32 : 0)];
  } while (rest);
  return encoded;
}

function comparePaths(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
