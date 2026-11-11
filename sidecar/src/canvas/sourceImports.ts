// The imports an inserted catalog entry needs, written where the file already
// imports: its kit and lucide-react names join a named import of that module,
// or a new import goes after the file's last one. A name the file already
// binds some other way is refused, since a second binding would not compile.

import ts from 'typescript';
import { KIT_SPECIFIER } from './designBundle.js';
import { SourceElementError } from './sourceElementError.js';
import { lineIndent, startsLine } from './sourceLines.js';

export const ICON_SPECIFIER = 'lucide-react';

/** The names an entry takes from one module. */
export interface ModuleNames {
  module: string;
  names: readonly string[];
}

interface Replacement {
  start: number;
  end: number;
  replacement: string;
}

/** The replacements that import every name into `source`; a name it already imports from its module is left. */
export function importEdits(
  source: ts.SourceFile,
  wanted: readonly ModuleNames[],
  eol: string,
): Replacement[] {
  const bindings = boundNames(source);
  const edits: Replacement[] = [];
  const added: ModuleNames[] = [];
  for (const { module, names } of wanted) {
    if (names.length === 0) continue;
    const imports = importsOf(source, module);
    if (imports.some((declaration) => isNamespaceImport(declaration)))
      throw invalid(
        module === KIT_SPECIFIER
          ? 'This file reads the kit another way. Ask the agent to add it.'
          : 'This file reads its icons another way. Ask the agent to add it.',
      );
    const missing = [...new Set(names)].filter((name) => {
      const bound = bindings.get(name) ?? [];
      if (!bound.every((node) => importsAs(node, module, name)))
        throw invalid(`This file already has its own ${name}. Ask the agent to add it.`);
      return bound.length === 0;
    });
    if (missing.length === 0) continue;
    const named = imports.map(valueNames).find((each) => each !== undefined);
    if (named) edits.push(joined(source.text, named, missing, eol));
    else added.push({ module, names: missing });
  }
  if (added.length > 0) edits.push(newImports(source, added, eol));
  return edits;
}

/** Every name the file declares, with the nodes declaring it, at any depth. */
function boundNames(source: ts.SourceFile): Map<string, ts.Node[]> {
  const bound = new Map<string, ts.Node[]>();
  const visit = (node: ts.Node): void => {
    const name = declaredName(node);
    if (name) bound.set(name.text, [...(bound.get(name.text) ?? []), node]);
    node.forEachChild(visit);
  };
  visit(source);
  return bound;
}

function declaredName(node: ts.Node): ts.Identifier | undefined {
  if (!isDeclaration(node) && !isImportBinding(node)) return undefined;
  const { name } = node;
  return name && ts.isIdentifier(name) ? name : undefined;
}

function isDeclaration(node: ts.Node) {
  return (
    ts.isVariableDeclaration(node) ||
    ts.isParameter(node) ||
    ts.isBindingElement(node) ||
    ts.isFunctionDeclaration(node) ||
    // A named function or class expression binds its name inside itself, where the entry may land.
    ts.isFunctionExpression(node) ||
    ts.isClassDeclaration(node) ||
    ts.isClassExpression(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node)
  );
}

function isImportBinding(node: ts.Node) {
  return (
    ts.isImportClause(node) ||
    ts.isNamespaceImport(node) ||
    ts.isImportSpecifier(node) ||
    ts.isImportEqualsDeclaration(node)
  );
}

/** Whether the node is `name` imported as a value under its own name from `module`. */
function importsAs(node: ts.Node, module: string, name: string): boolean {
  if (!ts.isImportSpecifier(node) || node.isTypeOnly) return false;
  if ((node.propertyName?.text ?? name) !== name) return false;
  const declaration = ts.findAncestor(node, ts.isImportDeclaration);
  return (
    declaration !== undefined &&
    specifierOf(declaration) === module &&
    valueNames(declaration) === node.parent
  );
}

/** The `{ … }` of an import that brings in values, as a plain `import { … }` does. */
function valueNames(declaration: ts.ImportDeclaration): ts.NamedImports | undefined {
  const clause = declaration.importClause;
  const bindings = clause?.namedBindings;
  if (clause?.phaseModifier !== undefined || !bindings || !ts.isNamedImports(bindings))
    return undefined;
  return bindings;
}

function importsOf(source: ts.SourceFile, module: string): ts.ImportDeclaration[] {
  return source.statements.filter(
    (statement): statement is ts.ImportDeclaration =>
      ts.isImportDeclaration(statement) && specifierOf(statement) === module,
  );
}

function specifierOf(declaration: ts.ImportDeclaration): string | undefined {
  const { moduleSpecifier } = declaration;
  return ts.isStringLiteral(moduleSpecifier) ? moduleSpecifier.text : undefined;
}

function isNamespaceImport(declaration: ts.ImportDeclaration): boolean {
  const bindings = declaration.importClause?.namedBindings;
  return bindings !== undefined && ts.isNamespaceImport(bindings);
}

/** The names joined to a named import: one a line where it has a line for each, else inline. */
function joined(text: string, named: ts.NamedImports, names: string[], eol: string): Replacement {
  const last = named.elements.at(-1);
  if (!last) {
    const inside = { start: named.getStart() + 1, end: named.end - 1 };
    return { ...inside, replacement: ` ${names.join(', ')} ` };
  }
  const { hasTrailingComma } = named.elements;
  const at = hasTrailingComma ? trailingComma(named).end : last.end;
  const inline = !startsLine(text, last.getStart());
  const indent = lineIndent(text, last.getStart());
  const items = names.map((name) => (inline ? ` ${name}` : `${eol}${indent}${name}`));
  const replacement = hasTrailingComma
    ? items.map((item) => `${item},`).join('')
    : `,${items.join(',')}`;
  return { start: at, end: at, replacement };
}

/** The comma token after a named import's last name, which a comment may hold a comma before. */
function trailingComma(named: ts.NamedImports): ts.Node {
  const list = named.getChildren().find((child) => child.kind === ts.SyntaxKind.SyntaxList);
  const comma = list?.getChildren().at(-1);
  if (comma?.kind !== ts.SyntaxKind.CommaToken) throw new Error('A trailing comma has no token.');
  return comma;
}

/** New imports after the file's last one, quoted and ended as it is; at the top of a file with none. */
function newImports(source: ts.SourceFile, added: ModuleNames[], eol: string): Replacement {
  const last = source.statements.filter(ts.isImportDeclaration).at(-1);
  const quote = last?.moduleSpecifier.getText().startsWith('"') ? '"' : "'";
  const semicolon = last === undefined || source.text[last.end - 1] === ';' ? ';' : '';
  const lines = added.map(
    ({ module, names }) =>
      `import { ${names.join(', ')} } from ${quote}${module}${quote}${semicolon}`,
  );
  if (last)
    return {
      start: last.end,
      end: last.end,
      replacement: lines.map((line) => eol + line).join(''),
    };
  const { text } = source;
  const head = headEnd(source);
  // On the line after the head, or at the top of a file without one.
  let start = 0;
  let opening = '';
  if (head > 0) {
    const lineEnd = text.indexOf('\n', head);
    start = lineEnd === -1 ? text.length : lineEnd + 1;
    if (lineEnd === -1) opening = eol;
  }
  const blank = /^\r?\n/.test(text.slice(start)) ? '' : eol;
  const replacement = opening + lines.map((line) => line + eol).join('') + blank;
  return { start, end: start, replacement };
}

/**
 * Where the head of a file with no imports ends: past its directives, as
 * `'use client'`, and the comments that open it, which stay first. A doc
 * comment belongs to the code it documents, so the imports go above it.
 */
function headEnd(source: ts.SourceFile): number {
  const { text } = source;
  let end = 0;
  for (const statement of source.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break;
    end = statement.end;
  }
  for (const comment of ts.getLeadingCommentRanges(text, end) ?? []) {
    if (text.startsWith('/**', comment.pos)) break;
    end = comment.end;
  }
  return end;
}

function invalid(message: string): SourceElementError {
  return new SourceElementError('invalid_edit', message);
}
